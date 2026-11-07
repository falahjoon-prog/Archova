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

const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, n]);

describe('site photo albums', () => {
  it('files photos by where they were taken, then by what a person files them under', async () => {
    const { browser } = await signUp(t.app, 'photos-a');
    const org = await createOrg(browser);
    const project = await createProject(browser, org.id);
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const up = (n: number, module: string) =>
      uploadBytes(t, browser, org.id, project.id, jpeg(n), `p${n}.jpg`, 'image/jpeg', module);
    const loose = await up(1, 'photos');
    const defect = await up(2, 'defects');
    await up(3, 'diary');

    const albums = (await browser.get(`${base}/photo-albums`)).json();
    const count = (c: string) =>
      albums.auto.find((a: { category: string }) => a.category === c)?.count;
    expect(count('unclassified')).toBe(1);
    expect(count('punch_list')).toBe(1);
    expect(count('daily_log')).toBe(1);
    expect(
      albums.auto.find((a: { category: string }) => a.category === 'unclassified').cover.url,
    ).toBeTruthy();

    const punch = (await browser.get(`${base}/photos/browse?album=punch_list`)).json();
    expect(punch.data.map((p: { file: { id: string } }) => p.file.id)).toEqual([defect]);

    // A person files the loose photo under the punch list; it moves albums.
    const filed = await browser.put(`${base}/photos/${loose}/filing`, { category: 'punch_list' });
    expect(filed.statusCode).toBe(200);
    expect(filed.json()).toMatchObject({ category: 'punch_list', source: 'manual', refId: null });
    const after = (await browser.get(`${base}/photos/browse?album=punch_list&limit=1`)).json();
    expect(after.data).toHaveLength(1);
    expect(after.next).toBeTruthy();
    const page2 = (
      await browser.get(`${base}/photos/browse?album=punch_list&limit=1&cursor=${after.next}`)
    ).json();
    expect(page2.data).toHaveLength(1);
    expect(page2.next).toBeNull();
    expect(
      (await browser.get(`${base}/photo-albums`))
        .json()
        .auto.find((a: { category: string }) => a.category === 'unclassified').count,
    ).toBe(0);

    // Search by file name.
    const found = (await browser.get(`${base}/photos/browse?q=p3`)).json();
    expect(found.data).toHaveLength(1);
  });

  it('keeps project albums, rejects duplicates and never leaks across orgs', async () => {
    const { browser } = await signUp(t.app, 'photos-b');
    const org = await createOrg(browser);
    const project = await createProject(browser, org.id);
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const photo = await uploadBytes(
      t,
      browser,
      org.id,
      project.id,
      jpeg(9),
      'q.jpg',
      'image/jpeg',
      'photos',
    );

    const created = await browser.post(`${base}/photo-albums`, { name: 'Level 3' });
    expect(created.statusCode).toBe(201);
    const album = created.json();
    expect((await browser.post(`${base}/photo-albums`, { name: 'level 3' })).json().code).toBe(
      'photo_album.name_taken',
    );
    expect((await browser.put(`${base}/photo-albums/${album.id}/photos/${photo}`)).statusCode).toBe(
      204,
    );
    expect((await browser.put(`${base}/photo-albums/${album.id}/photos/${photo}`)).statusCode).toBe(
      204,
    );
    expect((await browser.get(`${base}/photos/browse?album=${album.id}`)).json().data).toHaveLength(
      1,
    );
    expect((await browser.get(`${base}/photo-albums`)).json().own[0]).toMatchObject({
      name: 'Level 3',
      count: 1,
    });

    const other = await signUp(t.app, 'photos-c');
    const otherOrg = await createOrg(other.browser, 'Other Co');
    // Another org sees none of it, even with the project id.
    const denied = await other.browser.get(
      `/v1/orgs/${otherOrg.id}/projects/${project.id}/photos/browse`,
    );
    expect(denied.statusCode === 200 ? denied.json().data : []).toHaveLength(0);
    const deniedAlbums = await other.browser.get(
      `/v1/orgs/${otherOrg.id}/projects/${project.id}/photo-albums`,
    );
    expect(deniedAlbums.statusCode === 200 ? deniedAlbums.json().own : []).toHaveLength(0);

    expect((await browser.del(`${base}/photo-albums/${album.id}/photos/${photo}`)).statusCode).toBe(
      204,
    );
    expect((await browser.del(`${base}/photo-albums/${album.id}`)).statusCode).toBe(204);
    expect((await browser.get(`${base}/photo-albums`)).json().own).toHaveLength(0);
    expect((await browser.get(`${base}/photos/browse`)).json().data).toHaveLength(1);
  });
});
