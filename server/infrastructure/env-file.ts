import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Config, ConfigProvider, Effect, Schema } from 'effect';

/** The `.env` file exists but could not be read or parsed. Fails the runtime, so the process refuses to boot. */
export class EnvFileError extends Schema.TaggedError<EnvFileError>()('EnvFileError', {
  path: Schema.String,
  message: Schema.String,
}) {}

/**
 * Where to look for the env file. Read from the real environment only (it
 * locates the file, so it can't come from it). An empty value disables the
 * file entirely; the e2e servers do this to stay hermetic.
 */
const EnvFilePath = Config.String('DOTENV_PATH').pipe(Config.withDefault('.env'));

const isFileNotFound = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/**
 * Builds the application's `ConfigProvider`: the given environment first,
 * then the `.env` file (if any) for keys the environment doesn't set. This is
 * the same precedence as dotenv and Node's `--env-file`. `process.env` is
 * never mutated; only Effect `Config` reads see the file's values.
 */
export const loadConfigProvider = Effect.fn('loadConfigProvider')(function* (env: Record<string, string | undefined>) {
  const fromEnvironment = ConfigProvider.fromEnvRecord(env);
  const configured = yield* EnvFilePath.parse(ConfigProvider.fromEnvRecord(env, { preserveEmptyStrings: true }));

  if (configured === '') {
    return fromEnvironment;
  }

  const path = resolve(configured);
  const contents = yield* Effect.tryPromise({
    try: () => readFile(path, 'utf8'),
    catch: (cause) => cause,
  }).pipe(
    Effect.catchIf(isFileNotFound, () => Effect.succeed(undefined)),
    Effect.mapError((cause) => new EnvFileError({ path, message: `cannot read env file: ${String(cause)}` })),
  );

  if (contents === undefined) {
    return fromEnvironment;
  }

  return ConfigProvider.orElse(fromEnvironment, ConfigProvider.fromDotEnvContents(contents));
});

/** Installs {@link loadConfigProvider} over `env` for everything built on top of it. */
export const configProviderLayer = (env: Record<string, string | undefined>) => ConfigProvider.layer(loadConfigProvider(env));

/** {@link configProviderLayer} over `process.env`. */
export const EnvConfigProviderLayer = configProviderLayer(process.env);
