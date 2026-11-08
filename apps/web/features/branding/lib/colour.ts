/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/** Text on the accent: the brand ink or white, whichever reads better (amber always takes ink; white fails on it). */
export function textOn(hex: string, ink = '#18222B'): string {
  const l = luminance(hex);
  const withInk = (l + 0.05) / (luminance(ink) + 0.05);
  const withWhite = 1.05 / (l + 0.05);
  return withInk >= withWhite ? ink : '#FFFFFF';
}

/** CSS that swaps the brand amber for the company's accent; nothing else in the token set changes. */
export function accentCss(accent: string | null | undefined): string | null {
  if (!accent || !isHex(accent)) return null;
  return `:root{--brand-amber:${accent};--brand-amber-text:${textOn(accent)};}`;
}
