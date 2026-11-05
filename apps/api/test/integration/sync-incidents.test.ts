import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeId, uuidv7 } from '@archova/domain';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Change = { entityType: string; id: string; op: string; data?: Record<string, unknown> };

describe('mobile sync: incidents', () => {
  it('reports with injury details and a photo from the phone, then pulls the number back', async () => {
    const pm = await signUp(t.app, 'sinc-pm');
    const sub = await signUp(t.app, 'sinc-sub');
    const other = await signUp(t.app, 'sinc-other');
    const org = await createOrg(pm.browser, 'Incident Sync Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Tower S', state: 'NSW' });
    await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Roofers');
    await addMember(pm.browser, org.id, project.id, other.email, 'Subcontractor', 'Painters');

    const incidentId = encodeId('incident', uuidv7());
    const push = async (mutations: unknown[]) => {
      const res = await sub.browser.post(`/v1/orgs/${org.id}/sync/push`, { mutations });
      expect(res.statusCode).toBe(200);
      return res.json().results as { status: string; problem?: { code: string } }[];
    };
    const mutation = (command: string, payload: object) => ({
      mutationId: randomUUID(),
      command,
      entityId: incidentId,
      baseVersion: null,
      clientAt: new Date().toISOString(),
      payload,
    });
    const pull = async (who: typeof pm) =>
      (
        await who.browser.get(
          `/v1/orgs/${org.id}/sync/pull?scopes=${encodeURIComponent(`project:${project.id}:safety`)}&since=0`,
        )
      ).json() as { changes: Change[] };

    // A bad injury answer is refused; a good one is kept.
    const bad = mutation('safety.reportIncident', {
      projectId: project.id,
      title: 'Ladder slipped',
      type: 'injury',
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
      people: [{ personName: 'A. Worker', role: 'injured', injury: { diagnosis: 'x' } }],
    });
    expect((await push([bad]))[0]).toMatchObject({ status: 'rejected' });
    const report = mutation('safety.reportIncident', {
      ...(bad.payload as object),
      people: [
        {
          personName: 'A. Worker',
          role: 'injured',
          injury: { nature: 'Sprain', bodyPart: 'Wrist', treatment: 'Ice pack' },
        },
      ],
    });
    expect((await push([report]))[0]).toMatchObject({ status: 'applied' });

    // The photo is a ready file on the project; a second send of it changes nothing.
    const file = await uploadFile(t, sub.browser, org.id, project.id, 'scene.pdf', 'safety');
    const photo = mutation('safety.attachIncidentPhoto', { fileId: file });
    expect((await push([photo]))[0]).toMatchObject({ status: 'applied' });
    expect(
      (await push([mutation('safety.attachIncidentPhoto', { fileId: file })]))[0],
    ).toMatchObject({
      status: 'applied',
    });

    // The reporter's phone gets the incident with its number, status and photo count, but no injury details.
    const mine = (await pull(sub)).changes.find((c) => c.entityType === 'incident');
    expect(mine).toMatchObject({
      op: 'upsert',
      id: incidentId,
      data: {
        numberLabel: 'INC-0001',
        status: 'reported',
        title: 'Ladder slipped',
        photoCount: 1,
        people: [{ personName: 'A. Worker', role: 'injured', injury: null }],
      },
    });

    // The builder's phone sees the injury details; another company's phone sees nothing.
    const staff = (await pull(pm)).changes.find((c) => c.entityType === 'incident');
    expect(staff?.data?.people).toEqual([
      {
        personName: 'A. Worker',
        role: 'injured',
        injury: { nature: 'Sprain', bodyPart: 'Wrist', treatment: 'Ice pack' },
      },
    ]);
    const stranger = (await pull(other)).changes.find((c) => c.entityType === 'incident');
    expect(stranger).toMatchObject({ op: 'delete' });

    // The web detail lists the photo for people who can see the incident.
    const detail = (
      await pm.browser.get(`/v1/orgs/${org.id}/projects/${project.id}/incidents/${incidentId}`)
    ).json();
    expect(detail.photoFileIds).toEqual([file]);
  });
});
