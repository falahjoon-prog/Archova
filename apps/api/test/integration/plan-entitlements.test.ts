import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLAN_MODULE_KEYS, operations } from '@archova/contracts';
import { CORE_MODULES } from '@archova/domain';
import { createTestContext, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

/** Modules a route can belong to without a plan listing them. */
const ALWAYS = new Set<string>([...CORE_MODULES, 'billing']);
/** Routes gated by a module key that no plan sells yet (token access has its own rule, see adjustments.ts). */
const UNSOLD = new Set<string>(['api']);

const routeModules = [...new Set(Object.values(operations).map((d) => d.module as string))].filter(
  (m) => !ALWAYS.has(m) && !UNSOLD.has(m),
);

async function published() {
  const rows = (await t.adminDb.db.execute(sql`
    select plan_code, version, modules from billing.plan_versions where status = 'published'`)) as unknown as Array<{
    plan_code: string;
    version: number;
    modules: string[];
  }>;
  return new Map(rows.map((r) => [r.plan_code, r]));
}

describe('plan entitlements', () => {
  it('has exactly one published version per plan, and retired history behind it', async () => {
    const live = await published();
    expect([...live.keys()].sort()).toEqual(['business', 'enterprise', 'subcontractor', 'team']);
    const [retired] = (await t.adminDb.db.execute(
      sql`select count(*)::int as n from billing.plan_versions where status = 'retired' and plan_code in ('team', 'business', 'enterprise')`,
    )) as unknown as Array<{ n: number }>;
    expect(retired?.n ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('lists plant, environment and geotech on every paid plan', async () => {
    const live = await published();
    for (const code of ['team', 'business', 'enterprise']) {
      expect(live.get(code)!.modules, code).toEqual(
        expect.arrayContaining(['plant', 'environment', 'geotech']),
      );
    }
    expect(live.get('subcontractor')!.version).toBe(1);
  });

  it('only lists keys a plan may sell, and Enterprise gates no route behind a missing module', async () => {
    const live = await published();
    for (const v of live.values())
      for (const m of v.modules) expect(PLAN_MODULE_KEYS as readonly string[]).toContain(m);
    const enterprise = new Set(live.get('enterprise')!.modules);
    const unlicensedOnEnterprise = routeModules.filter((m) => !enterprise.has(m));
    expect(unlicensedOnEnterprise).toEqual([]);
  });

  it('never shrinks a plan: each version keeps every module of the one before it', async () => {
    const rows = (await t.adminDb.db.execute(
      sql`select plan_code, version, modules from billing.plan_versions order by plan_code, version`,
    )) as unknown as Array<{ plan_code: string; version: number; modules: string[] }>;
    const prev = new Map<string, string[]>();
    for (const r of rows) {
      const before = prev.get(r.plan_code);
      if (before)
        expect(r.modules, `${r.plan_code} v${r.version}`).toEqual(expect.arrayContaining(before));
      prev.set(r.plan_code, r.modules);
    }
  });
});
