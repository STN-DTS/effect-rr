/**
 * Architecture checks that oxlint's `no-restricted-imports` cannot express.
 *
 * 1. Resolved-path layering. oxlint matches import *specifiers* as text; this
 *    resolves relative and `~/` specifiers to real files, so a rule can't be
 *    dodged with an alias or an unusual relative path.
 * 2. Version pinning. Every `effect` / `@effect/*` dependency must be an exact
 *    version and all must be the same (v4 ships as one lock-stepped release).
 *
 * Run with `node scripts/check-boundaries.ts` (Node strips the types).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

const root = process.cwd();
const failures: string[] = [];

// --- 1. resolved-path layering ---------------------------------------------

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return walk(path);
    }

    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });

const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

const specifiers = (source: string) => [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

/** Repo-relative, POSIX-style target of a local specifier, or null for packages. */
const resolveLocal = (from: string, specifier: string): string | null => {
  let target: string;

  if (specifier.startsWith('~/')) {
    target = join(root, 'app', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    target = join(dirname(from), specifier);
  } else {
    return null;
  }

  return relative(root, normalize(target)).split(sep).join('/');
};

type Rule = { readonly from: RegExp; readonly forbid: RegExp; readonly why: string };
const RULES: ReadonlyArray<Rule> = [
  { from: /^server\//, forbid: /^app\//, why: 'server/** never imports app/**' },
  {
    from: /^server\/domain\//,
    forbid: /^server\/(application|infrastructure)\/|^server\/runtime/,
    why: 'domain is the innermost layer',
  },
  {
    from: /^server\/application\//,
    forbid: /^server\/(infrastructure\/|runtime)/,
    why: 'application depends on ports, not adapters',
  },
  { from: /^app\//, forbid: /^server\/infrastructure\//, why: 'app/** never imports adapters' },
];

for (const file of [...walk(join(root, 'server')), ...walk(join(root, 'app'))]) {
  const rel = relative(root, file).split(sep).join('/');

  for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
    const target = resolveLocal(file, specifier);

    if (target === null) {
      continue;
    }

    for (const rule of RULES) {
      if (rule.from.test(rel) && rule.forbid.test(target)) {
        failures.push(`${rel}: imports ${target} (${rule.why})`);
      }
    }
  }
}

// --- 2. lock-stepped, exact Effect versions ---------------------------------

const pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const effectDeps = Object.entries(deps).filter(([name]) => name === 'effect' || name.startsWith('@effect/'));

for (const [name, version] of effectDeps) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    failures.push(`${name}@${version} is not pinned exactly`);
  }
}

if (new Set(effectDeps.map(([, v]) => v)).size > 1) {
  failures.push(`effect packages must share one version: ${effectDeps.map(([n, v]) => `${n}@${v}`).join(', ')}`);
}

if ('react-router-dom' in deps) {
  failures.push('react-router-dom must not be a dependency (use react-router)');
}

if (failures.length > 0) {
  console.error(`Architecture check failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}

console.log(`Architecture check passed (${effectDeps.length} effect packages @ ${effectDeps[0]?.[1]}).`);
