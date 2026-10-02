import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import { hexToBase64, quarantineKey } from '@archova/mod-files';
import { createOrg, createProject, createTestContext, signUp, type TestContext } from './helpers';

// X32: every org and project has an IANA zone, projects can have a site location and geofence,
// and uploads carry when and where they were captured.

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

describe('time zones', () => {
  it('defaults a project to its state zone and follows the state when it moves', async () => {
    const { browser } = await signUp(t.app, 'tz');
    const org = await createOrg(browser);
    const qld = await createProject(browser, org.id, { name: 'Brisbane job', state: 'QLD' });
    expect(qld.timezone).toBe('Australia/Brisbane');
    const nsw = await createProject(browser, org.id, { name: 'Sydney job', state: 'NSW' });
    expect(nsw.timezone).toBe('Australia/Sydney');

    const moved = await browser.patch(
      `/v1/orgs/${org.id}/projects/${qld.id}`,
      { state: 'WA' },
      { 'if-match': '"1"' },
    );
    expect(moved.json().timezone).toBe('Australia/Perth');

    const broken = await createProject(browser, org.id, {
      name: 'Broken Hill job',
      state: 'NSW',
      timezone: 'Australia/Broken_Hill',
    });
    expect(broken.timezone).toBe('Australia/Broken_Hill');
  });

  it('accepts zones outside Australia and rejects anything that is not an IANA zone', async () => {
    const { browser } = await signUp(t.app, 'tz-global');
    const nz = await browser.post('/v1/orgs', {
      name: 'Kiwi Builds',
      country: 'NZ',
      timezone: 'Pacific/Auckland',
    });
    expect(nz.statusCode).toBe(201);
    expect(nz.json()).toMatchObject({ country: 'NZ', timezone: 'Pacific/Auckland' });

    const org = await createOrg(browser);
    for (const timezone of ['AEST', '+10:00', 'Australia/Gotham']) {
      const res = await browser.post(`/v1/orgs/${org.id}/projects`, { name: 'Bad', timezone });
      expect(res.statusCode, timezone).toBe(422);
      expect(res.json().errors[0].path).toBe('timezone');
    }
  });

  it('refuses an invalid zone at the database too', async () => {
    await expect(
      t.adminDb.db.execute(sql`select 'Australia/Gotham'::kernel.time_zone`),
    ).rejects.toThrow();
    const ok = await t.adminDb.db.execute<{ d: string }>(
      sql`select kernel.local_date('2026-01-15T14:30:00Z', 'Australia/Perth')::text as d`,
    );
    expect(ok.rows[0]!.d).toBe('2026-01-15');
  });
});

describe('site location and geofence', () => {
  it('stores a site point and radius, and needs a point before a radius', async () => {
    const { browser } = await signUp(t.app, 'geo');
    const org = await createOrg(browser);
    const site = { lat: -27.4698, lng: 153.0251 };

    const noPoint = await browser.post(`/v1/orgs/${org.id}/projects`, {
      name: 'Fence only',
      geofenceRadiusM: 200,
    });
    expect(noPoint.statusCode).toBe(422);

    const out = await browser.post(`/v1/orgs/${org.id}/projects`, {
      name: 'Off the map',
      siteLocation: { lat: -95, lng: 153 },
    });
    expect(out.statusCode).toBe(422);

    const p = await createProject(browser, org.id, {
      name: 'Queen St',
      state: 'QLD',
      siteLocation: site,
      geofenceRadiusM: 150,
    });
    expect(p).toMatchObject({ siteLocation: site, geofenceRadiusM: 150 });

    const cleared = await browser.patch(
      `/v1/orgs/${org.id}/projects/${p.id}`,
      { siteLocation: null },
      { 'if-match': '"1"' },
    );
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ siteLocation: null, geofenceRadiusM: null });

    const fenceAgain = await browser.patch(
      `/v1/orgs/${org.id}/projects/${p.id}`,
      { geofenceRadiusM: 100 },
      { 'if-match': '"2"' },
    );
    expect(fenceAgain.statusCode).toBe(422);
  });
});

describe('capture metadata on uploads', () => {
  it('keeps the time, zone and GPS fix the device reported', async () => {
    const { browser } = await signUp(t.app, 'capture');
    const org = await createOrg(browser);
    const project = await createProject(browser, org.id);
    const bytes = 'jpeg bytes';
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const capture = {
      takenAt: '2026-10-04T16:30:00.000Z',
      timeZone: 'Australia/Brisbane',
      location: {
        lat: -27.4698,
        lng: 153.0251,
        accuracyM: 6.5,
        headingDeg: 270,
        source: 'device',
      },
    };
    const created = await browser.post(`/v1/orgs/${org.id}/uploads`, {
      filename: 'IMG_0001.jpg',
      mime: 'image/jpeg',
      sizeBytes: bytes.length,
      sha256,
      module: 'photos',
      projectId: project.id,
      capture,
    });
    expect(created.statusCode).toBe(201);
    const u = created.json();
    t.store.put(quarantineKey(decodeId('upload', u.id)!), bytes.length, hexToBase64(sha256));
    const done = await browser.post(`/v1/orgs/${org.id}/uploads/${u.id}/complete`);
    expect(done.statusCode).toBe(200);
    expect(done.json().capture).toEqual(capture);

    const badZone = await browser.post(`/v1/orgs/${org.id}/uploads`, {
      filename: 'IMG_0002.jpg',
      mime: 'image/jpeg',
      sizeBytes: bytes.length,
      sha256,
      module: 'photos',
      capture: { timeZone: 'Mars/Olympus' },
    });
    expect(badZone.statusCode).toBe(422);
  });

  it('reports no capture when the client sent none', async () => {
    const { browser } = await signUp(t.app, 'capture-none');
    const org = await createOrg(browser);
    const bytes = 'pdf bytes';
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const u = (
      await browser.post(`/v1/orgs/${org.id}/uploads`, {
        filename: 'logo.pdf',
        mime: 'application/pdf',
        sizeBytes: bytes.length,
        sha256,
        module: 'documents',
      })
    ).json();
    t.store.put(quarantineKey(decodeId('upload', u.id)!), bytes.length, hexToBase64(sha256));
    const done = await browser.post(`/v1/orgs/${org.id}/uploads/${u.id}/complete`);
    expect(done.json().capture).toBeNull();
  });
});
