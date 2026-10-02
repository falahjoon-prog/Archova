import { afterEach } from 'vitest';

// Testing Library cleanup between component tests (only when a DOM is present).
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
