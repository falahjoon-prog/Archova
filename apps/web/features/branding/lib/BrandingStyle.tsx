'use client';

import { useBranding } from '../hooks/useBranding';
import { accentCss } from './colour';

/** Applies the company's accent colour over the brand amber token for everything inside the org shell. */
export function BrandingStyle() {
  const css = accentCss(useBranding().data?.accentColor);
  return css ? <style data-testid="org-accent">{css}</style> : null;
}
