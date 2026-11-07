import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

/** A 1 x 1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function setup() {
  const pm = await signUp(t.app, 'pt-pm');
  const org = await createOrg(pm.browser, 'Photo Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const photo = (module = 'photos', name = 'site.png') =>
    uploadBytes(t, pm.browser, org.id, project.id, PNG, name, 'image/png', module);
  return { pm, org, project, base, photo };
}

describe('project photo library tags', () => {
  it('lists only team photos, filters by tag, area, trade and age, and counts the facets', async () => {
    const s = await setup();
    const a = await s.photo('photos', 'a.png');
    const b = await s.photo('diary', 'b.png');
    await s.photo('safety', 'incident.png');

    const all = (await s.pm.browser.get(`${s.base}/photos`)).json();
    expect(all.data).toHaveLength(2);
    expect(all.data.every((p: { tags: unknown }) => p.tags === null)).toBe(true);
    expect(all.facets).toEqual({ areas: [], trades: [] });

    const put = await s.pm.browser.put(`${s.base}/photos/${a}/tags`, {
      area: ' Level  2 ',
      trade: 'concrete',
      tags: ['Slab', 'slab', 'formwork'],
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().tags).toEqual({
      area: 'Level 2',
      trade: 'concrete',
      tags: ['slab', 'formwork'],
      source: 'person',
    });
    await s.pm.browser.put(`${s.base}/photos/${b}/tags`, { area: 'Level 3', trade: 'painting' });

    const byArea = (await s.pm.browser.get(`${s.base}/photos?area=level%202`)).json();
    expect(byArea.data.map((p: { file: { id: string } }) => p.file.id)).toEqual([a]);
    const byTrade = (await s.pm.browser.get(`${s.base}/photos?trade=painting`)).json();
    expect(byTrade.data.map((p: { file: { id: string } }) => p.file.id)).toEqual([b]);
    const byTag = (await s.pm.browser.get(`${s.base}/photos?tag=FORMWORK`)).json();
    expect(byTag.data.map((p: { file: { id: string } }) => p.file.id)).toEqual([a]);
    expect((await s.pm.browser.get(`${s.base}/photos?sinceDays=1`)).json().data).toHaveLength(2);

    // Facets cover the whole gallery, not the filtered view.
    expect(byTag.facets.areas.map((x: { value: string }) => x.value).sort()).toEqual([
      'Level 2',
      'Level 3',
    ]);
    expect(byTag.facets.trades.map((x: { value: string }) => x.value).sort()).toEqual([
      'concrete',
      'painting',
    ]);

    // Clearing removes the tags.
    const cleared = await s.pm.browser.put(`${s.base}/photos/${a}/tags`, { tags: [] });
    expect(cleared.json().tags).toBeNull();
    expect((await s.pm.browser.get(`${s.base}/photos?area=Level%202`)).json().data).toEqual([]);
  });

  it('suggests tags with Nova, and keeps them only when the person confirms', async () => {
    const s = await setup();
    const fileId = await s.photo();
    const sug = await s.pm.browser.post(`${s.base}/ai/photos/tag-suggestions`, {
      photo: { fileId },
      note: 'Level 4 concrete pour, formwork stripped',
      knownAreas: ['level 4'],
    });
    expect(sug.statusCode).toBe(200);
    const body = sug.json();
    expect(body.runId).toMatch(/^air_/);
    expect(body.trade).toBe('concrete');
    expect(body.area?.toLowerCase()).toBe('level 4');

    // Nothing is kept until the person confirms.
    expect((await s.pm.browser.get(`${s.base}/photos`)).json().data[0].tags).toBeNull();
    const confirm = await s.pm.browser.put(`${s.base}/photos/${fileId}/tags`, {
      area: body.area,
      trade: body.trade,
      tags: body.tags,
      novaRunId: body.runId,
    });
    expect(confirm.json().tags.source).toBe('nova');
    expect((await s.pm.browser.get(`${s.base}/photos`)).json().data[0].tags.trade).toBe('concrete');
  });

  it('refuses tags on a file that is not a photo of this project', async () => {
    const s = await setup();
    const other = await createProject(s.pm.browser, s.org.id, { name: 'Other', state: 'NSW' });
    const fileId = await s.photo();
    const res = await s.pm.browser.put(
      `/v1/orgs/${s.org.id}/projects/${other.id}/photos/${fileId}/tags`,
      { area: 'Level 1' },
    );
    expect(res.statusCode).toBe(404);
  });
});
