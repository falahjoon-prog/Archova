import { toCssVariables } from '@archova/design-tokens';

const css = toCssVariables();

/** Injects the design-token CSS variables (`--c-*`, `--space-*`…). Render once in the root layout's <head>. */
export function ThemeStyle() {
  return <style id="archova-tokens" dangerouslySetInnerHTML={{ __html: css }} />;
}
