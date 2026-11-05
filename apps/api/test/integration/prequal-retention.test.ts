import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import type { TenantContext } from '@archova/kernel';
import {
  addMember,
  clearFlagTargets,
  createOrg,
  createProject,
  createTestContext,
  enableFlag,
  signUp,
  type TestContext,
} from './helpers';

// Decided prequalification forms, and the question sets they were answered against, are kept 7 years and cannot be
// deleted (compliance/07), so a company's history survives expiry and renewal.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await clearFlagTargets(t, 'subcontractor_prequalification');
  await t.close();
});

describe('prequalification retention', () => {
  it('keeps approved and rejected forms and their question set, and refuses deleting them', async () => {
    const pm = await signUp(t.app, 'pqret-pm');
    const sub = await signUp(t.app, 'pqret-sub');
    const org = await createOrg(pm.browser, 'Retain Builders');
    await enableFlag(t, 'subcontractor_prequalification', org.id);
    const project = await createProject(pm.browser, org.id, { name: 'Tower R', state: 'QLD' });
    const co = await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sub R');
    const base = `/v1/orgs/${org.id}`;
    const b = pm.browser;

    const tpl = await b.post(`${base}/prequal-templates`, {
      name: 'Retention form',
      questions: [
        {
          id: 'cover',
          section: '',
          prompt: 'Do you hold insurance?',
          type: 'yes_no',
          options: [],
          required: true,
          expect: 'yes',
          points: 10,
          critical: false,
        },
      ],
    });
    const published = await b.post(
      `${base}/prequal-templates/${tpl.json().id}/publish`,
      undefined,
      {
        'if-match': tpl.headers.etag as string,
      },
    );
    const submit = async () => {
      const form = await b.post(`${base}/prequalifications`, {
        companyId: co.companyId,
        templateId: published.json().id,
      });
      const saved = await b.patch(
        `${base}/prequalifications/${form.json().id}`,
        { answers: { cover: true } },
        { 'if-match': form.headers.etag as string },
      );
      const sent = await b.post(`${base}/prequalifications/${form.json().id}/submit`, undefined, {
        'if-match': saved.headers.etag as string,
      });
      return { id: form.json().id as string, etag: sent.headers.etag as string };
    };
    const a = await submit();
    const approved = await b.post(
      `${base}/prequalifications/${a.id}/approve`,
      {},
      { 'if-match': a.etag },
    );
    expect(approved.statusCode, approved.body).toBe(200);
    const r = await submit();
    const rejected = await b.post(
      `${base}/prequalifications/${r.id}/reject`,
      { note: 'No cover' },
      { 'if-match': r.etag },
    );
    expect(rejected.statusCode, rejected.body).toBe(200);

    // Both decided forms stay listed, newest first, for the compliance history.
    const history = await b.get(`${base}/prequalifications?companyId=${co.companyId}`);
    expect(history.json().data).toHaveLength(2);

    const ctx: TenantContext = {
      orgId: decodeId('org', org.id)!,
      userId: '00000000-0000-0000-0000-000000000000',
      principalType: 'member',
      orgRole: null,
      entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
      requestId: 'test',
    };
    const rows = await t.database.withTenantTx(ctx, (sc) =>
      sc.tx.execute(
        sql`select record_type, count(*)::int as n, bool_and(retain_until > now() + interval '6 years') as long_enough
            from shared.retention_ledger where category = 'prequalification_7y'
            group by record_type order by record_type collate "C"`,
      ),
    );
    expect(rows.rows).toEqual([
      { record_type: 'precon.prequal_templates', n: 1, long_enough: true },
      { record_type: 'precon.prequalifications', n: 2, long_enough: true },
    ]);
    for (const table of ['precon.prequalifications', 'precon.prequal_templates'])
      await expect(
        t.database.withTenantTx(ctx, (sc) => sc.tx.execute(sql.raw(`delete from ${table}`))),
      ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/retention/) } });
  });
});
