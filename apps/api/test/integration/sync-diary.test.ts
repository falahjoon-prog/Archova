import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDateOf } from '@archova/time';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

describe('mobile pull: diary', () => {
  it('sends entries and lines, and a company-scoped reader gets only their own labour', async () => {
    const sm = await signUp(t.app, 'syd-sm');
    const sub = await signUp(t.app, 'syd-sub');
    const other = await signUp(t.app, 'syd-other');
    const org = await createOrg(sm.browser, 'Diary Sync Builder');
    const project = await createProject(sm.browser, org.id, { name: 'Wharf', state: 'QLD' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}/diary`;
    const subCo = await addMember(
      sm.browser,
      org.id,
      project.id,
      sub.email,
      'Subcontractor',
      'Formco',
    );
    const otherCo = await addMember(
      sm.browser,
      org.id,
      project.id,
      other.email,
      'Subcontractor',
      'Sparky',
    );
    const day = addDays(localDateOf(new Date(), 'Australia/Brisbane'), -1);

    const entry = await sm.browser.put(`${base}/${day}`, { notes: 'Pour delayed to 10am.' });
    expect(entry.statusCode).toBe(200);
    const mine = (
      await sm.browser.post(`${base}/${day}/labour`, {
        companyId: subCo.companyId,
        trade: 'Formwork',
        headcount: 6,
        hours: 40,
      })
    ).json();
    const theirs = (
      await sm.browser.post(`${base}/${day}/labour`, {
        companyId: otherCo.companyId,
        trade: 'Electrical',
        headcount: 2,
        hours: 16,
      })
    ).json();
    const delay = (
      await sm.browser.post(`${base}/${day}/delays`, {
        type: 'weather',
        description: 'Rain',
        hours: 2,
        affectedCompanyIds: [subCo.companyId],
      })
    ).json();

    const pull = async (who: typeof sm) =>
      (
        await who.browser.get(
          `/v1/orgs/${org.id}/sync/pull?scopes=${encodeURIComponent(`project:${project.id}:diary`)}&since=0`,
        )
      ).json() as {
        changes: Array<{
          entityType: string;
          id: string;
          op: string;
          data?: Record<string, unknown>;
        }>;
      };

    const full = await pull(sm);
    const byType = (p: typeof full) => p.changes.map((c) => `${c.entityType}:${c.op}`).sort();
    expect(byType(full)).toEqual([
      'diary_delay:upsert',
      'diary_entry:upsert',
      'diary_labour:upsert',
      'diary_labour:upsert',
    ]);
    expect(full.changes.find((c) => c.entityType === 'diary_entry')?.data).toMatchObject({
      date: day,
      notes: 'Pour delayed to 10am.',
      totals: { labourHeadcount: 8 },
    });

    // The subcontractor's device gets the day (header without notes), its own labour, and deletes for the rest.
    const scoped = await pull(sub);
    const get = (p: typeof scoped, id: string) => p.changes.find((c) => c.id === id);
    expect(get(scoped, mine.id)).toMatchObject({ op: 'upsert', data: { trade: 'Formwork' } });
    expect(get(scoped, theirs.id)).toMatchObject({ op: 'delete' });
    expect(get(scoped, delay.id)).toMatchObject({ op: 'delete' });
    const header = scoped.changes.find((c) => c.entityType === 'diary_entry');
    expect(header).toMatchObject({
      op: 'upsert',
      data: { totals: { labourHeadcount: 6, delayHours: 0 } },
    });
    expect(header?.data?.notes).toBeNull();

    // The other subcontractor has labour on the day too, so the day is theirs as well.
    const second = await pull(other);
    expect(second.changes.find((c) => c.entityType === 'diary_entry')).toMatchObject({
      op: 'upsert',
    });
  });
});
