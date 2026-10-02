import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hexToBase64, quarantineKey } from '@archova/mod-files';
import { decodeId } from '@archova/domain';
import { createTestContext, createOrg, createProject, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const content = 'drawing bytes';
const sha256 = createHash('sha256').update(content).digest('hex');
const upload = {
  filename: 'A-101 Level 1.pdf',
  mime: 'application/pdf',
  sizeBytes: content.length,
  sha256,
  module: 'documents',
};

describe('file upload (backend 06)', () => {
  it('presigns, verifies, stores under the org prefix and issues a short download link', async () => {
    const { browser } = await signUp(t.app, 'files');
    const org = await createOrg(browser);
    const project = await createProject(browser, org.id);

    const created = await browser.post(`/v1/orgs/${org.id}/uploads`, {
      ...upload,
      projectId: project.id,
    });
    expect(created.statusCode).toBe(201);
    const u = created.json();
    expect(u).toMatchObject({ status: 'pending', uploadMethod: 'PUT' });
    expect(u.uploadHeaders['x-amz-checksum-sha256']).toBe(hexToBase64(sha256));

    const notYet = await browser.post(`/v1/orgs/${org.id}/uploads/${u.id}/complete`);
    expect(notYet.json().code).toBe('upload.not_received');

    // The client PUTs straight to storage.
    const uploadUuid = decodeId('upload', u.id)!;
    t.store.put(quarantineKey(uploadUuid), content.length, hexToBase64(sha256));
    const done = await browser.post(`/v1/orgs/${org.id}/uploads/${u.id}/complete`);
    expect(done.statusCode).toBe(200);
    const file = done.json();
    expect(file).toMatchObject({
      status: 'ready',
      filename: upload.filename,
      projectId: project.id,
      sizeBytes: content.length,
    });

    const orgUuid = decodeId('org', org.id)!;
    const projectUuid = decodeId('project', project.id)!;
    const fileUuid = decodeId('file', file.id)!;
    expect(t.store.keys()).toContain(
      `orgs/${orgUuid}/projects/${projectUuid}/documents/${fileUuid}/original`,
    );
    expect(t.store.keys()).not.toContain(quarantineKey(uploadUuid));

    // Completing twice is idempotent.
    expect((await browser.post(`/v1/orgs/${org.id}/uploads/${u.id}/complete`)).json().id).toBe(
      file.id,
    );

    const link = await browser.get(`/v1/orgs/${org.id}/files/${file.id}/download`);
    expect(link.statusCode).toBe(200);
    expect(link.json().url).toContain('attachment');
    expect(new Date(link.json().expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      5 * 60 * 1000,
    );
  });

  it('rejects disallowed types and size mismatches', async () => {
    const { browser } = await signUp(t.app, 'files2');
    const org = await createOrg(browser);
    const bad = await browser.post(`/v1/orgs/${org.id}/uploads`, {
      ...upload,
      mime: 'application/x-msdownload',
    });
    expect(bad.json().code).toBe('upload.mime_not_allowed');

    const u = (await browser.post(`/v1/orgs/${org.id}/uploads`, upload)).json();
    t.store.put(quarantineKey(decodeId('upload', u.id)!), content.length + 1, null);
    const res = await browser.post(`/v1/orgs/${org.id}/uploads/${u.id}/complete`);
    expect(res.json().code).toBe('upload.size_mismatch');
  });

  it('enforces upload permission and hides uploads and files from other users', async () => {
    const owner = await signUp(t.app, 'owner');
    const subbie = await signUp(t.app, 'subbie');
    const org = await createOrg(owner.browser);
    const project = await createProject(owner.browser, org.id);
    const company = (
      await owner.browser.post(`/v1/orgs/${org.id}/companies`, {
        name: 'Sub',
        type: 'subcontractor',
      })
    ).json();
    const templates = (await owner.browser.get(`/v1/orgs/${org.id}/permission-templates`)).json()
      .data;
    await owner.browser.post(`/v1/orgs/${org.id}/projects/${project.id}/members`, {
      email: subbie.email,
      companyId: company.id,
      permissionTemplateId: templates.find((x: { name: string }) => x.name === 'Subcontractor').id,
    });

    // Subcontractors have read on documents: they cannot upload there.
    const denied = await subbie.browser.post(`/v1/orgs/${org.id}/uploads`, {
      ...upload,
      projectId: project.id,
    });
    expect(denied.statusCode).toBe(403);

    const u = (
      await owner.browser.post(`/v1/orgs/${org.id}/uploads`, { ...upload, projectId: project.id })
    ).json();
    expect(
      (await subbie.browser.post(`/v1/orgs/${org.id}/uploads/${u.id}/complete`)).json().code,
    ).toBe('upload.not_found');
    t.store.put(quarantineKey(decodeId('upload', u.id)!), content.length, hexToBase64(sha256));
    const file = (await owner.browser.post(`/v1/orgs/${org.id}/uploads/${u.id}/complete`)).json();

    // ...but can read project documents.
    expect((await subbie.browser.get(`/v1/orgs/${org.id}/files/${file.id}`)).statusCode).toBe(200);

    const stranger = await signUp(t.app, 'stranger');
    const strangerOrg = await createOrg(stranger.browser);
    const res = await stranger.browser.get(`/v1/orgs/${strangerOrg.id}/files/${file.id}/download`);
    expect(res.json().code).toBe('file.not_found');
  });
});
