import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assert, describe, it } from '@effect/vitest';
import { Config, Effect } from 'effect';

import { loadConfigProvider, ServerConfig } from '../../server/infrastructure/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'pokedex-env-'));
const envFile = (name: string, contents: string) => {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
};

/** Reads `key` through the provider built from `env`. */
const read = (env: Record<string, string | undefined>, key: string) =>
  Effect.gen(function* () {
    const provider = yield* loadConfigProvider(env);
    return yield* Config.option(Config.String(key)).parse(provider);
  });

describe('env file ConfigProvider', () => {
  const file = envFile(
    'basic.env',
    [
      '# comment',
      'POKEMON_CATALOG=http',
      'export LOG_FORMAT=json',
      'POKEAPI_BASE_URL="http://localhost:4010/api/v2" # inline comment',
      'PORT=4000',
    ].join('\n'),
  );

  it.effect("supplies values the environment doesn't set", () =>
    Effect.gen(function* () {
      const value = yield* read({ DOTENV_PATH: file }, 'POKEMON_CATALOG');
      assert.deepStrictEqual(value._tag === 'Some' ? value.value : null, 'http');
    }),
  );

  it.effect('parses export prefixes, quotes and inline comments', () =>
    Effect.gen(function* () {
      const format = yield* read({ DOTENV_PATH: file }, 'LOG_FORMAT');
      const url = yield* read({ DOTENV_PATH: file }, 'POKEAPI_BASE_URL');
      assert.deepStrictEqual(format._tag === 'Some' ? format.value : null, 'json');
      assert.deepStrictEqual(url._tag === 'Some' ? url.value : null, 'http://localhost:4010/api/v2');
    }),
  );

  it.effect('lets real environment variables win over the file', () =>
    Effect.gen(function* () {
      const value = yield* read({ DOTENV_PATH: file, POKEMON_CATALOG: 'in-memory' }, 'POKEMON_CATALOG');
      assert.deepStrictEqual(value._tag === 'Some' ? value.value : null, 'in-memory');
    }),
  );

  it.effect('feeds typed application config (ServerConfig)', () =>
    Effect.gen(function* () {
      const provider = yield* loadConfigProvider({ DOTENV_PATH: file });
      const config = yield* ServerConfig.parse(provider);
      assert.strictEqual(config.port, 4000);
      assert.strictEqual(config.host, '0.0.0.0');
    }),
  );

  it.effect('ignores a missing file', () =>
    Effect.gen(function* () {
      const value = yield* read({ DOTENV_PATH: join(dir, 'absent.env') }, 'POKEMON_CATALOG');
      assert.strictEqual(value._tag, 'None');
    }),
  );

  it.effect('DOTENV_PATH= (empty) disables the file', () =>
    Effect.gen(function* () {
      const value = yield* read({ DOTENV_PATH: '' }, 'POKEMON_CATALOG');
      assert.strictEqual(value._tag, 'None');
    }),
  );

  it.effect("fails with EnvFileError when the file exists but can't be read", () =>
    Effect.gen(function* () {
      const directory = join(dir, 'a-directory.env');
      mkdirSync(directory, { recursive: true });
      const error = yield* Effect.flip(loadConfigProvider({ DOTENV_PATH: directory }));
      assert.strictEqual(error._tag, 'EnvFileError');
    }),
  );
});
