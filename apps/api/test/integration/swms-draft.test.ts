import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let on: TestContext;
let off: TestContext;
beforeAll(async () => {
  on = await createTestContext({ env: { API_AI_SWMS_DRAFTS: 'true' } });
  off = await createTestContext();
});
afterAll(async () => {
  await on.close();
  await off.close();
});

const inputs = {
  siteAddress: '14 Harbour Street, Pyrmont NSW',
  activity: 'Install formwork edge protection',
  highRiskWorkCategories: ['fall_2m'],
  workArea: 'Level 3 slab, north and east edges',
  access: 'Hoist to level 3, then the temporary stair at grid C',
  plant: ['Tower crane'],
  adjacentTrades: ['Steel fixers'],
};

async function setup(t: TestContext, tag: string) {
  const pm = await signUp(t.app, `${tag}-pm`);
  const sub = await signUp(t.app, `${tag}-sub`);
  const org = await createOrg(pm.browser, 'Swms Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formwork Co');
  return { pm, sub, base: `/v1/orgs/${org.id}/projects/${project.id}`, orgId: org.id };
}

describe('Nova SWMS drafts (F20)', () => {
  it('is off until switched on', async () => {
    const s = await setup(off, 'swmsoff');
    const res = await s.pm.browser.post(`${s.base}/ai/swms-drafts`, inputs);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ai.swms.not_enabled');
  });

  it('drafts a creator-only suggestion shaped like SWMS content, and never a SWMS', async () => {
    const s = await setup(on, 'swmson');
    const res = await s.sub.browser.post(`${s.base}/ai/swms-drafts`, inputs);
    expect(res.statusCode).toBe(201);
    const d = res.json();
    expect(d.task).toBe('swms.draft');
    expect(d.status).toBe('pending');
    expect(d.payload.highRiskWorkCategories).toEqual(['fall_2m']);
    expect(d.payload.content.controlMeasures.length).toBeGreaterThan(0);
    expect(d.payload.content.siteSpecific).toContain('Pyrmont');
    expect(d.payload.notice).toContain('competent person');
    expect(JSON.stringify(d.payload)).not.toMatch(/compliant/i);

    const call = on.ai.calls.at(-1)!;
    expect(call.task).toBe('swms.draft');
    // The register has nothing until a person submits it.
    expect((await s.sub.browser.get(`${s.base}/swms`)).json().data).toEqual([]);
    // The draft is the asker's alone.
    const mine = (await s.sub.browser.get(`${s.base}/ai/suggestions?task=swms.draft`)).json();
    expect(mine.data).toHaveLength(1);
    const theirs = (await s.pm.browser.get(`${s.base}/ai/suggestions?task=swms.draft`)).json();
    expect(theirs.data).toHaveLength(0);
  });

  it('will not draft without the minimum inputs', async () => {
    const s = await setup(on, 'swmsmin');
    const blank = await s.pm.browser.post(`${s.base}/ai/swms-drafts`, {
      ...inputs,
      workArea: '  ',
    });
    expect(blank.statusCode).toBe(422);
    const noCodes = await s.pm.browser.post(`${s.base}/ai/swms-drafts`, {
      ...inputs,
      highRiskWorkCategories: [],
    });
    expect(noCodes.statusCode).toBe(422);
    const noPlant = await s.pm.browser.post(`${s.base}/ai/swms-drafts`, {
      siteAddress: inputs.siteAddress,
      activity: inputs.activity,
      highRiskWorkCategories: ['fall_2m'],
      workArea: inputs.workArea,
      access: inputs.access,
    });
    expect(noPlant.statusCode).toBe(422);
  });
});
