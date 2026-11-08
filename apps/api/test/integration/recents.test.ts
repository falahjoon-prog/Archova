import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeId, uuidv7 } from '@archova/domain';
import { createOrg, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Rv = { entityType: string; entityId: string; projectId: string; title: string };

describe('recents', () => {
  it('records, reorders, filters and isolates a person’s own recent views', async () => {
    const ana = await signUp(t.app, 'rcn-ana');
    const ben = await signUp(t.app, 'rcn-ben');
    const org = await createOrg(ana.browser, 'Recents Builders');
    const benOrg = await createOrg(ben.browser, 'Other Builders');
    const base = `/v1/orgs/${org.id}/recents`;
    const project = encodeId('project', uuidv7());
    const otherProject = encodeId('project', uuidv7());
    const rfi = encodeId('rfi', uuidv7());
    const sheet = encodeId('drawingSheet', uuidv7());

    const body = (entityType: string, entityId: string, projectId: string, title: string) => ({
      entityType,
      entityId,
      projectId,
      title,
    });
    expect(
      (await ana.browser.post(base, body('rfi', rfi, project, 'RFI-012 Slab'))).statusCode,
    ).toBe(204);
    await ana.browser.post(base, body('drawing_sheet', sheet, otherProject, 'A-101 Plan'));
    // Opening the RFI again moves it to the top and refreshes its title; there is still one row for it.
    await ana.browser.post(base, body('rfi', rfi, project, 'RFI-012 Slab edge'));

    const list = (await ana.browser.get(base)).json() as { data: Rv[] };
    expect(list.data.map((r) => r.entityType)).toEqual(['rfi', 'drawing_sheet']);
    expect(list.data[0]!.title).toBe('RFI-012 Slab edge');
    expect(list.data[0]!.entityId).toBe(rfi);

    const filtered = (await ana.browser.get(`${base}?projectId=${project}`)).json() as {
      data: Rv[];
    };
    expect(filtered.data.map((r) => r.entityType)).toEqual(['rfi']);
    const limited = (await ana.browser.get(`${base}?limit=1`)).json() as { data: Rv[] };
    expect(limited.data).toHaveLength(1);

    // An id of the wrong kind is rejected.
    const wrong = await ana.browser.post(base, body('rfi', sheet, project, 'Wrong kind'));
    expect(wrong.statusCode).toBe(422);

    // Another person sees none of it.
    const benList = (await ben.browser.get(`/v1/orgs/${benOrg.id}/recents`)).json() as {
      data: Rv[];
    };
    expect(benList.data).toEqual([]);
  });
});
