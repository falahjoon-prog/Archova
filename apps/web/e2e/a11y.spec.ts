import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Pages reachable without signing in. Signed-in journeys join once preview environments have seed data.
const pages = [
  { name: 'sign in', path: '/login' },
  { name: 'sign up', path: '/signup' },
  { name: 'not found', path: '/this-page-does-not-exist' },
  // The worker induction runs on preview data until the workforce endpoints land (X58).
  { name: 'worker induction', path: '/i/demo' },
];

for (const p of pages) {
  test(`${p.name} has no serious or critical accessibility issues`, async ({ page }) => {
    await page.goto(p.path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const summary = blocking.map(
      (v) =>
        `${v.impact}: ${v.id} (${v.help}) on ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
    expect(summary, summary.join('\n')).toEqual([]);
  });
}
