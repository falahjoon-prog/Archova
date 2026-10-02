import { frontend } from '@archova/config-eslint';

export default [
  ...frontend,
  {
    rules: {
      // Colours come from @archova/design-tokens only (design 02 §2).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message: 'Use a colour token from useTheme(), not a hex value.',
        },
      ],
    },
  },
];
