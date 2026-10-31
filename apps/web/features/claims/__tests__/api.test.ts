import { beforeEach, describe, expect, it } from 'vitest';

const fake = await (
  await import('vitest')
).vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
(await import('vitest')).vi.mock('@/shared/lib/api', () => fake.module);

const { createClaimsApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
beforeEach(() => fake.reset());

describe('claims api', () => {
  it('lists the register, filtered by status', async () => {
    fake.on('GET', `${P}/payment-claims`, () => ({ data: [] }));
    await createClaimsApi('org_1').claims('prj_1', 'submitted');
    expect(fake.callsTo('GET', `${P}/payment-claims`)[0]!.init.params?.query).toEqual({
      status: 'submitted',
    });
  });

  it('records a claim with an idempotency key', async () => {
    fake.on('POST', `${P}/contracts/{contractId}/claims`, () => ({
      claim: { id: 'pcl_1' },
      lines: [],
      schedule: null,
    }));
    await createClaimsApi('org_1').submitClaim('prj_1', 'cnt_1', {
      periodEnd: '2026-09-30',
      receivedAt: '2026-10-13T23:00:00Z',
      statesAct: true,
      lines: [{ sovItemId: 'sov_1', thisClaim: '1000.00' }],
    });
    const call = fake.callsTo('POST', `${P}/contracts/{contractId}/claims`)[0]!;
    expect(call.init.params?.header?.['Idempotency-Key']).toBeTruthy();
    expect(call.init.body).toMatchObject({ statesAct: true });
  });

  it('issues a schedule against the claim', async () => {
    fake.on('POST', `${P}/payment-claims/{claimId}/schedule`, () => ({
      claim: { id: 'pcl_1' },
      lines: [],
      schedule: null,
    }));
    await createClaimsApi('org_1').issueSchedule('prj_1', 'pcl_1', {
      scheduledAmount: '500.00',
      overallReason: 'Incomplete',
    });
    expect(
      fake.callsTo('POST', `${P}/payment-claims/{claimId}/schedule`)[0]!.init.params?.path,
    ).toMatchObject({
      claimId: 'pcl_1',
    });
  });
});
