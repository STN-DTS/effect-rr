import { defineConfig } from 'oxlint';

// ---------------------------------------------------------------------------
// Architecture boundaries (see README "Dependency rules").
// oxlint replaces — not merges — a rule's options when several overrides match
// a file, so each layer's list is built from the outer layers' lists.
// ---------------------------------------------------------------------------

type Restriction = { name: string; message: string } | { regex: string; message: string };

const EFFECT_UNSTABLE_MODULES =
  'ai|cli|cluster|devtools|eventlog|http|http-api|jsonschema|observability|persistence|process|reactivity|rpc|schema|socket|sql|workflow|workers';

const restrict = (rules: ReadonlyArray<Restriction>): ['error', object] => [
  'error',
  {
    paths: rules.filter((r) => 'name' in r),
    patterns: rules.filter((r) => 'regex' in r),
  },
];

const stableEffectOnly = (layer: string): Restriction[] => [
  { regex: '^effect/unstable(/|$)', message: `${layer} uses stable Effect modules only.` },
  {
    // Upstream is dropping the `unstable/` path segment; catch both spellings.
    regex: `^effect/(${EFFECT_UNSTABLE_MODULES})(/|$)`,
    message: `${layer} uses stable Effect modules only (unstable modules without the unstable/ prefix).`,
  },
  { regex: '^@effect/', message: `${layer} uses stable modules from \`effect\` only.` },
];

const SERVER: Restriction[] = [
  { name: 'react', message: 'server/** is UI-agnostic: no React.' },
  { name: 'react-dom', message: 'server/** is UI-agnostic: no React.' },
  { name: 'react-router', message: 'server/** must not depend on the HTTP/UI adapter.' },
  {
    regex: '^(react-dom|react-router|@react-router)/',
    message: 'server/** must not depend on the HTTP/UI adapter.',
  },
  { regex: '(^|/)app(/|$)', message: 'server/** never imports app/**.' },
  { regex: '^~/', message: 'server/** never imports app/** (via the ~ alias).' },
];

const APPLICATION: Restriction[] = [
  ...SERVER,
  {
    regex: '(^|/)infrastructure(/|\\.ts$|$)',
    message: 'application depends on ports, never on adapters (server/infrastructure/**).',
  },
  ...stableEffectOnly('application'),
];

const DOMAIN: Restriction[] = [
  ...SERVER,
  {
    regex: '(^|/)(application|infrastructure)(/|\\.ts$|$)',
    message: 'domain is the innermost layer: no application/ or infrastructure/ imports.',
  },
  ...stableEffectOnly('domain'),
  { regex: '^node:', message: 'domain is pure: no I/O modules.' },
];

const NO_REACT_ROUTER_DOM: Restriction = {
  name: 'react-router-dom',
  message: 'Use `react-router` / `react-router/dom`.',
};

/** Files under app/ that may use Effect: the bridge, the request scope, and per-feature server modules. */
const EFFECT_BRIDGE_FILES = ['app/lib/effect.server.ts', 'app/lib/request.server.ts', 'app/features/**/*.server.ts'];
const EFFECT_ONLY_IN_BRIDGE =
  'Only app/lib/effect.server.ts, app/lib/request.server.ts and feature *.server.ts modules may use Effect.';

const APP_UI: Restriction[] = [
  NO_REACT_ROUTER_DOM,
  { name: 'effect', message: EFFECT_ONLY_IN_BRIDGE },
  { regex: '^effect/', message: EFFECT_ONLY_IN_BRIDGE },
  { regex: '^@effect/', message: EFFECT_ONLY_IN_BRIDGE },
  {
    regex: '(^|/)server/(infrastructure|application|domain|runtime)',
    message: 'UI modules talk to the core only through *.server.ts modules.',
  },
];

const APP_BRIDGE: Restriction[] = [
  NO_REACT_ROUTER_DOM,
  {
    regex: '(^|/)server/infrastructure(/|$)',
    message: 'app/** never imports adapters; they are wired in server/runtime.ts.',
  },
  {
    regex: '^effect/unstable(/|$)',
    message: 'unstable Effect modules are confined to server/infrastructure/**.',
  },
];

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'react', 'jsx-a11y', 'vitest', 'promise', 'node'],
  categories: {
    correctness: 'error',
    suspicious: 'warn',
    perf: 'warn',
  },
  env: { browser: true, node: true, es2024: true },
  ignorePatterns: ['build/**', '.react-router/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  rules: {
    'curly': ['error', 'all'],
    'import/no-cycle': 'error',
    'import/no-unassigned-import': ['warn', { allow: ['**/*.css'] }],
    'jsx-a11y/label-has-associated-control': 'error',
    'no-underscore-dangle': 'off',
    'react/jsx-key': 'error',
    'react/react-in-jsx-scope': 'off',
    'typescript/await-thenable': 'error',
    'typescript/consistent-type-imports': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-misused-promises': 'error',
    'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'assert', 'assert.*', 'expectThrownData'] }],
  },
  overrides: [
    { files: ['server/**'], rules: { 'no-restricted-imports': restrict(SERVER) } },
    { files: ['server/application/**'], rules: { 'no-restricted-imports': restrict(APPLICATION) } },
    { files: ['server/domain/**'], rules: { 'no-restricted-imports': restrict(DOMAIN) } },
    {
      files: ['app/**'],
      excludeFiles: EFFECT_BRIDGE_FILES,
      rules: { 'no-restricted-imports': restrict(APP_UI) },
    },
    { files: EFFECT_BRIDGE_FILES, rules: { 'no-restricted-imports': restrict(APP_BRIDGE) } },
    {
      files: ['test/**', 'e2e/**'],
      rules: {
        'typescript/no-floating-promises': 'off',
        'typescript/no-unsafe-type-assertion': 'off',
        'unicorn/consistent-function-scoping': 'off',
        // e2e steps are sequential by nature.
        'no-await-in-loop': 'off',
      },
    },
  ],
});
