import { afterEach } from 'vitest';

// findBy* and waitFor give up after 1 s by default; a shared CI runner building several Next apps at once can take
// longer than that to render a screen, so wait as long as the test itself may (testTimeout in vitest.config.ts).
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 10_000 });
}

// Testing Library cleanup between component tests (only when a DOM is present).
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
