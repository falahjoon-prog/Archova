import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import { hexToBase64, quarantineKey } from '@archova/mod-files';
import {
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type Browser,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function photo(
  browser: Browser,
  orgId: string,
  projectId: string,
  capture?: object,
  module = 'photos',
) {
  const content = `jpeg ${Math.random()}`;
  const sha256 = createHash('sha256').update(content).digest('hex');
  const created = await browser.post(`/v1/orgs/${orgId}/uploads`, {
    filename: 'site.jpg',
    mime: 'image/jpeg',
    sizeBytes: content.length,
    sha256,
    module,
    projectId,
    ...(capture ? { capture } : {}),
  });
  expect(created.statusCode).toBe(201);
  const uploadId = created.json().id as string;
  t.store.put(quarantineKey(decodeId('upload', uploadId)!), content.length, hexToBase64(sha256));
  const done = await browser.post(`/v1/orgs/${orgId}/uploads/${uploadId}/complete`);
  expect(done.statusCode).toBe(200);
  return done.json() as { id: string; version: number };
}

describe('photos.create push command (mobile 03 §3.1)', () => {
  it('accepts a plain site photo once its file has uploaded, completes missing capture details, and replays', async () => {
    const pm = await signUp(t.app, 'photo-pm');
    const other = await signUp(t.app, 'photo-other');
    const org = await createOrg(pm.browser, 'Photo Builders');
    const project = await createProject(pm.browser, org.id, { name: 'Tower Ph', state: 'NSW' });
    const url = `/v1/orgs/${org.id}/sync/push`;
    const push = async (who: typeof pm, payload: object, entityId = randomUUID()) => {
      const res = await who.browser.post(url, {
        mutations: [
          {
            mutationId: randomUUID(),
            command: 'photos.create',
            entityId,
            projectId: project.id,
            baseVersion: null,
            clientAt: new Date().toISOString(),
            payload,
          },
        ],
      });
      expect(res.statusCode).toBe(200);
      return res.json().results[0] as {
        status: string;
        version?: number;
        problem?: { code: string };
      };
    };
    const capture = {
      takenAt: '2026-11-07T01:02:03.000Z',
      timeZone: 'Australia/Sydney',
      location: { lat: -33.86, lng: 151.2, accuracyM: 5, headingDeg: 90, source: 'device' },
    };

    // The file arrived without capture details; the command fills them in once.
    const bare = await photo(pm.browser, org.id, project.id);
    const payload = { projectId: project.id, fileId: bare.id, capture };
    expect(await push(pm, payload)).toMatchObject({ status: 'applied', version: 2 });
    expect(await push(pm, payload)).toMatchObject({ status: 'applied', version: 2 });
    const rows = await t.adminDb.withTenantTx(
      {
        orgId: decodeId('org', org.id)!,
        userId: decodeId('user', pm.userId)!,
        principalType: 'member',
        orgRole: 'owner',
        entitlements: { plan: 'trial', state: 'trialing', modules: [], limits: {} },
        requestId: 'test',
      },
      (s) =>
        s.tx.execute(
          `select taken_at, capture_lat, capture_source from files.file_objects where id = '${decodeId('file', bare.id)}'`,
        ),
    );
    expect(rows.rows[0]).toMatchObject({ capture_lat: -33.86, capture_source: 'device' });

    // Details the upload already carried are kept, so the version does not move.
    const carried = await photo(pm.browser, org.id, project.id, capture);
    expect(
      await push(pm, {
        projectId: project.id,
        fileId: carried.id,
        capture: { takenAt: '2020-01-01T00:00:00.000Z' },
      }),
    ).toMatchObject({ status: 'applied', version: 1 });

    // Not the caller's file, another project's, another kind of file, or a made-up one: not found. Bad capture: invalid.
    // Someone with no access to the organisation never reaches the command.
    expect(
      (
        await other.browser.post(url, {
          mutations: [
            {
              mutationId: randomUUID(),
              command: 'photos.create',
              entityId: randomUUID(),
              projectId: project.id,
              baseVersion: null,
              clientAt: new Date().toISOString(),
              payload,
            },
          ],
        })
      ).statusCode,
    ).toBe(404);
    const defectsFile = await photo(pm.browser, org.id, project.id, undefined, 'defects');
    expect(await push(pm, { projectId: project.id, fileId: defectsFile.id })).toMatchObject({
      status: 'rejected',
      problem: { code: 'file.not_found' },
    });
    expect(
      await push(pm, { projectId: project.id, fileId: bare.id, capture: { takenAt: 'x' } }),
    ).toMatchObject({
      status: 'rejected',
      problem: { code: 'validation_failed' },
    });
    expect(await push(pm, { projectId: project.id })).toMatchObject({
      status: 'rejected',
      problem: { code: 'validation_failed' },
    });
  });
});
