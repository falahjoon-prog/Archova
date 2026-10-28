import { frontend } from '@archova/config-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

const backendOnly = {
  group: ['@archova/kernel', '@archova/kernel/*', '@archova/mod-*', '@archova/ai-prompts'],
  message: 'Frontend apps never import modules/* or packages/kernel (repo-structure §5).',
};

export default [
  {
    ignores: [
      '.next/**',
      'next-env.d.ts',
      'data/**',
      'app/(payload)/**',
      'payload-types.ts',
      'scripts/**',
    ],
  },
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
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [backendOnly] }] },
  },
];
