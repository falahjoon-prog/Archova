import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import { hexToBase64, quarantineKey } from '@archova/mod-files';
import {
  clearFlagTargets,
  createOrg,
  createTestContext,
  enableFlag,
  signUp,
  type Browser,
  type TestContext,
} from './helpers';

// Subcontractor compliance wallet (compliance/05): behind the subcontractor_wallet flag, documents stay in the
// company's org, and the words are "recorded" and "sighted", never "verified".
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await clearFlagTargets(t, 'subcontractor_wallet');
  await t.close();
});

/** An organisation-level file (no project), as the wallet needs. */
async function uploadOrgFile(browser: Browser, orgId: string) {
  const bytes = new TextEncoder().encode(`%PDF-1.4 certificate ${Math.random()}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const created = await browser.post(`/v1/orgs/${orgId}/uploads`, {
    filename: 'certificate.pdf',
    mime: 'application/pdf',
    sizeBytes: bytes.length,
    sha256,
    module: 'workforce',
  });
  expect(created.statusCode).toBe(201);
  const uploadId = (created.json() as { id: string }).id;
  t.store.put(
    quarantineKey(decodeId('upload', uploadId)!),
    bytes.length,
    hexToBase64(sha256),
    bytes,
  );
  const done = await browser.post(`/v1/orgs/${orgId}/uploads/${uploadId}/complete`);
  expect(done.statusCode).toBe(200);
  return (done.json() as { id: string }).id;
}

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('compliance wallet', () => {
  it('is unavailable until the flag is on for the org', async () => {
    const u = await signUp(t.app, 'wallet-off');
    const org = await createOrg(u.browser, 'Wallet Off Co');
    const res = await u.browser.get(`/v1/orgs/${org.id}/compliance-documents`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('feature-unavailable');
  });

  it('records, lists, sights, edits and archives a document', async () => {
    const u = await signUp(t.app, 'wallet-on');
    const org = await createOrg(u.browser, 'Wallet On Co');
    await enableFlag(t, 'subcontractor_wallet', org.id);
    const base = `/v1/orgs/${org.id}/compliance-documents`;
    const fileId = await uploadOrgFile(u.browser, org.id);

    // A document needs its file, or to be a declaration.
    const none = await u.browser.post(base, { itemType: 'workers_comp', title: 'Workers comp' });
    expect(none.statusCode).toBe(422);

    const expiring = await u.browser.post(base, {
      itemType: 'public_liability',
      title: 'Public liability',
      number: 'PL-12345678',
      insurer: 'Acme Insurance',
      limitCents: 2_000_000_000,
      expiresOn: day(10),
      fileIds: [fileId],
    });
    expect(expiring.statusCode, expiring.body).toBe(201);
    const pl = expiring.json();
    expect(pl).toMatchObject({ numberLast4: '5678', evidence: 'recorded', expiry: 'expiring' });
    expect(JSON.stringify(pl)).not.toContain('PL-1234');

    const expired = (
      await u.browser.post(base, {
        itemType: 'contractor_licence',
        title: 'Licence',
        issuingState: 'NSW',
        expiresOn: day(-3),
        fileIds: [fileId],
      })
    ).json();
    expect(expired.expiry).toBe('expired');

    const decl = await u.browser.post(base, {
      itemType: 'personal_accident',
      title: 'No employees',
      selfDeclared: true,
    });
    expect(decl.statusCode).toBe(201);
    expect(decl.json()).toMatchObject({ evidence: 'self_declared', expiry: 'no_expiry' });
    const declSight = await u.browser.post(`${base}/${decl.json().id}/sight`, undefined, {
      'if-match': decl.headers.etag as string,
    });
    expect(declSight.statusCode).toBe(422);

    // Soonest expiry first, never-expiring last.
    const list = (await u.browser.get(base)).json().data as Array<{ title: string }>;
    expect(list.map((d) => d.title)).toEqual(['Licence', 'Public liability', 'No employees']);
    expect((await u.browser.get(`${base}?itemType=public_liability`)).json().data).toHaveLength(1);

    const sighted = await u.browser.post(`${base}/${pl.id}/sight`, undefined, {
      'if-match': expiring.headers.etag as string,
    });
    expect(sighted.statusCode).toBe(200);
    expect(sighted.json()).toMatchObject({ evidence: 'sighted' });
    expect(sighted.json().sightedBy).toMatch(/^usr_/);

    // A stale version is refused.
    const stale = await u.browser.patch(
      `${base}/${pl.id}`,
      { title: 'x' },
      { 'if-match': expiring.headers.etag as string },
    );
    expect(stale.statusCode).toBe(412);

    // Fixing a typo in the title keeps the sighting off: what was sighted has changed.
    const edited = await u.browser.patch(
      `${base}/${pl.id}`,
      { expiresOn: day(200) },
      { 'if-match': sighted.headers.etag as string },
    );
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      evidence: 'recorded',
      expiry: 'current',
      sightedBy: null,
    });

    const archived = await u.browser.patch(
      `${base}/${pl.id}`,
      { archived: true },
      { 'if-match': edited.headers.etag as string },
    );
    expect(archived.json().archivedAt).not.toBeNull();
    expect((await u.browser.get(base)).json().data).toHaveLength(2);
    expect((await u.browser.get(`${base}?includeArchived=true`)).json().data).toHaveLength(3);
  });

  it("keeps one company's documents from another's", async () => {
    const a = await signUp(t.app, 'wallet-a');
    const b = await signUp(t.app, 'wallet-b');
    const orgA = await createOrg(a.browser, 'Wallet A Co');
    const orgB = await createOrg(b.browser, 'Wallet B Co');
    await enableFlag(t, 'subcontractor_wallet', orgA.id);
    await enableFlag(t, 'subcontractor_wallet', orgB.id);
    const mine = await a.browser.post(`/v1/orgs/${orgA.id}/compliance-documents`, {
      itemType: 'other',
      title: 'Mine',
      selfDeclared: true,
    });
    expect((await b.browser.get(`/v1/orgs/${orgB.id}/compliance-documents`)).json().data).toEqual(
      [],
    );
    const cross = await b.browser.get(`/v1/orgs/${orgA.id}/compliance-documents`);
    expect([403, 404]).toContain(cross.statusCode);
    const patch = await b.browser.patch(
      `/v1/orgs/${orgB.id}/compliance-documents/${mine.json().id}`,
      { title: 'Stolen' },
      { 'if-match': mine.headers.etag as string },
    );
    expect(patch.statusCode).toBe(404);
  });
});
