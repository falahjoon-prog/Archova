import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CorrespondenceDetail, CorrespondenceItem } from '../lib/types';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createCorrespondenceApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/correspondence';
const item = (over: Partial<CorrespondenceItem> = {}): CorrespondenceItem => ({
  id: 'cor_1',
  projectId: 'prj_1',
  typeId: 'cty_1',
  typeName: 'Notice of delay',
  isEvidential: true,
  number: 1,
  numberLabel: 'NOD-001',
  subject: 'Notice of delay',
  body: 'Body',
  status: 'draft',
  fromCompanyId: 'cmp_1',
  toCompanyIds: ['cmp_2'],
  responseRequired: false,
  dueDate: null,
  eventDate: '2027-03-01',
  timeBarDays: 14,
  timeBarDate: '2027-03-15',
  timeBarState: 'ok',
  sentInTime: null,
  fileIds: [],
  related: [],
  isPrivate: false,
  fieldValues: {},
  sentAt: null,
  sentBy: null,
  contentHash: null,
  closedAt: null,
  voidReason: null,
  createdBy: 'usr_1',
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  version: 1,
  ...over,
});
const detail = (over: Partial<CorrespondenceItem> = {}): CorrespondenceDetail => ({
  item: item(over),
  responses: [],
  canManageAccess: false,
});

beforeEach(() => fake.reset());

describe('correspondence api', () => {
  it('lists with the filters the register sends', async () => {
    fake.on('GET', P, () => ({ data: [item()], nextCursor: null }));
    const rows = await createCorrespondenceApi('org_1').list('prj_1', {
      status: 'sent',
      typeId: 'cty_1',
      awaitingResponse: true,
      q: ' delay ',
    });
    expect(rows).toHaveLength(1);
    expect(fake.callsTo('GET', P)[0]!.init.params?.query).toMatchObject({
      status: 'sent',
      typeId: 'cty_1',
      awaitingResponse: 'true',
      q: 'delay',
    });
  });

  it('starts a draft leaving blank text for the type template to fill', async () => {
    fake.on('POST', P, () => detail());
    await createCorrespondenceApi('org_1').create('prj_1', {
      typeId: 'cty_1',
      subject: ' ',
      body: '',
      toCompanyIds: ['cmp_2'],
      eventDate: '2027-03-01',
    });
    expect(fake.callsTo('POST', P)[0]!.init.body).toEqual({
      typeId: 'cty_1',
      toCompanyIds: ['cmp_2'],
      eventDate: '2027-03-01',
    });
  });

  it('sends and voids against the version it saw', async () => {
    fake.on('POST', `${P}/{correspondenceId}/send`, () => detail({ status: 'sent' }));
    fake.on('POST', `${P}/{correspondenceId}/void`, () => detail({ status: 'void' }));
    const api = createCorrespondenceApi('org_1');
    await api.send('prj_1', 'cor_1', 3);
    expect(fake.callsTo('POST', `${P}/{correspondenceId}/send`)[0]!.init.params?.header).toEqual({
      'If-Match': '"3"',
    });
    await api.voidItem('prj_1', 'cor_1', 4, ' wrong company ');
    expect(fake.callsTo('POST', `${P}/{correspondenceId}/void`)[0]!.init.body).toEqual({
      reason: 'wrong company',
    });
  });
});
