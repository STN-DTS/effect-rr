/**
 * The import aliases (`~server/*`, `~app/*`, …) as declared in `tsconfig.json#compilerOptions.paths`,
 * the single source of truth. TypeScript, Vite, Vitest and Playwright read them from there.
 *
 * Plain `node` does not, so importing this module also registers a resolve hook that applies them.
 * Scripts that import aliased code run with it preloaded:
 *
 *   node --import ./scripts/aliases.ts scripts/some-script.ts
 */

import { readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';

const root = new URL('../', import.meta.url);

const tsconfig: { compilerOptions: { paths: Record<string, ReadonlyArray<string>> } } = JSON.parse(
  readFileSync(new URL('tsconfig.json', root), 'utf8'),
);

/**
 * `[alias, target]` pairs, wildcards stripped: `['~server/', './server/']`. Only the first target
 * counts; the fallbacks (e.g. `.react-router/types`) serve type-only imports, which never reach Node.
 */
const aliases = Object.entries(tsconfig.compilerOptions.paths).map(
  ([alias, targets]) => [alias.replace(/\*$/, ''), (targets[0] ?? '').replace(/\*$/, '')] as const,
);

/**
 * The file an aliased specifier points to, or `null` if it is not aliased. A folder resolves to its
 * `index.ts`, as TypeScript and Vite do; Node's ESM resolver rejects folder imports on its own.
 */
export const resolveAlias = (specifier: string): URL | null => {
  const match = aliases.find(([alias]) => {
    return alias.endsWith('/') //
      ? specifier.startsWith(alias)
      : specifier === alias;
  });

  if (match === undefined) {
    return null;
  }

  const target = new URL(match[1] + specifier.slice(match[0].length), root);

  return statSync(target, { throwIfNoEntry: false })?.isDirectory() ? new URL(`${target.href}/index.ts`) : target;
};

registerHooks({
  resolve: (specifier, context, nextResolve) => {
    return nextResolve(resolveAlias(specifier)?.href ?? specifier, context);
  },
});
