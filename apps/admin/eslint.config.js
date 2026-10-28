import { frontend } from '@archova/config-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

const backendOnly = {
  group: ['@archova/kernel', '@archova/kernel/*', '@archova/mod-*', '@archova/ai-prompts'],
  message: 'Frontend apps never import modules/* or packages/kernel (repo-structure §5).',
};

// frontend 01 §3: features import each other only through their public index.ts.
const featureInternals = {
  regex: '^@/features/[^/]+/.+',
  message: 'Import another feature only through its index.ts (@/features/<name>).',
};

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...frontend,
  {
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['app/**/*.{ts,tsx}', 'features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [backendOnly, featureInternals] }],
    },
  },
  {
    files: ['shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            backendOnly,
            {
              group: ['@/features', '@/features/*', '@/app', '@/app/*'],
              message: 'shared/ never imports features or app.',
            },
          ],
        },
      ],
    },
  },
];
