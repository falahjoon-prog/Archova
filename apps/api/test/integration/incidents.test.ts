import { encodeId, uuidv7 } from '@archova/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const pm = await signUp(t.app, 'inc-pm');
  const sub = await signUp(t.app, 'inc-sub');
  const other = await signUp(t.app, 'inc-other');
  const org = await createOrg(pm.browser, 'Incident Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower I', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Roofers',
  );
  await addMember(pm.browser, org.id, project.id, other.email, 'Subcontractor', 'Painters');
  return { pm, sub, other, base, subCo };
}

const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const when = () => new Date(Date.now() - 3_600_000).toISOString();

describe('Incidents', () => {
  it('is reported by a subcontractor, hidden from others, and classified only by the builder', async () => {
    const s = await setup();
    const sent = await s.sub.browser.post(`${s.base}/incidents`, {
      title: 'Ladder slipped',
      type: 'injury',
      occurredAt: when(),
      severity: 'critical',
      isNotifiable: true,
      notifiableClass: 'death',
      people: [{ personName: 'A. Worker', role: 'injured', injury: { part: 'wrist' } }],
    });
    expect(sent.statusCode).toBe(201);
    const d = sent.json();
    // A reporter on site only supplies the facts.
    expect(d.incident).toMatchObject({
      numberLabel: 'INC-0001',
      status: 'reported',
      severity: 'low',
      isNotifiable: false,
    });
    expect((await s.other.browser.get(`${s.base}/incidents/${d.incident.id}`)).statusCode).toBe(
      404,
    );
    expect((await s.other.browser.get(`${s.base}/incidents`)).json().data).toEqual([]);
    expect((await s.sub.browser.get(`${s.base}/incidents`)).json().data).toHaveLength(1);

    const asPm = await s.pm.browser.get(`${s.base}/incidents/${d.incident.id}`);
    expect(asPm.statusCode).toBe(200);
    expect(asPm.json().people[0].injury).toEqual({ part: 'wrist' });

    const denied = await s.sub.browser.patch(
      `${s.base}/incidents/${d.incident.id}`,
      { severity: 'high' },
      ifMatch(d.incident.version),
    );
    expect(denied.statusCode).toBe(403);

    const noClass = await s.pm.browser.patch(
      `${s.base}/incidents/${d.incident.id}`,
      { isNotifiable: true },
      ifMatch(d.incident.version),
    );
    expect(noClass.statusCode).toBe(422);
  });

  it('feeds the injury analytics for builder staff only, with health detail checked', async () => {
    const s = await setup();
    const orgId = s.base.split('/')[3];
    const bad = await s.sub.browser.post(`${s.base}/incidents`, {
      title: 'Bad injury',
      type: 'injury',
      occurredAt: when(),
      people: [{ personName: 'A. Worker', role: 'injured', injury: { bodyArea: 'elbowish' } }],
    });
    expect(bad.statusCode).toBe(422);
    const sent = await s.sub.browser.post(`${s.base}/incidents`, {
      title: 'Cut hand',
      type: 'injury',
      occurredAt: when(),
      people: [
        {
          personName: 'A. Worker',
          role: 'injured',
          companyId: s.subCo.companyId,
          injury: {
            bodyArea: 'hand',
            injuryType: 'laceration',
            harmSource: 'hitting_objects',
            outcome: 'lost_time',
            daysLost: 2,
          },
        },
      ],
    });
    expect(sent.statusCode).toBe(201);
    const a = await s.pm.browser.get(`/v1/orgs/${orgId}/incident-analytics`);
    expect(a.statusCode).toBe(200);
    const body = a.json();
    expect(body.summary).toMatchObject({
      injuries: 1,
      lostTimeInjuries: 1,
      daysLost: 2,
      hoursWorked: null,
      ltifr: null,
    });
    expect(body.summary.byBodyPart).toEqual([{ key: 'hand', count: 1 }]);
    expect(body.daysWithoutInjury).toBe(0);
    expect(body.rows[0]).toMatchObject({ ref: 'INC-0001', bodyPart: 'hand', outcome: 'lost_time' });
    const knee = await s.pm.browser.get(`/v1/orgs/${orgId}/incident-analytics?bodyPart=knee`);
    expect(knee.json().rows).toEqual([]);
    expect((await s.sub.browser.get(`/v1/orgs/${orgId}/incident-analytics`)).statusCode).toBe(403);
  });

  it('closes only with a root cause, the regulator time and every action verified', async () => {
    const s = await setup();
    const created = (
      await s.pm.browser.post(`${s.base}/incidents`, {
        title: 'Hand laceration',
        type: 'injury',
        occurredAt: when(),
      })
    ).json();
    const id = created.incident.id as string;
    let version = created.incident.version as number;

    const classified = await s.pm.browser.patch(
      `${s.base}/incidents/${id}`,
      {
        isNotifiable: true,
        notifiableClass: 'serious_injury_illness',
        writtenNoticeRequestedAt: new Date().toISOString(),
      },
      ifMatch(version),
    );
    expect(classified.statusCode).toBe(200);
    expect(classified.json().incident.writtenNoticeDueAt).not.toBeNull();
    version = classified.json().incident.version;

    const investigating = await s.pm.browser.post(
      `${s.base}/incidents/${id}/transition`,
      { action: 'investigate' },
      ifMatch(version),
    );
    expect(investigating.statusCode).toBe(200);
    version = investigating.json().incident.version;

    const added = await s.pm.browser.post(`${s.base}/incidents/${id}/actions`, {
      title: 'Fit guards',
      assigneeCompanyId: s.subCo.companyId,
      dueDate: '2030-01-15',
    });
    expect(added.statusCode).toBe(201);
    const action = added.json().actions[0];
    version = added.json().incident.version;

    const blocked = await s.pm.browser.post(
      `${s.base}/incidents/${id}/transition`,
      { action: 'close' },
      ifMatch(version),
    );
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().code).toBe('incident.cannot_close');
    expect(blocked.json().errors.map((e: { path: string }) => e.path)).toEqual([
      'rootCause',
      'regulatorNotifiedAt',
      'actions',
    ]);

    // The assigned company marks it done; only the builder verifies.
    const done = await s.sub.browser.patch(
      `${s.base}/incidents/${id}/actions/${action.id}`,
      { status: 'done' },
      ifMatch(action.version),
    );
    expect(done.statusCode).toBe(200);
    const verifyAsSub = await s.sub.browser.patch(
      `${s.base}/incidents/${id}/actions/${action.id}`,
      { status: 'verified' },
      ifMatch(done.json().version),
    );
    expect(verifyAsSub.statusCode).toBe(403);
    const verified = await s.pm.browser.patch(
      `${s.base}/incidents/${id}/actions/${action.id}`,
      { status: 'verified' },
      ifMatch(done.json().version),
    );
    expect(verified.statusCode).toBe(200);

    const current = (await s.pm.browser.get(`${s.base}/incidents/${id}`)).json();
    const ready = await s.pm.browser.patch(
      `${s.base}/incidents/${id}`,
      {
        regulatorNotifiedAt: new Date().toISOString(),
        rootCause: { method: 'five_whys', causes: ['No guard'], summary: 'Guard missing' },
      },
      ifMatch(current.incident.version),
    );
    expect(ready.statusCode).toBe(200);
    expect(ready.json().closeBlockers).toEqual([]);

    const closed = await s.pm.browser.post(
      `${s.base}/incidents/${id}/transition`,
      { action: 'close' },
      ifMatch(ready.json().incident.version),
    );
    expect(closed.statusCode).toBe(200);
    expect(closed.json().incident.status).toBe('closed');
    expect(closed.json().incident.keepUntil).not.toBeNull();

    // Reopening needs a reason.
    const noReason = await s.pm.browser.post(
      `${s.base}/incidents/${id}/transition`,
      { action: 'reopen' },
      ifMatch(closed.json().incident.version),
    );
    expect(noReason.statusCode).toBe(422);
  });

  it('links a corrective action to an observation and finds it from there', async () => {
    const s = await setup();
    const obs = (
      await s.pm.browser.post(`${s.base}/observations`, {
        type: 'safety',
        hazard: 'Unprotected edge',
        description: 'No edge protection.',
        priority: 'high',
      })
    ).json();
    const inc = (
      await s.pm.browser.post(`${s.base}/incidents`, {
        title: 'Near miss at the edge',
        type: 'near_miss',
        occurredAt: when(),
      })
    ).json();

    const missing = await s.pm.browser.post(`${s.base}/incidents/${inc.incident.id}/actions`, {
      title: 'Fit edge protection',
      source: { type: 'observation', id: encodeId('observation', uuidv7()) },
    });
    expect(missing.statusCode).toBe(422);

    const linked = await s.pm.browser.post(`${s.base}/incidents/${inc.incident.id}/actions`, {
      title: 'Fit edge protection',
      source: { type: 'observation', id: obs.id },
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json().actions[0].source).toEqual({ type: 'observation', id: obs.id });

    const found = await s.pm.browser.get(
      `${s.base}/incident-actions?sourceType=observation&sourceId=${obs.id}`,
    );
    expect(found.statusCode).toBe(200);
    expect(found.json().data).toHaveLength(1);
    expect(found.json().data[0]).toMatchObject({
      incidentNumberLabel: 'INC-0001',
      incidentTitle: 'Near miss at the edge',
    });
  });
});
