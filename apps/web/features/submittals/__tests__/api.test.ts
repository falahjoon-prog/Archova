import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCsv, type Submittal } from '../lib/types';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createSubmittalsApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/submittals';
const item = (over: Partial<Submittal> = {}): Submittal => ({
  id: 'sbm_1',
  projectId: 'prj_1',
  number: 1,
  numberLabel: 'SD-001',
  title: 'Transfer beam, "L2"',
  type: 'shop_drawing',
  specSection: '0331 Concrete',
  responsibleCompanyId: 'cmp_1',
  managerId: 'usr_1',
  requiredOnSite: '2027-03-26',
  leadTimeDays: 5,
  reviewDays: 10,
  submitBy: '2027-03-05',
  submitByState: 'ok',
  status: 'draft',
  currentRevision: 0,
  ballInCourt: { side: 'subcontractor', userIds: [], stepId: null, dueDate: null },
  submittedAt: null,
  returnedAt: null,
  closedAt: null,
  createdBy: 'usr_1',
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  version: 1,
  ...over,
});

beforeEach(() => fake.reset());

describe('submittals api', () => {
  it('lists with the filters the register sends', async () => {
    fake.on('GET', P, () => ({ data: [item()], nextCursor: null }));
    const rows = await createSubmittalsApi('org_1').list('prj_1', {
      status: 'in_review',
      type: 'sample',
      q: ' beam ',
      ballInCourt: 'usr_9',
    });
    expect(rows).toHaveLength(1);
    expect(fake.callsTo('GET', P)[0]!.init.params?.query).toMatchObject({
      status: 'in_review',
      type: 'sample',
      q: 'beam',
      ballInCourt: 'usr_9',
    });
  });

  it('creates an item, leaving blank optional fields out', async () => {
    fake.on('POST', P, () => ({ submittal: item(), revisions: [] }));
    await createSubmittalsApi('org_1').create('prj_1', {
      title: 'Glazing samples',
      numberLabel: ' ',
      type: 'sample',
      specSection: '',
      responsibleCompanyId: '',
      requiredOnSite: '2027-03-26',
      leadTimeDays: 5,
      reviewDays: 10,
    });
    expect(fake.callsTo('POST', P)[0]!.init.body).toEqual({
      title: 'Glazing samples',
      type: 'sample',
      leadTimeDays: 5,
      reviewDays: 10,
      requiredOnSite: '2027-03-26',
    });
  });

  it('answers a step with the comments, and closes against the version it saw', async () => {
    fake.on('POST', `${P}/{submittalId}/steps/{stepId}/respond`, () => ({
      submittal: item({ status: 'approved' }),
      revisions: [],
    }));
    fake.on('POST', `${P}/{submittalId}/close`, () => ({
      submittal: item({ status: 'closed' }),
      revisions: [],
    }));
    const api = createSubmittalsApi('org_1');
    await api.respond('prj_1', 'sbm_1', 'sbs_1', {
      response: 'approved_as_noted',
      comments: ' Add camber note ',
      files: [],
    });
    expect(fake.callsTo('POST', `${P}/{submittalId}/steps/{stepId}/respond`)[0]!.init.body).toEqual(
      {
        response: 'approved_as_noted',
        comments: 'Add camber note',
      },
    );
    await api.close('prj_1', 'sbm_1', 4);
    expect(fake.callsTo('POST', `${P}/{submittalId}/close`)[0]!.init.params?.header).toEqual({
      'If-Match': '"4"',
    });
  });
});

describe('registerCsv', () => {
  it('writes one quoted row per item with names, not ids', () => {
    const csv = registerCsv([item()], {
      company: () => 'Steelco',
      person: () => 'Pat',
    });
    const [head, row] = csv.split('\r\n');
    expect(head).toBe(
      'Number,Title,Type,Spec section,Responsible,Required on site,Submit by,Status,Revision,With',
    );
    expect(row).toBe(
      'SD-001,"Transfer beam, ""L2""",Shop drawing,0331 Concrete,Steelco,2027-03-26,2027-03-05,Draft,0,subcontractor',
    );
  });
});
