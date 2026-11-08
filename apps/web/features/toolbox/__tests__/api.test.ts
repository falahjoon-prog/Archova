import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const upload = vi.hoisted(() => vi.fn(async () => ({ id: 'fil_sig' })));
vi.mock('@/shared/lib/uploads', () => ({ uploadFile: upload }));

const { createToolboxApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks';
const talk = {
  id: 'tbt_1',
  projectId: 'prj_1',
  number: 1,
  numberLabel: 'TBT-0001',
  topicId: null,
  title: 'Heights',
  heldAt: '2026-11-08T00:00:00Z',
  location: null,
  presenterName: 'Pat',
  notes: null,
  status: 'open',
  closedAt: null,
  attendeeCount: 1,
  signedCount: 0,
  createdBy: null,
  createdAt: '2026-11-08T00:00:00Z',
  version: 4,
};
const detail = () => ({
  talk,
  topic: null,
  attendees: [
    {
      id: 'tba_1',
      personName: 'Sam',
      companyId: null,
      userId: null,
      signedAt: null,
      signatureFileId: null,
      repeatFlags: ['shared_between_people'],
    },
  ],
  closeBlockers: ['1 person has not signed. Sign, or remove them.'],
  canEdit: true,
});

beforeEach(() => {
  fake.reset();
  upload.mockClear();
});

describe('toolbox api', () => {
  it('maps a talk with its grid and repeat flags', async () => {
    fake.on('GET', `${P}/{talkId}`, () => detail());
    const d = await createToolboxApi('org_1').getTalk('prj_1', 'tbt_1');
    expect(d.talk.numberLabel).toBe('TBT-0001');
    expect(d.attendees[0]!.repeatFlags).toEqual(['shared_between_people']);
    expect(d.closeBlockers).toHaveLength(1);
  });

  it('creates a talk with only the fields that were given', async () => {
    fake.on('POST', P, () => detail());
    await createToolboxApi('org_1').createTalk('prj_1', {
      title: 'Heights',
      heldAt: '2026-11-08T00:00:00Z',
      presenterName: 'Pat',
    });
    expect(fake.callsTo('POST', P)[0]!.init.body).toEqual({
      title: 'Heights',
      heldAt: '2026-11-08T00:00:00Z',
      presenterName: 'Pat',
    });
  });

  it('uploads the signature image to the safety module, then signs one row with If-Match', async () => {
    const sig = `${P}/{talkId}/attendees/{attendeeId}/signature`;
    fake.on('PUT', sig, () => detail());
    const api = createToolboxApi('org_1');
    const d = {
      ...(await (async () => {
        fake.on('GET', `${P}/{talkId}`, () => detail());
        return api.getTalk('prj_1', 'tbt_1');
      })()),
    };
    await api.sign('prj_1', d, 'tba_1', new Blob(['x'], { type: 'image/png' }));
    expect(upload).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ projectId: 'prj_1', module: 'safety' }),
    );
    const call = fake.callsTo('PUT', sig)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"4"' });
    expect(call.init.body).toEqual({ signatureFileId: 'fil_sig' });
  });
});
