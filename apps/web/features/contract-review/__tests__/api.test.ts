import { beforeEach, describe, expect, it, vi } from 'vitest';
import { review } from './fixtures';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const uploadFile = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/uploads', () => ({ uploadFile, fileDownloadUrl: vi.fn() }));

const { createContractReviewApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/ai/contract-reviews';
const api = createContractReviewApi('org_1');

beforeEach(() => {
  fake.reset();
  uploadFile.mockReset();
});

describe('contract review api', () => {
  it('uploads the PDF, then starts the review with its file id', async () => {
    uploadFile.mockResolvedValue({ id: 'fil_9' });
    fake.on('POST', P, () => review());
    const file = new File(['x'], 'c.pdf', { type: 'application/pdf' });
    const r = await api.start('prj_1', {
      file,
      contractType: 'subcontract',
      ourSide: 'we_pay',
      baseForm: null,
      multiState: true,
    });
    expect(r.suggestionId).toBe('ais_1');
    expect(uploadFile).toHaveBeenCalledWith('org_1', {
      file,
      projectId: 'prj_1',
      module: 'documents',
    });
    expect(fake.callsTo('POST', P)[0]!.init).toMatchObject({
      params: { path: { orgId: 'org_1', projectId: 'prj_1' } },
      body: {
        fileId: 'fil_9',
        contractType: 'subcontract',
        ourSide: 'we_pay',
        baseForm: null,
        multiState: true,
      },
    });
  });

  it('does not start the review when the upload fails', async () => {
    uploadFile.mockRejectedValue(new Error('scan failed'));
    fake.on('POST', P, () => review());
    await expect(
      api.start('prj_1', {
        file: new File(['x'], 'c.pdf'),
        contractType: 'head_contract',
        ourSide: 'we_pay',
        baseForm: null,
        multiState: false,
      }),
    ).rejects.toThrow('scan failed');
    expect(fake.callsTo('POST', P)).toHaveLength(0);
  });

  it('posts a flag decision to the flag decision path', async () => {
    const path = `${P}/{suggestionId}/flags/{flagIndex}/decision`;
    fake.on('POST', path, () => review());
    await api.decide('prj_1', 'ais_1', 2, { decision: 'negotiate', note: 'Ask for 10 days' });
    expect(fake.callsTo('POST', path)[0]!.init).toEqual({
      params: {
        path: { orgId: 'org_1', projectId: 'prj_1', suggestionId: 'ais_1', flagIndex: '2' },
      },
      body: { decision: 'negotiate', note: 'Ask for 10 days' },
    });
  });

  it('lists and gets reviews', async () => {
    fake.on('GET', P, () => ({ data: [review()] }));
    fake.on('GET', `${P}/{suggestionId}`, () => review());
    expect(await api.list('prj_1')).toHaveLength(1);
    expect((await api.get('prj_1', 'ais_1')).fileName).toBe('Head contract.pdf');
  });
});
