import { frontend } from '@archova/config-eslint';
import globals from 'globals';

export default [
  ...frontend,
  { ignores: ['dist/**', 'ios/**', 'android/**'] },
  {
    // Metro config is CommonJS evaluated by Node.
    files: ['metro.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['app.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Colours come from @archova/design-tokens via @archova/ui-native's useTheme().
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message: 'Use a colour token from useTheme(), not a hex value.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@archova/kernel',
                '@archova/kernel/*',
                '@archova/mod-*',
                '@archova/ai-prompts',
              ],
              message:
                'Frontend apps never import modules/* or packages/kernel (repo-structure §5).',
            },
            {
              group: ['**/features/*/*', '!**/features/*/index'],
              message: 'Import another feature only through its index.ts (docs/mobile/01 §1.2).',
            },
          ],
        },
      ],
    },
  },
];
