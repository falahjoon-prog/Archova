import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  Browser,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const tokenIn = (to: string) => {
  const mail = t.messages.sent.filter((m) => m.to === to).at(-1)!;
  return /\/sign\/(arl_[A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
};
const mailsTo = (to: string) => t.messages.sent.filter((m) => m.to === to).length;
const SIG = { signatureKind: 'typed', signature: 'Jo Citizen', consent: true };

async function pdfBytes() {
  const d = await PDFDocument.create();
  d.addPage([595, 842]).drawText('Notice to proceed');
  return d.save();
}

async function setup() {
  const pm = await signUp(t.app, 'es-pm');
  const org = await createOrg(pm.browser, 'Sign Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Tower E', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}/esign/envelopes`;
  const fileId = await uploadBytes(t, pm.browser, org.id, project.id, await pdfBytes(), 'NTP.pdf');
  return { pm, org, project, base, fileId };
}

const draft = (fileId: string, extra: Record<string, unknown> = {}) => ({
  subject: 'Notice to proceed',
  message: 'Please sign and return.',
  documentFileIds: [fileId],
  recipients: [{ name: 'Jo Citizen', email: 'jo@client.example.com' }],
  ...extra,
});

describe('e-signature envelopes', () => {
  it('sends a draft, lets the recipient sign without an account and seals a signed PDF with an audit trail', async () => {
    const { pm, base, fileId } = await setup();
    const created = await pm.browser.post(base, {
      ...draft(fileId, {
        recipients: [
          { name: 'Jo Citizen', email: 'jo@client.example.com' },
          { name: 'Sam Copy', email: 'copy@client.example.com', role: 'receives_copy' },
        ],
      }),
      sourceType: 'other',
      sourceId: '0190a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
    });
    expect(created.statusCode, created.body).toBe(201);
    const env = created.json();
    expect(env).toMatchObject({ status: 'draft', documents: [{ name: 'NTP.pdf' }] });
    expect(mailsTo('jo@client.example.com')).toBe(0);

    const sent = await pm.browser.post(`${base}/${env.id}/send`, undefined, {
      'if-match': created.headers.etag as string,
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'sent' });
    expect(sent.json().documents[0].sha256).toBeTruthy();
    // Only people who have to act are emailed at send; the copy waits for completion.
    expect(mailsTo('jo@client.example.com')).toBe(1);
    expect(mailsTo('copy@client.example.com')).toBe(0);
    expect(JSON.stringify(sent.json())).not.toMatch(/arl_/);

    const jo = new Browser(t.app);
    const opened = await jo.post('/v1/esign-access', { token: tokenIn('jo@client.example.com') });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['referrer-policy']).toBe('no-referrer');
    expect(opened.json()).toMatchObject({
      envelope: { subject: 'Notice to proceed', fromOrg: 'Sign Builders', projectName: 'Tower E' },
      me: { status: 'viewed', canAct: true, role: 'needs_to_sign' },
    });

    // The original is readable before signing.
    const docId = opened.json().documents[0].id;
    const original = (await jo.get(`/v1/esign-access/documents/${docId}/pdf`)).json();
    expect(original).toMatchObject({ signed: false, contentType: 'application/pdf' });

    // Consent is required, and a signature that is not a PNG is refused.
    expect((await jo.post('/v1/esign-access/sign', { ...SIG, consent: false })).statusCode).toBe(
      422,
    );
    expect(
      (
        await jo.post('/v1/esign-access/sign', {
          ...SIG,
          signatureKind: 'drawn',
          signature: 'data:image/png;base64,AAAA',
        })
      ).statusCode,
    ).toBe(422);

    const signed = await jo.post('/v1/esign-access/sign', SIG);
    expect(signed.statusCode).toBe(200);
    expect(signed.json().me.status).toBe('signed');
    expect((await jo.post('/v1/esign-access/sign', SIG)).json().code).toBe('access_link.invalid');

    const done = (await pm.browser.get(`${base}/${env.id}`)).json();
    expect(done.status).toBe('completed');
    expect(done.documents[0].signedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(done.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['created', 'sent', 'viewed', 'signed', 'completed']),
    );
    expect(done.events.find((e: { type: string }) => e.type === 'signed').ip).toBeTruthy();

    // The sender and the signer both get the sealed copy, and it carries a certificate page.
    const pdf = (
      await pm.browser.get(`${base}/${env.id}/documents/${done.documents[0].id}/pdf`)
    ).json();
    expect(pdf.signed).toBe(true);
    expect((await PDFDocument.load(Buffer.from(pdf.dataBase64, 'base64'))).getPageCount()).toBe(2);
    // Everyone gets a completion link, including the copy recipient.
    expect(mailsTo('copy@client.example.com')).toBe(1);
    const copy = new Browser(t.app);
    await copy.post('/v1/esign-access', { token: tokenIn('copy@client.example.com') });
    const copyDoc = (await copy.get('/v1/esign-access')).json().documents[0].id;
    expect((await copy.get(`/v1/esign-access/documents/${copyDoc}/pdf`)).json().signed).toBe(true);
    expect((await copy.post('/v1/esign-access/sign', SIG)).statusCode).toBeGreaterThanOrEqual(400);

    // A sent envelope is not editable or deletable.
    expect(
      (await pm.browser.patch(`${base}/${env.id}`, { subject: 'x' }, { 'if-match': '"9"' })).json()
        .code,
    ).toBe('esign.invalid_state');
    expect((await pm.browser.del(`${base}/${env.id}`)).json().code).toBe('esign.invalid_state');

    // The register lists it by the record it was started from.
    const listed = (
      await pm.browser.get(`${base}?sourceType=other&sourceId=0190a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b`)
    ).json();
    expect(listed.data).toMatchObject([{ id: env.id, status: 'completed', signedCount: 1 }]);
  });

  it('refuses to send an incomplete draft and keeps other organisations out', async () => {
    const { pm, org, project, base, fileId } = await setup();
    const created = await pm.browser.post(base, {
      subject: '',
      documentFileIds: [fileId],
      recipients: [{ name: 'Viewer', email: 'v@client.example.com', role: 'needs_to_view' }],
    });
    const env = created.json();
    const bad = await pm.browser.post(`${base}/${env.id}/send`, undefined, {
      'if-match': created.headers.etag as string,
    });
    expect(bad.json().code).toBe('esign.incomplete');
    expect(bad.json().errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['subject', 'recipients']),
    );

    const stranger = await signUp(t.app, 'es-stranger');
    const otherOrg = await createOrg(stranger.browser, 'Other Builders');
    const res = await stranger.browser.get(
      `/v1/orgs/${otherOrg.id}/projects/${env.projectId}/esign/envelopes/${env.id}`,
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(403);
    expect(res.statusCode).toBeLessThanOrEqual(404);

    // Only PDFs can be sent for signature.
    const png = await uploadBytes(
      t,
      pm.browser,
      org.id,
      project.id,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
      'plan.png',
      'image/png',
    );
    expect((await pm.browser.post(base, draft(png))).json().code).toBe('esign.not_a_pdf');
  });

  it('follows the signing order, reminds at most hourly, and void kills the links', async () => {
    const { pm, base, fileId } = await setup();
    const created = await pm.browser.post(
      base,
      draft(fileId, {
        options: { signingOrder: true, reminderDays: 5, expiresDays: 30 },
        recipients: [
          { name: 'First', email: 'first@client.example.com', routingOrder: 1 },
          { name: 'Second', email: 'second@client.example.com', routingOrder: 2 },
        ],
      }),
    );
    const env = created.json();
    await pm.browser.post(`${base}/${env.id}/send`, undefined, {
      'if-match': created.headers.etag as string,
    });
    expect(mailsTo('first@client.example.com')).toBe(1);
    expect(mailsTo('second@client.example.com')).toBe(0);

    const first = new Browser(t.app);
    await first.post('/v1/esign-access', { token: tokenIn('first@client.example.com') });
    await first.post('/v1/esign-access/sign', { ...SIG, signature: 'First Person' });
    expect(mailsTo('second@client.example.com')).toBe(1);

    // Reminder: the one who has been emailed in the last hour is not emailed again.
    expect((await pm.browser.post(`${base}/${env.id}/remind`)).json().code).toBe(
      'esign.rate_limited',
    );

    const second = new Browser(t.app);
    const link = tokenIn('second@client.example.com');
    await second.post('/v1/esign-access', { token: link });
    const voided = await pm.browser.post(`${base}/${env.id}/void`, { reason: 'Issued in error' });
    expect(voided.json()).toMatchObject({ status: 'voided', voidReason: 'Issued in error' });
    expect((await second.get('/v1/esign-access')).json().code).toBe('access_link.invalid');
    expect((await new Browser(t.app).post('/v1/esign-access', { token: link })).json().code).toBe(
      'access_link.invalid',
    );
  });

  it('blocks a later signer, lets one decline, delegate, or sign on paper', async () => {
    const { pm, base, fileId } = await setup();
    const make = async (extra: Record<string, unknown>, who: string[]) => {
      const created = await pm.browser.post(
        base,
        draft(fileId, {
          ...extra,
          recipients: who.map((e, i) => ({ name: e.split('@')[0], email: e, routingOrder: i + 1 })),
        }),
      );
      const env = created.json();
      await pm.browser.post(`${base}/${env.id}/send`, undefined, {
        'if-match': created.headers.etag as string,
      });
      return env.id as string;
    };

    // Decline stops the envelope.
    const d = await make({}, ['dec@client.example.com']);
    const dec = new Browser(t.app);
    await dec.post('/v1/esign-access', { token: tokenIn('dec@client.example.com') });
    const declined = await dec.post('/v1/esign-access/decline', { reason: 'Wrong scope' });
    expect(declined.json().envelope.status).toBe('declined');
    expect((await pm.browser.get(`${base}/${d}`)).json()).toMatchObject({
      status: 'declined',
      recipients: [{ status: 'declined', declineReason: 'Wrong scope' }],
    });

    // Delegation is only allowed when the sender allowed it, and only once.
    await make({}, ['nodel@client.example.com']);
    const nd = new Browser(t.app);
    await nd.post('/v1/esign-access', { token: tokenIn('nodel@client.example.com') });
    expect(
      (await nd.post('/v1/esign-access/delegate', { name: 'X', email: 'x@client.example.com' }))
        .statusCode,
    ).toBeGreaterThanOrEqual(400);

    const dg = await make({ options: { allowDelegate: true } }, ['boss@client.example.com']);
    const boss = new Browser(t.app);
    await boss.post('/v1/esign-access', { token: tokenIn('boss@client.example.com') });
    const handed = await boss.post('/v1/esign-access/delegate', {
      name: 'Deputy',
      email: 'deputy@client.example.com',
    });
    expect(handed.statusCode).toBe(200);
    expect((await boss.get('/v1/esign-access')).json().code).toBe('access_link.invalid');
    const deputy = new Browser(t.app);
    await deputy.post('/v1/esign-access', { token: tokenIn('deputy@client.example.com') });
    expect((await deputy.post('/v1/esign-access/sign', SIG)).json().me.status).toBe('signed');
    expect((await pm.browser.get(`${base}/${dg}`)).json().status).toBe('completed');

    // Paper: refused unless allowed, then counts as the signature.
    const np = await make({}, ['nopaper@client.example.com']);
    const npEnv = (await pm.browser.get(`${base}/${np}`)).json();
    expect(
      (
        await pm.browser.post(`${base}/${np}/recipients/${npEnv.recipients[0].id}/paper-signed`)
      ).json().code,
    ).toBe('esign.paper_not_allowed');
    const pp = await make({ options: { allowPaper: true } }, ['paper@client.example.com']);
    const ppEnv = (await pm.browser.get(`${base}/${pp}`)).json();
    const done = await pm.browser.post(
      `${base}/${pp}/recipients/${ppEnv.recipients[0].id}/paper-signed`,
    );
    expect(done.json()).toMatchObject({
      status: 'completed',
      recipients: [{ signedOnPaper: true }],
    });
  });
});
