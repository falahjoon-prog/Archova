import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ragLabel } from '../lib/labels';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const { createRisksApi } = await import('../data/api');

describe('risk labels', () => {
  it('words the colour and says so when nothing is assessed', () => {
    expect(ragLabel('red').label).toMatch(/Red/);
    expect(ragLabel(null)).toMatchObject({ tone: 'neutral' });
  });
});

describe('risks api', () => {
  beforeEach(() => fake.reset());
  it('sends the risk version so a stale screen gets a 412 rather than overwriting', async () => {
    fake.on('PATCH', '/v1/orgs/{orgId}/projects/{projectId}/risks/{riskId}', () => ({}));
    await createRisksApi('org_1').update(
      'prj_1',
      { id: 'rsk_1', version: 3 },
      { status: 'closed' },
    );
    const call = fake.calls.find((c) => c.method === 'PATCH')!;
    expect(call.init.params?.header).toEqual({ 'If-Match': '"3"' });
    expect(call.init.body).toEqual({ status: 'closed' });
  });
});
