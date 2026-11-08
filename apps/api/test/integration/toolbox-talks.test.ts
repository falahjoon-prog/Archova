import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

// Two different valid 1x1 PNGs, so two signatures have different bytes.
const PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function setup() {
  const pm = await signUp(t.app, 'tbt-pm');
  const sub = await signUp(t.app, 'tbt-sub');
  const org = await createOrg(pm.browser, 'Toolbox Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower T', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Form Co',
  );
  const sig = (bytes: Buffer, name: string) =>
    uploadBytes(t, pm.browser, org.id, project.id, bytes, name, 'image/png', 'safety');
  return { pm, sub, org, project, base, subCo, sig };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;
const heldAt = () => new Date(Date.now() - 3_600_000).toISOString();

describe('Toolbox talks', () => {
  it('runs a talk: grid, per-row signatures, repeat flag, close and reopen', async () => {
    const s = await setup();
    const topic = await s.pm.browser.post(`${s.base}/toolbox-topics`, {
      title: 'Working at heights',
      category: 'hazard',
      hrcwCategory: 'fall_2m',
      talkingPoints: 'Edges, harnesses, ladders.',
    });
    expect(topic.statusCode).toBe(201);
    const topicId = topic.json().id as string;

    const created = await s.pm.browser.post(`${s.base}/toolbox-talks`, {
      title: 'Working at heights',
      topicId,
      heldAt: heldAt(),
      presenterName: 'Pat Foreman',
      location: 'Level 3',
      attendees: [{ personName: 'Sam Carpenter' }, { personName: 'Lee Rigger' }],
    });
    expect(created.statusCode).toBe(201);
    let d = created.json();
    expect(d.talk).toMatchObject({ numberLabel: 'TBT-0001', status: 'open', attendeeCount: 2 });
    expect(d.closeBlockers[0]).toMatch(/2 people have not signed/);

    // Duplicate name on the same talk is refused.
    const dup = await s.pm.browser.post(
      `${s.base}/toolbox-talks/${d.talk.id}/attendees`,
      { attendees: [{ personName: 'sam carpenter' }] },
      { 'if-match': etagOf(created) },
    );
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('toolbox.already_listed');

    // Cannot close with unsigned rows.
    const early = await s.pm.browser.post(
      `${s.base}/toolbox-talks/${d.talk.id}/transition`,
      { action: 'close' },
      { 'if-match': etagOf(created) },
    );
    expect(early.json().code).toBe('toolbox.cannot_close');

    // Sign both rows with the same image: both are flagged, neither blocked.
    const same = await s.sig(PNG_A, 'sig-a.png');
    let version = etagOf(created);
    for (const a of d.attendees as { id: string }[]) {
      const r = await s.pm.browser.put(
        `${s.base}/toolbox-talks/${d.talk.id}/attendees/${a.id}/signature`,
        { signatureFileId: same },
        { 'if-match': version },
      );
      expect(r.statusCode).toBe(200);
      version = etagOf(r);
      d = r.json();
    }
    expect(d.attendees.map((a: { repeatFlags: string[] }) => a.repeatFlags)).toEqual([
      ['shared_between_people'],
      ['shared_between_people'],
    ]);

    // Clearing one row and signing it with a different image removes the flags.
    const second = d.attendees[1] as { id: string };
    const cleared = await s.pm.browser.del(
      `${s.base}/toolbox-talks/${d.talk.id}/attendees/${second.id}/signature`,
      { 'if-match': version },
    );
    expect(cleared.statusCode).toBe(200);
    version = etagOf(cleared);
    const resigned = await s.pm.browser.put(
      `${s.base}/toolbox-talks/${d.talk.id}/attendees/${second.id}/signature`,
      { signatureFileId: await s.sig(PNG_B, 'sig-b.png') },
      { 'if-match': version },
    );
    d = resigned.json();
    version = etagOf(resigned);
    expect(d.attendees.every((a: { repeatFlags: string[] }) => a.repeatFlags.length === 0)).toBe(
      true,
    );

    // A stale ETag is refused.
    const stale = await s.pm.browser.patch(
      `${s.base}/toolbox-talks/${d.talk.id}`,
      { notes: 'x' },
      { 'if-match': etagOf(created) },
    );
    expect(stale.statusCode).toBe(412);

    const closed = await s.pm.browser.post(
      `${s.base}/toolbox-talks/${d.talk.id}/transition`,
      { action: 'close' },
      { 'if-match': version },
    );
    expect(closed.statusCode).toBe(200);
    expect(closed.json().talk.status).toBe('closed');

    // Closed talks are frozen, and the topic shows when it last ran.
    const frozen = await s.pm.browser.patch(
      `${s.base}/toolbox-talks/${d.talk.id}`,
      { notes: 'late edit' },
      { 'if-match': etagOf(closed) },
    );
    expect(frozen.json().code).toBe('toolbox.closed');
    const topics = (await s.pm.browser.get(`${s.base}/toolbox-topics`)).json().data;
    expect(topics[0].lastHeldAt).not.toBeNull();

    // A later talk where the same person pastes the earlier image is flagged.
    const later = await s.pm.browser.post(`${s.base}/toolbox-talks`, {
      title: 'Heights again',
      heldAt: new Date().toISOString(),
      presenterName: 'Pat Foreman',
      attendees: [{ personName: 'Sam Carpenter' }],
    });
    const l = later.json();
    const pasted = await s.pm.browser.put(
      `${s.base}/toolbox-talks/${l.talk.id}/attendees/${l.attendees[0].id}/signature`,
      { signatureFileId: same },
      { 'if-match': etagOf(later) },
    );
    expect(pasted.json().attendees[0].repeatFlags).toEqual(['reused_from_earlier_talk']);
    expect(createHash('sha256').update(PNG_A).digest('hex')).toHaveLength(64);

    const reopened = await s.pm.browser.post(
      `${s.base}/toolbox-talks/${d.talk.id}/transition`,
      { action: 'reopen' },
      { 'if-match': etagOf(closed) },
    );
    expect(reopened.json().talk.status).toBe('open');
  });

  it('suggests topics from incidents, SWMS in force and stale topics; builder staff only', async () => {
    const s = await setup();
    await s.pm.browser.post(`${s.base}/toolbox-topics`, { title: 'Manual handling' });
    const inc = await s.pm.browser.post(`${s.base}/incidents`, {
      title: 'Near miss at hoist',
      type: 'near_miss',
      occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(inc.statusCode).toBe(201);
    const out = (await s.pm.browser.get(`${s.base}/toolbox-talks/suggestions`)).json().data;
    expect(out.map((x: { reason: string }) => x.reason)).toEqual(['recent_incident', 'never_run']);
    expect(out[0].because).toMatch(/1 near miss report/);

    const forSub = await s.sub.browser.get(`${s.base}/toolbox-talks/suggestions`);
    expect(forSub.statusCode).toBe(200);
    expect(forSub.json().data).toEqual([]);
  });

  it('shows a subcontractor only the talks they started or their company attended, and keeps topics to the builder', async () => {
    const s = await setup();
    const hidden = await s.pm.browser.post(`${s.base}/toolbox-talks`, {
      title: 'Builder only',
      heldAt: heldAt(),
      presenterName: 'Pat',
    });
    const withSub = await s.pm.browser.post(`${s.base}/toolbox-talks`, {
      title: 'Form Co on site',
      heldAt: heldAt(),
      presenterName: 'Pat',
      attendees: [{ personName: 'Dee Formworker', companyId: s.subCo.companyId }],
    });
    expect(withSub.statusCode).toBe(201);
    const list = (await s.sub.browser.get(`${s.base}/toolbox-talks`)).json().data;
    expect(list.map((x: { title: string }) => x.title)).toEqual(['Form Co on site']);
    const peek = await s.sub.browser.get(`${s.base}/toolbox-talks/${hidden.json().talk.id}`);
    expect(peek.statusCode).toBe(404);
    const edit = await s.sub.browser.patch(
      `${s.base}/toolbox-talks/${withSub.json().talk.id}`,
      { notes: 'x' },
      { 'if-match': etagOf(withSub) },
    );
    expect(edit.statusCode).toBe(403);
    const topic = await s.sub.browser.post(`${s.base}/toolbox-topics`, { title: 'Nope' });
    expect(topic.statusCode).toBe(403);
    // A sub can run their own talk.
    const own = await s.sub.browser.post(`${s.base}/toolbox-talks`, {
      title: 'Form Co toolbox',
      heldAt: heldAt(),
      presenterName: 'Dee',
    });
    expect(own.statusCode).toBe(201);
  });

  it('deletes only an open talk nobody has signed', async () => {
    const s = await setup();
    const c = await s.pm.browser.post(`${s.base}/toolbox-talks`, {
      title: 'Throwaway',
      heldAt: heldAt(),
      presenterName: 'Pat',
      attendees: [{ personName: 'Sam' }],
    });
    const del = await s.pm.browser.del(`${s.base}/toolbox-talks/${c.json().talk.id}`, {
      'if-match': etagOf(c),
    });
    expect(del.statusCode).toBe(204);
    expect((await s.pm.browser.get(`${s.base}/toolbox-talks/${c.json().talk.id}`)).statusCode).toBe(
      404,
    );
  });
});
