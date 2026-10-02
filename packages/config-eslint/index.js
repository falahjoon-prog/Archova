// Shared ESLint flat configs for Archova. Boundary rules follow
// docs/architecture/repo-structure.md §5 and ADR-0006; tools/boundaries checks
// the same rules at the package.json level.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ignores = {
  ignores: ['**/dist/**', '**/.next/**', '**/generated/**', '**/node_modules/**', '**/.expo/**'],
};

// Session-level SET is banned: tenant context must be transaction scoped
// (multi-tenancy.md §2, backend 02 §2). Only `SET LOCAL` / set_config(..., true) are allowed.
const sessionSetMessage =
  'Session-level SET is banned. Use SET LOCAL (or set_config(..., true)) inside withTenantTx.';
// Matches SQL (`SET x = ...`, `SET SESSION x TO ...`), not prose such as 'Set the site first'.
const noSessionSet = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        'Literal[value=/^\\s*SET\\s+(?:SESSION\\s+)?(?!(?:LOCAL|TRANSACTION)\\b)[\\w.\"]+\\s*(?:=|TO\\b)/i]',
      message: sessionSetMessage,
    },
    {
      selector:
        'TemplateElement[value.raw=/^\\s*SET\\s+(?:SESSION\\s+)?(?!(?:LOCAL|TRANSACTION)\\b)[\\w.\"]+\\s*(?:=|TO\\b)/i]',
      message: sessionSetMessage,
    },
  ],
};

export const base = [
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'warn',
    },
  },
];

const frontendOnly = [
  '@archova/ui',
  '@archova/ui/*',
  '@archova/ui-native',
  '@archova/ui-native/*',
  '@archova/api-client',
  '@archova/api-client/*',
  '@archova/sync-core',
  '@archova/sync-core/*',
  '@archova/auth-client',
  '@archova/auth-client/*',
  '@archova/query',
  '@archova/query/*',
];

const backendOnly = [
  '@archova/kernel',
  '@archova/kernel/*',
  '@archova/mod-*',
  '@archova/ai-prompts',
];

/** Backend code: apps/api, apps/worker, apps/realtime, modules/*, packages/kernel. */
export const node = [
  ...base,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...noSessionSet,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: frontendOnly, message: 'Backend code never imports client packages.' },
            {
              group: ['@archova/mod-*/*'],
              message: 'Import another module only through its public index (package root).',
            },
          ],
        },
      ],
    },
  },
];

/** Pure TS shared packages: domain, routes, markup, sync-core, contracts, query, api-client. */
export const pure = [
  ...base,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'react-dom/*',
                'next',
                'next/*',
                'react-native',
                'react-native/*',
              ],
              message: 'Pure packages never import React, Next.js or React Native (ADR-0006).',
            },
            {
              group: ['node:*', 'fs', 'path', 'crypto', 'pg', 'drizzle-orm', 'drizzle-orm/*'],
              message: 'Pure packages never use Node-only APIs or the database (ADR-0006).',
            },
            { group: backendOnly, message: 'Pure packages never import backend code.' },
          ],
        },
      ],
    },
  },
  // Tests run in Node and may use it.
  { files: ['test/**', '**/*.test.ts'], rules: { 'no-restricted-imports': 'off' } },
];

/** Frontend apps and UI packages: apps/web, apps/mobile, apps/admin, ui, ui-native. */
export const frontend = [
  ...base,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: backendOnly,
              message:
                'Frontend apps never import modules/* or packages/kernel (repo-structure §5).',
            },
          ],
        },
      ],
    },
  },
];

export default base;
