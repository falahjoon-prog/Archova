import { nativeTheme } from '@archova/design-tokens';
import { useColorScheme } from 'react-native';

export type NativeTheme = ReturnType<typeof nativeTheme>;

/** Current theme from design tokens, following the OS light/dark setting. Components never hard-code colours. */
export function useTheme(): NativeTheme {
  const scheme = useColorScheme();
  return nativeTheme(scheme === 'dark' ? 'dark' : 'light');
}

/** React Native wants a numeric fontWeight as a string literal union. */
export function fontWeight(w: number): '400' | '500' | '600' | '700' {
  if (w >= 700) return '700';
  if (w >= 600) return '600';
  if (w >= 500) return '500';
  return '400';
}
