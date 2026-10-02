import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { untilScanned, uploadFile } = await import('../uploads');

const file = (status: string) => ({
  id: 'fil_1',
  projectId: 'prj_1',
  module: 'documents',
  filename: 'plan.pdf',
  mime: 'application/pdf',
  sizeBytes: 4,
  sha256: 'x',
  status,
  capture: null,
  createdAt: '2026-10-02T00:00:00Z',
});

beforeEach(() => {
  fake.reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  fake.on('POST', '/v1/orgs/{orgId}/uploads', () => ({
    id: 'upl_1',
    uploadUrl: 'https://storage.example/put',
    uploadMethod: 'PUT',
    uploadHeaders: {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const upload = () =>
  uploadFile('org_1', {
    file: new File(['%PDF'], 'plan.pdf'),
    projectId: 'prj_1',
    module: 'documents',
  });

describe('uploadFile', () => {
  it('waits for the malware scan before handing the file on', async () => {
    let checks = 0;
    fake.on('GET', '/v1/orgs/{orgId}/files/{fileId}', () =>
      file(++checks < 2 ? 'scanning' : 'ready'),
    );
    await expect(
      untilScanned('org_1', file('scanning') as never, [0, 0, 0]),
    ).resolves.toMatchObject({ id: 'fil_1', status: 'ready' });
    expect(checks).toBe(2);
  });

  it('stops with a clear message when the scan blocks the file or runs too long', async () => {
    fake.on('GET', '/v1/orgs/{orgId}/files/{fileId}', () => file('infected'));
    await expect(untilScanned('org_1', file('scanning') as never, [0, 0])).rejects.toMatchObject({
      status: 422,
    });
    fake.on('GET', '/v1/orgs/{orgId}/files/{fileId}', () => file('scanning'));
    await expect(untilScanned('org_1', file('scanning') as never, [0, 0])).rejects.toMatchObject({
      status: 504,
    });
  });

  it('returns at once when the file is already ready', async () => {
    fake.on('POST', '/v1/orgs/{orgId}/uploads/{uploadId}/complete', () => file('ready'));
    await expect(upload()).resolves.toMatchObject({ status: 'ready' });
    expect(fake.callsTo('GET', '/v1/orgs/{orgId}/files/{fileId}')).toHaveLength(0);
  });
});
