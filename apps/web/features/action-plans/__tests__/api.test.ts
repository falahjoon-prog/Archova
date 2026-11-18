import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createActionPlansApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/action-plans';
const detail = (over: Record<string, unknown> = {}) => ({
  plan: {
    id: 'apl_1',
    projectId: 'prj_1',
    number: 7,
    numberLabel: 'AP-0007',
    title: 'Edge protection',
    description: '',
    status: 'active',
    dueDate: null,
    isOverdue: false,
    templateId: null,
    sourceType: null,
    sourceId: null,
    itemCount: 1,
    doneCount: 0,
    completedAt: null,
    createdBy: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    version: 4,
    ...over,
  },
  items: [
    {
      id: 'ali_1',
      planId: 'apl_1',
      sort: 1,
      title: 'Install',
      description: '',
      assigneeCompanyId: null,
      dueDate: null,
      isOverdue: false,
      status: 'open',
      note: null,
      completedAt: null,
      canUpdate: true,
    },
  ],
  canManage: true,
});

beforeEach(() => fake.reset());

describe('action plans api', () => {
  it('lists with the status filter and maps the register', async () => {
    fake.on('GET', P, () => ({ data: [detail().plan], nextCursor: null }));
    const r = await createActionPlansApi('org_1').list('prj_1', { status: 'active' });
    expect(r[0]).toMatchObject({ numberLabel: 'AP-0007', doneCount: 0 });
    expect(fake.callsTo('GET', P)[0]!.init.params!.query).toMatchObject({ status: 'active' });
  });

  it('sends If-Match when the plan is edited and returns its steps', async () => {
    fake.on('PATCH', `${P}/{planId}`, () => detail({ status: 'cancelled' }));
    const d = detail();
    const r = await createActionPlansApi('org_1').update(
      'prj_1',
      { plan: { ...d.plan, version: 4 } as never, items: [], canManage: true },
      { status: 'cancelled' },
    );
    expect(r.plan.status).toBe('cancelled');
    expect(r.items[0]).toMatchObject({ title: 'Install', canUpdate: true });
    const call = fake.callsTo('PATCH', `${P}/{planId}`)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"4"' });
    expect(call.init.body).toEqual({ status: 'cancelled' });
  });

  it('patches one step by id', async () => {
    fake.on('PATCH', `${P}/{planId}/items/{itemId}`, () => detail());
    await createActionPlansApi('org_1').updateStep('prj_1', 'apl_1', 'ali_1', { status: 'done' });
    const call = fake.callsTo('PATCH', `${P}/{planId}/items/{itemId}`)[0]!;
    expect(call.init.params!.path).toMatchObject({ planId: 'apl_1', itemId: 'ali_1' });
    expect(call.init.body).toEqual({ status: 'done' });
  });
});
