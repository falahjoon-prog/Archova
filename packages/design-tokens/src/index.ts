// Single source of design tokens (design/02-design-system.md §2). Components never hard-code hex values;
// web reads CSS variables from `toCssVariables()`, mobile reads `nativeTheme`.

export const color = {
  light: {
    bg: '#F9FAFB',
    surface: '#FFFFFF',
    text: '#111827',
    textSecondary: '#4B5563',
    textMuted: '#6B7280',
    borderControl: '#6B7280',
    borderDivider: '#E5E7EB',
    actionPrimary: '#1F4FC4',
    actionPrimaryHover: '#183E9C',
    actionPrimaryText: '#FFFFFF',
    focusRing: '#1F4FC4',
    statusSuccess: '#157A3D',
    statusWarning: '#A65A00',
    statusDanger: '#B42318',
    statusInfo: '#0B6A9E',
    statusNeutral: '#4B5563',
    ai: '#6D3FD1',
    accentHivis: '#E8590C',
  },
  dark: {
    bg: '#0F141C',
    surface: '#171E29',
    text: '#F3F4F6',
    textSecondary: '#AEB6C2',
    textMuted: '#AEB6C2',
    borderControl: '#AEB6C2',
    borderDivider: '#2A3342',
    actionPrimary: '#7FA3FF',
    actionPrimaryHover: '#A5BEFF',
    actionPrimaryText: '#0F141C',
    focusRing: '#7FA3FF',
    statusSuccess: '#4ADE80',
    statusWarning: '#FBBF24',
    statusDanger: '#F87171',
    statusInfo: '#5CC4F5',
    statusNeutral: '#AEB6C2',
    ai: '#B79CFF',
    accentHivis: '#E8590C',
  },
} as const;

export type ColorToken = keyof typeof color.light;

/** 4 px base spacing scale. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;
export const radius = { sm: 4, md: 6, lg: 8, full: 9999 } as const;
export const font = {
  family: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;
/** Minimum touch target (accessibility 05: 44 px, 48 px in site mode). */
export const touchTarget = { default: 44, siteMode: 48 } as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** CSS custom properties (`--c-text`, `--space-4`…) for light, dark (OS preference) and explicit theme attributes. */
export function toCssVariables(): string {
  const vars = (c: Record<string, string>) =>
    Object.entries(c)
      .map(([k, v]) => `  --c-${kebab(k)}: ${v};`)
      .join('\n');
  const scale = [
    ...Object.entries(space).map(([k, v]) => `  --space-${k}: ${v}px;`),
    ...Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v}px;`),
    ...Object.entries(font.size).map(([k, v]) => `  --font-${k}: ${v}px;`),
    `  --font-family: ${font.family};`,
  ].join('\n');
  return [
    `:root {\n${vars(color.light)}\n${scale}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n${vars(color.dark).replace(/^/gm, '  ')}\n  }\n}`,
    `:root[data-theme='dark'] {\n${vars(color.dark)}\n}`,
  ].join('\n\n');
}

/** React Native theme object. */
export function nativeTheme(scheme: 'light' | 'dark') {
  return { color: color[scheme], space, radius, font, touchTarget };
}
