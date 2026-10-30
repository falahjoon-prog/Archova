const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const dir = '/mnt/project-files/handoffs/shots/nova-draft/';
  for (const [scheme, w] of [['light',375],['light',768],['light',1280],['dark',375],['dark',1280]]) {
    const c = await b.newContext({ baseURL: 'http://localhost:3007', viewport: { width: w, height: 900 }, colorScheme: scheme });
    await c.addCookies([{ name: '__Host-sid', value: 'x', domain: 'localhost', path: '/', secure: true }]);
    const p = await c.newPage();
    await p.goto('/shotpage', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Draft with Nova' }).waitFor();
    await p.screenshot({ path: `${dir}${scheme}-${w}-start.png`, fullPage: true });
    await p.getByRole('button', { name: 'Draft with Nova' }).click();
    await p.getByText("Nova's draft is ready").waitFor();
    console.log(scheme, w, 'hscroll', await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth));
    await p.screenshot({ path: `${dir}${scheme}-${w}-ready.png`, fullPage: true });
    await c.close();
  }
  await b.close();
})();
