import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeId, uuidv7 } from '@archova/domain';
import { createOrg, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Bm = { id: string; entityType: string; entityId: string; title: string; subtitle: string };

describe('bookmarks', () => {
  it('saves, lists, refreshes and removes a person’s own bookmarks', async () => {
    const ana = await signUp(t.app, 'bmk-ana');
    const ben = await signUp(t.app, 'bmk-ben');
    const org = await createOrg(ana.browser, 'Bookmark Builders');
    const benOrg = await createOrg(ben.browser, 'Other Builders');
    const base = `/v1/orgs/${org.id}/bookmarks`;
    const project = encodeId('project', uuidv7());
    const otherProject = encodeId('project', uuidv7());
    const rfi = encodeId('rfi', uuidv7());
    const sheet = encodeId('drawingSheet', uuidv7());

    const saved = await ana.browser.post(base, {
      entityType: 'rfi',
      entityId: rfi,
      projectId: project,
      title: 'RFI-012 Slab edge',
      subtitle: 'Open',
    });
    expect(saved.statusCode).toBe(200);
    const first = saved.json() as Bm;
    expect(first.id).toMatch(/^bmk_/);
    expect(first.entityId).toBe(rfi);

    // Saving the same record again keeps one bookmark and refreshes its title.
    const again = await ana.browser.post(base, {
      entityType: 'rfi',
      entityId: rfi,
      projectId: project,
      title: 'RFI-012 Slab edge (answered)',
    });
    expect((again.json() as Bm).id).toBe(first.id);
    expect((again.json() as Bm).title).toBe('RFI-012 Slab edge (answered)');
    expect((again.json() as Bm).subtitle).toBe('');

    await ana.browser.post(base, {
      entityType: 'drawing_sheet',
      entityId: sheet,
      projectId: otherProject,
      title: 'A-101 Ground floor',
    });
    const list = (await ana.browser.get(base)).json() as { data: Bm[] };
    expect(list.data.map((b) => b.entityType)).toEqual(['drawing_sheet', 'rfi']);
    const filtered = (await ana.browser.get(`${base}?projectId=${project}`)).json() as {
      data: Bm[];
    };
    expect(filtered.data.map((b) => b.entityType)).toEqual(['rfi']);

    // A bookmark whose id is of the wrong kind is rejected.
    const wrong = await ana.browser.post(base, {
      entityType: 'rfi',
      entityId: sheet,
      projectId: project,
      title: 'Wrong kind',
    });
    expect(wrong.statusCode).toBe(422);

    // Another person never sees it, and cannot remove it.
    const benList = (await ben.browser.get(`/v1/orgs/${benOrg.id}/bookmarks`)).json() as {
      data: Bm[];
    };
    expect(benList.data).toEqual([]);
    expect((await ben.browser.del(`/v1/orgs/${benOrg.id}/bookmarks/${first.id}`)).statusCode).toBe(
      204,
    );
    expect(((await ana.browser.get(base)).json() as { data: Bm[] }).data).toHaveLength(2);

    // Removing is idempotent.
    expect((await ana.browser.del(`${base}/${first.id}`)).statusCode).toBe(204);
    expect((await ana.browser.del(`${base}/${first.id}`)).statusCode).toBe(204);
    expect(((await ana.browser.get(base)).json() as { data: Bm[] }).data).toHaveLength(1);
  });
});
