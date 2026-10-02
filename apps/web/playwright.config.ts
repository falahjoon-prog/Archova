import { defineConfig, devices } from '@playwright/test';

// Accessibility gate (infrastructure/03 §3, design/05 §4, qa/08): axe-core on each journey page, failing on serious
// or critical issues. Runs against A11Y_BASE_URL (the production image in CI, a preview later) or a local
// `next start`.
const baseURL = process.env.A11Y_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Site supervisors use phones on site (design/05).
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
