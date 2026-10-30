import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  outboxData,
  signUp,
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const pm = await signUp(t.app, 'cor-pm');
  const steel = await signUp(t.app, 'cor-steel');
  const outsider = await signUp(t.app, 'cor-outsider');
  const org = await createOrg(pm.browser, 'Notice Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower N', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const steelCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    steel.email,
    'Subcontractor',
    'Steelco',
  );
  const outsiderCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    outsider.email,
    'Subcontractor',
    'Plumbco',
  );
  return { pm, steel, outsider, org, project, base, steelCo, outsiderCo };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

describe('correspondence types and notices (product/08 SCH-AC5)', () => {
  it('copies an AU template into a type, writes a notice from it and sends it as evidence', async () => {
    const s = await setup();
    const types = `/v1/orgs/${s.org.id}/correspondence-types`;

    const templates = await s.pm.browser.get(`/v1/orgs/${s.org.id}/correspondence-templates`);
    expect(templates.statusCode).toBe(200);
    expect(templates.json().data.map((x: { key: string }) => x.key)).toContain('notice_of_delay');

    // Only org admins manage types.
    expect((await s.steel.browser.post(types, { templateKey: 'notice_of_delay' })).statusCode).toBe(
      403,
    );
    const typeRes = await s.pm.browser.post(types, { templateKey: 'notice_of_delay' });
    expect(typeRes.statusCode).toBe(201);
    const type = typeRes.json();
    expect(type).toMatchObject({
      name: 'Notice of delay',
      prefix: 'NOD',
      isEvidential: true,
      timeBarDays: 14,
      templateKey: 'notice_of_delay',
      archived: false,
    });
    const dup = await s.pm.browser.post(types, { name: 'Other', prefix: 'nod' });
    expect(dup.json().code).toBe('correspondence_type.prefix_taken');

    // A subcontractor can pick from the active types on the project.
    const pick = await s.steel.browser.get(`${s.base}/correspondence-types`);
    expect(pick.statusCode).toBe(200);
    expect(pick.json().data).toHaveLength(1);

    // The draft is numbered, filled from the template and starts its time bar from the event date.
    const created = await s.pm.browser.post(`${s.base}/correspondence`, {
      typeId: type.id,
      eventDate: '2020-01-06',
      toCompanyIds: [s.steelCo.companyId],
    });
    expect(created.statusCode).toBe(201);
    const item = created.json().item;
    expect(item).toMatchObject({
      numberLabel: 'NOD-001',
      status: 'draft',
      isEvidential: true,
      timeBarDate: '2020-01-20',
      timeBarState: 'overdue',
    });
    expect(item.body).toContain('Tower N');
    expect(item.body).toContain('06/01/2020');
    expect(item.subject).toContain('NOD-001');

    // Drafts are private to their author; other companies can't see them.
    expect((await s.steel.browser.get(`${s.base}/correspondence/${item.id}`)).statusCode).toBe(404);

    // It can't be sent without recipients, and unknown recipients are refused.
    const bare = await s.pm.browser.post(`${s.base}/correspondence`, { typeId: type.id });
    expect(
      (
        await s.pm.browser.post(`${s.base}/correspondence/${bare.json().item.id}/send`, undefined, {
          'if-match': etagOf(bare),
        })
      ).json().code,
    ).toBe('correspondence.incomplete');
    expect(
      (
        await s.pm.browser.patch(
          `${s.base}/correspondence/${bare.json().item.id}`,
          { toCompanyIds: ['cmp_00000000000000000000000000'] },
          { 'if-match': etagOf(bare) },
        )
      ).statusCode,
    ).toBe(422);

    // Edit the draft, attach a record, then send.
    const file = await uploadFile(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      'diary.pdf',
      'documents',
    );
    const edited = await s.pm.browser.patch(
      `${s.base}/correspondence/${item.id}`,
      { subject: 'Notice of delay: wet weather', fileIds: [file], responseRequired: true },
      { 'if-match': etagOf(created) },
    );
    expect(edited.statusCode).toBe(200);
    const sent = await s.pm.browser.post(`${s.base}/correspondence/${item.id}/send`, undefined, {
      'if-match': etagOf(edited),
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().item).toMatchObject({
      status: 'sent',
      timeBarState: 'none',
      sentInTime: false,
      responseRequired: true,
    });
    expect(sent.json().item.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.json().item.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const events = await outboxData<{ itemId: string }>(
      t,
      s.org.id,
      s.pm.userId,
      'correspondence.item.sent.v1',
    );
    expect(events.length).toBeGreaterThan(0);

    // Frozen once sent: no edits, no void.
    expect(
      (
        await s.pm.browser.patch(
          `${s.base}/correspondence/${item.id}`,
          { body: 'changed' },
          { 'if-match': etagOf(sent) },
        )
      ).json().code,
    ).toBe('correspondence.invalid_transition');
    expect(
      (
        await s.pm.browser.post(
          `${s.base}/correspondence/${item.id}/void`,
          { reason: 'oops' },
          { 'if-match': etagOf(sent) },
        )
      ).json().code,
    ).toBe('correspondence.invalid_transition');

    // The receiving company sees it and answers; the other subcontractor can't.
    expect((await s.steel.browser.get(`${s.base}/correspondence/${item.id}`)).statusCode).toBe(200);
    expect((await s.outsider.browser.get(`${s.base}/correspondence/${item.id}`)).statusCode).toBe(
      404,
    );
    expect((await s.outsider.browser.get(`${s.base}/correspondence`)).json().data).toEqual([]);
    const waiting = await s.pm.browser.get(`${s.base}/correspondence?awaitingResponse=true`);
    expect(waiting.json().data).toHaveLength(1);
    expect(
      (
        await s.outsider.browser.post(`${s.base}/correspondence/${item.id}/responses`, {
          body: 'Not mine',
        })
      ).statusCode,
    ).toBe(404);
    const reply = await s.steel.browser.post(`${s.base}/correspondence/${item.id}/responses`, {
      body: 'Received, assessing.',
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().item.status).toBe('responded');
    expect(reply.json().responses).toHaveLength(1);
    expect(
      (await s.pm.browser.get(`${s.base}/correspondence?awaitingResponse=true`)).json().data,
    ).toEqual([]);

    // Closing needs admin on the tool; the builder closes it.
    expect(
      (
        await s.steel.browser.post(`${s.base}/correspondence/${item.id}/close`, undefined, {
          'if-match': etagOf(reply),
        })
      ).statusCode,
    ).toBe(403);
    const closed = await s.pm.browser.post(`${s.base}/correspondence/${item.id}/close`, undefined, {
      'if-match': etagOf(reply),
    });
    expect(closed.json().item.status).toBe('closed');
  });

  it('voids a draft or a sent letter, but archived types can no longer be used', async () => {
    const s = await setup();
    const typeRes = await s.pm.browser.post(`/v1/orgs/${s.org.id}/correspondence-types`, {
      name: 'Letter',
      prefix: 'ltr',
      bodyTemplate: 'Dear {{projectName}}',
    });
    const type = typeRes.json();
    expect(type).toMatchObject({ prefix: 'LTR', isEvidential: false });

    const created = await s.pm.browser.post(`${s.base}/correspondence`, {
      typeId: type.id,
      subject: 'Hello',
      toCompanyIds: [s.steelCo.companyId],
    });
    expect(created.json().item.body).toBe('Dear Tower N');
    expect(
      (
        await s.pm.browser.patch(
          `${s.base}/correspondence/${created.json().item.id}`,
          { fromCompanyId: 'cmp_00000000000000000000000000' },
          { 'if-match': etagOf(created) },
        )
      ).statusCode,
    ).toBe(422);
    const sent = await s.pm.browser.post(
      `${s.base}/correspondence/${created.json().item.id}/send`,
      undefined,
      { 'if-match': etagOf(created) },
    );
    expect(sent.json().item.contentHash).toBeNull();
    const noReason = await s.pm.browser.post(
      `${s.base}/correspondence/${created.json().item.id}/void`,
      { reason: ' ' },
      { 'if-match': etagOf(sent) },
    );
    expect(noReason.statusCode).toBe(422);
    const voided = await s.pm.browser.post(
      `${s.base}/correspondence/${created.json().item.id}/void`,
      { reason: 'Sent to the wrong company' },
      { 'if-match': etagOf(sent) },
    );
    expect(voided.json().item).toMatchObject({
      status: 'void',
      voidReason: 'Sent to the wrong company',
    });

    const archived = await s.pm.browser.patch(
      `/v1/orgs/${s.org.id}/correspondence-types/${type.id}`,
      { archived: true },
      { 'if-match': etagOf(typeRes) },
    );
    expect(archived.json().archived).toBe(true);
    expect(
      (await s.pm.browser.post(`${s.base}/correspondence`, { typeId: type.id })).json().code,
    ).toBe('correspondence_type.archived');
    expect((await s.steel.browser.get(`${s.base}/correspondence-types`)).json().data).toEqual([]);
  });
});
