import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  Browser,
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

async function setup() {
  const pm = await signUp(t.app, 'est-pm');
  const tilerA = await signUp(t.app, 'est-tilera');
  const tilerB = await signUp(t.app, 'est-tilerb');
  const outsider = await signUp(t.app, 'est-sparky');
  const org = await createOrg(pm.browser, 'Tender Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower T', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const coA = await addMember(
    pm.browser,
    org.id,
    project.id,
    tilerA.email,
    'Subcontractor',
    'Tiles A',
  );
  const coB = await addMember(
    pm.browser,
    org.id,
    project.id,
    tilerB.email,
    'Subcontractor',
    'Tiles B',
  );
  await addMember(pm.browser, org.id, project.id, outsider.email, 'Subcontractor', 'Sparky');
  // A client has no commitments access at all.
  const viewer = await signUp(t.app, 'est-client');
  await addMember(pm.browser, org.id, project.id, viewer.email, 'Client', 'Client Co');
  return { pm, tilerA, tilerB, outsider, viewer, org, project, base, coA, coB };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;
const scope = [
  { key: 'floor', description: 'Floor tiles', quantity: '120', unit: 'm2', source: 'typed' },
  { key: 'wall', description: 'Wall tiles', quantity: '96', unit: 'm2', source: 'typed' },
];

describe('tender packages and quotes (product/10)', () => {
  it('invites, collects quotes company by company, versions a revised quote and awards with a reason', async () => {
    const s = await setup();
    const draft = await s.pm.browser.post(`${s.base}/tender-packages`, {
      name: 'Tiling',
      trade: 'Tiling',
      dueAt: '2031-01-15T05:00:00Z',
      scope,
    });
    expect(draft.statusCode).toBe(201);
    const pkg = draft.json();
    expect(pkg).toMatchObject({ number: 1, numberLabel: 'TP-001', status: 'draft' });

    // A package needs an invite before it goes out; a draft is invisible to subcontractors.
    const early = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/transition`,
      { action: 'send' },
      { 'if-match': etagOf(draft) },
    );
    expect(early.json().code).toBe('tender.incomplete');
    const invited = await s.pm.browser.post(`${s.base}/tender-packages/${pkg.id}/invites`, {
      companyIds: [s.coA.companyId, s.coB.companyId],
    });
    expect(invited.statusCode).toBe(200);
    expect(invited.json().invites).toHaveLength(2);
    // Inviting again changes nothing.
    expect(
      (
        await s.pm.browser.post(`${s.base}/tender-packages/${pkg.id}/invites`, {
          companyIds: [s.coA.companyId],
        })
      ).json().invites,
    ).toHaveLength(2);
    expect((await s.tilerA.browser.get(`${s.base}/tender-packages/${pkg.id}`)).statusCode).toBe(
      404,
    );

    const sent = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/transition`,
      { action: 'send' },
      { 'if-match': etagOf(draft) },
    );
    expect(sent.json().status).toBe('out_to_tender');

    // Invited companies see it with only their own invite; others don't see it at all (EST-AC3).
    const seen = await s.tilerA.browser.get(`${s.base}/tender-packages/${pkg.id}`);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().invites.map((i: { companyId: string }) => i.companyId)).toEqual([
      s.coA.companyId,
    ]);
    expect((await s.outsider.browser.get(`${s.base}/tender-packages/${pkg.id}`)).statusCode).toBe(
      404,
    );
    expect((await s.outsider.browser.get(`${s.base}/tender-packages`)).json().data).toEqual([]);
    expect((await s.tilerA.browser.get(`${s.base}/tender-packages`)).json().data).toHaveLength(1);
    expect(
      (
        await s.tilerA.browser.patch(
          `${s.base}/tender-packages/${pkg.id}`,
          { name: 'Mine now' },
          { 'if-match': etagOf(seen) },
        )
      ).statusCode,
    ).toBe(403);

    // Each subcontractor quotes for their own company, with the PDF attached.
    const pdf = await uploadFile(
      t,
      s.tilerA.browser,
      s.org.id,
      s.project.id,
      'quote.pdf',
      'estimating',
    );
    const qa1 = await s.tilerA.browser.post(`${s.base}/tender-packages/${pkg.id}/quotes`, {
      reference: 'Q-100',
      fileIds: [pdf],
      validUntil: '2031-03-01',
      lines: [
        {
          scopeKey: 'floor',
          description: 'Floor tiling',
          amount: '4120.00',
          quantity: '120',
          unit: 'm2',
        },
        { scopeKey: 'wall', description: 'Wall tiling', amount: '7980.00' },
      ],
      exclusions: [{ text: 'Waterproofing by others', scopeKey: 'wall' }],
    });
    expect(qa1.statusCode).toBe(201);
    expect(qa1.json()).toMatchObject({
      revision: 1,
      status: 'ready_to_review',
      totalExGst: '12100.00',
      gst: '1210.00',
      companyId: s.coA.companyId,
      fileIds: [pdf],
    });
    const wrongCompany = await s.tilerB.browser.post(`${s.base}/tender-packages/${pkg.id}/quotes`, {
      companyId: s.coA.companyId,
      lines: [{ description: 'x', amount: '1.00' }],
    });
    expect(wrongCompany.statusCode).toBe(403);
    const badKey = await s.tilerB.browser.post(`${s.base}/tender-packages/${pkg.id}/quotes`, {
      lines: [{ scopeKey: 'roof', description: 'Roof', amount: '1.00' }],
    });
    expect(badKey.json().code).toBe('quote.unknown_scope_key');
    const qb = await s.tilerB.browser.post(`${s.base}/tender-packages/${pkg.id}/quotes`, {
      lines: [
        { scopeKey: 'floor', description: 'Floors', amount: '4000.00' },
        { scopeKey: 'wall', description: 'Walls', amount: '7000.00' },
      ],
    });
    expect(qb.json().totalExGst).toBe('11000.00');

    // Quotes are company-scoped: A sees only A's; the PM sees everyone's (EST-AC3).
    const aList = (await s.tilerA.browser.get(`${s.base}/tender-packages/${pkg.id}/quotes`)).json()
      .data;
    expect(aList.map((q: { id: string }) => q.id)).toEqual([qa1.json().id]);
    expect(
      (await s.tilerA.browser.get(`${s.base}/tender-packages/${pkg.id}/quotes/${qb.json().id}`))
        .statusCode,
    ).toBe(404);
    expect(
      (await s.pm.browser.get(`${s.base}/tender-packages/${pkg.id}/quotes`)).json().data,
    ).toHaveLength(2);
    const afterQuotes = await s.pm.browser.get(`${s.base}/tender-packages/${pkg.id}`);
    expect(afterQuotes.json().invites.map((i: { status: string }) => i.status)).toEqual([
      'submitted',
      'submitted',
    ]);

    // A revised quote supersedes the first, and both are kept (EST-AC4).
    const qa2 = await s.tilerA.browser.post(`${s.base}/tender-packages/${pkg.id}/quotes`, {
      lines: [
        { scopeKey: 'floor', description: 'Floor tiling', amount: '3900.00' },
        { scopeKey: 'wall', description: 'Wall tiling', amount: '7500.00' },
      ],
    });
    expect(qa2.json()).toMatchObject({ revision: 2, totalExGst: '11400.00' });
    const all = (await s.pm.browser.get(`${s.base}/tender-packages/${pkg.id}/quotes`)).json().data;
    expect(
      all
        .filter((q: { companyId: string }) => q.companyId === s.coA.companyId)
        .map((q: { status: string }) => q.status),
    ).toEqual(['superseded', 'ready_to_review']);

    // Only the estimator confirms; unconfirmed quotes can't be awarded.
    const selfConfirm = await s.tilerA.browser.post(
      `${s.base}/tender-packages/${pkg.id}/quotes/${qa2.json().id}/confirm`,
      undefined,
      { 'if-match': etagOf(qa2) },
    );
    expect(selfConfirm.statusCode).toBe(403);
    const unconfirmed = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/award`,
      { quoteId: qa2.json().id },
      { 'if-match': etagOf(afterQuotes) },
    );
    expect(unconfirmed.json().code).toBe('quote.invalid_state');
    const ca = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/quotes/${qa2.json().id}/confirm`,
      undefined,
      { 'if-match': etagOf(qa2) },
    );
    expect(ca.json()).toMatchObject({ status: 'confirmed', confirmedBy: s.pm.userId });
    const cb = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/quotes/${qb.json().id}/confirm`,
      undefined,
      { 'if-match': etagOf(qb) },
    );
    expect(cb.json().status).toBe('confirmed');

    // Allowances for B's gap make A the cheaper quote; awarding B then needs a reason (EST-AC6, AC7).
    const allowed = await s.pm.browser.put(
      `${s.base}/tender-packages/${pkg.id}/allowances`,
      { allowances: { [`${qb.json().id}:wall`]: '2000.00' } },
      { 'if-match': etagOf(afterQuotes) },
    );
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().allowances).toEqual({ [`${qb.json().id}:wall`]: '2000.00' });
    expect(
      (await s.tilerA.browser.get(`${s.base}/tender-packages/${pkg.id}`)).json().allowances,
    ).toEqual({});
    expect(
      (await s.pm.browser.post(`${s.base}/tender-packages/${pkg.id}/subcontract`)).json().code,
    ).toBe('tender.invalid_state');
    expect(
      (
        await s.pm.browser.post(`${s.base}/tender-packages/${pkg.id}/commitment`, {
          budgetLineId: 'bln_00000000000000000000000000',
        })
      ).json().code,
    ).toBe('tender.invalid_state');
    const noReason = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/award`,
      { quoteId: qb.json().id },
      { 'if-match': etagOf(allowed) },
    );
    expect(noReason.json().code).toBe('tender.reason_required');
    const awarded = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/award`,
      { quoteId: qb.json().id, reason: 'Best programme and references' },
      { 'if-match': etagOf(allowed) },
    );
    expect(awarded.json()).toMatchObject({
      status: 'awarded',
      award: {
        quoteId: qb.json().id,
        by: s.pm.userId,
        notLowest: true,
        reason: 'Best programme and references',
      },
    });
    // The award is the estimator's record; subcontractors don't see it.
    expect(
      (await s.tilerA.browser.get(`${s.base}/tender-packages/${pkg.id}`)).json().award,
    ).toBeNull();

    // Awarding raises the draft subcontract from the winning quote, once, for the winning company.
    const raised = await s.pm.browser.post(`${s.base}/tender-packages/${pkg.id}/subcontract`);
    expect(raised.statusCode).toBe(200);
    expect(raised.json()).toMatchObject({ created: true });
    expect(
      (await s.tilerA.browser.post(`${s.base}/tender-packages/${pkg.id}/subcontract`)).statusCode,
    ).toBeGreaterThanOrEqual(400);
    const again = await s.pm.browser.post(`${s.base}/tender-packages/${pkg.id}/subcontract`);
    expect(again.json()).toMatchObject({ created: false, contractId: raised.json().contractId });
    const contract = await s.pm.browser.get(`${s.base}/contracts/${raised.json().contractId}`);
    expect(contract.json().contract).toMatchObject({
      kind: 'subcontract',
      status: 'draft',
      payeeCompanyId: s.coB.companyId,
      originalValue: raised.json().originalValue,
    });

    // The same award can raise the budget commitment against a chosen budget line, once.
    const code = (
      await s.pm.browser.post(`${s.base}/cost-codes`, { code: '09-200', description: 'Tiling' })
    ).json();
    await s.pm.browser.post(`${s.base}/budget`);
    const line = (
      await s.pm.browser.post(`${s.base}/budget/lines`, {
        costCodeId: code.id,
        original: '90000.00',
      })
    ).json();
    const raisedCommitment = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/commitment`,
      { budgetLineId: line.id },
    );
    expect(raisedCommitment.statusCode).toBe(200);
    expect(raisedCommitment.json()).toMatchObject({
      created: true,
      total: raised.json().originalValue,
    });
    const repeatCommitment = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/commitment`,
      { budgetLineId: line.id },
    );
    expect(repeatCommitment.json()).toMatchObject({
      created: false,
      commitmentId: raisedCommitment.json().commitmentId,
    });
    const commitment = await s.pm.browser.get(
      `${s.base}/commitments/${raisedCommitment.json().commitmentId}`,
    );
    expect(commitment.json().commitment).toMatchObject({
      kind: 'subcontract',
      status: 'draft',
      vendorCompanyId: s.coB.companyId,
    });
    expect(
      (
        await s.tilerA.browser.post(`${s.base}/tender-packages/${pkg.id}/commitment`, {
          budgetLineId: line.id,
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);

    // After the award: no more quotes, no edits, and the winning quote can't be declined.
    const late = await s.tilerA.browser.post(`${s.base}/tender-packages/${pkg.id}/quotes`, {
      lines: [{ description: 'Late', amount: '1.00' }],
    });
    expect(late.json().code).toBe('tender.invalid_state');
    const decline = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.id}/quotes/${qb.json().id}/decline`,
      undefined,
      { 'if-match': etagOf(cb) },
    );
    expect(decline.statusCode).toBe(409);
  });

  it('corrects a quote before confirming and checks documents and scope', async () => {
    const s = await setup();
    const dup = await s.pm.browser.post(`${s.base}/tender-packages`, {
      name: 'Dup',
      trade: 'Tiling',
      scope: [scope[0], scope[0]],
    });
    expect(dup.json().code).toBe('tender.invalid_scope');
    const stranger = await s.pm.browser.post(`${s.base}/tender-packages`, {
      name: 'Docs',
      trade: 'Tiling',
      documents: [{ kind: 'document', id: 'doc_00000000000000000000000000' }],
    });
    expect(stranger.statusCode).toBeGreaterThanOrEqual(400);

    const pkg = await s.pm.browser.post(`${s.base}/tender-packages`, {
      name: 'Tiling',
      trade: 'Tiling',
      dueAt: '2031-01-15T05:00:00Z',
      scope,
    });
    await s.pm.browser.post(`${s.base}/tender-packages/${pkg.json().id}/invites`, {
      companyIds: [s.coA.companyId],
    });
    const fresh = await s.pm.browser.get(`${s.base}/tender-packages/${pkg.json().id}`);
    await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.json().id}/transition`,
      { action: 'send' },
      { 'if-match': etagOf(fresh) },
    );
    // Builder staff enter a quote for an invited company, and fix it before confirming.
    const q = await s.pm.browser.post(`${s.base}/tender-packages/${pkg.json().id}/quotes`, {
      companyId: s.coA.companyId,
      lines: [{ scopeKey: 'floor', description: 'Floor', amount: '100.10' }],
    });
    expect(q.statusCode).toBe(201);
    const fixed = await s.pm.browser.patch(
      `${s.base}/tender-packages/${pkg.json().id}/quotes/${q.json().id}`,
      {
        reference: 'Q-9',
        lines: [
          { id: q.json().lines[0].id, scopeKey: 'floor', description: 'Floor', amount: '100.20' },
          { description: 'Site establishment', amount: '50.00', isProvisional: true },
        ],
      },
      { 'if-match': etagOf(q) },
    );
    expect(fixed.json()).toMatchObject({ reference: 'Q-9', totalExGst: '150.20', gst: '15.02' });
    expect(fixed.json().lines[0].id).toBe(q.json().lines[0].id);
    const notInvited = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.json().id}/quotes`,
      {
        companyId: s.coB.companyId,
        lines: [{ description: 'x', amount: '1.00' }],
      },
    );
    expect(notInvited.json().code).toBe('quote.company_not_invited');
    const confirmed = await s.pm.browser.post(
      `${s.base}/tender-packages/${pkg.json().id}/quotes/${q.json().id}/confirm`,
      undefined,
      { 'if-match': etagOf(fixed) },
    );
    expect(confirmed.json().status).toBe('confirmed');
    const edit = await s.pm.browser.patch(
      `${s.base}/tender-packages/${pkg.json().id}/quotes/${q.json().id}`,
      { reference: 'again' },
      { 'if-match': etagOf(confirmed) },
    );
    expect(edit.json().code).toBe('quote.invalid_state');
  });

  it('refuses people with no commitments access, on quotes and on quote uploads', async () => {
    const s = await setup();
    const pkg = await s.pm.browser.post(`${s.base}/tender-packages`, {
      name: 'Tiling',
      trade: 'Tiling',
      dueAt: '2031-01-15T05:00:00Z',
      scope,
    });
    const id = pkg.json().id;
    await s.pm.browser.post(`${s.base}/tender-packages/${id}/invites`, {
      companyIds: [s.coA.companyId],
    });
    for (const path of ['', '/quotes']) {
      const res = await s.viewer.browser.get(`${s.base}/tender-packages/${id}${path}`);
      expect(res.statusCode).toBe(403);
    }
    expect((await s.viewer.browser.get(`${s.base}/tender-packages`)).statusCode).toBe(403);
    const quote = await s.viewer.browser.post(`${s.base}/tender-packages/${id}/quotes`, {
      lines: [{ description: 'x', amount: '1.00' }],
    });
    expect(quote.statusCode).toBe(403);
    // No quote PDFs either: the upload permission is the submit permission.
    await expect(
      uploadFile(t, s.viewer.browser, s.org.id, s.project.id, 'quote.pdf', 'estimating'),
    ).rejects.toThrow(/403/);
  });
  it('shows the bid board to staff only, with invitee answers and the lowest levelled price', async () => {
    const s = await setup();
    const make = async (name: string, trade: string, dueAt: string) => {
      const res = await s.pm.browser.post(`${s.base}/tender-packages`, {
        name,
        trade,
        dueAt,
        scope,
      });
      return res.json();
    };
    const tiling = await make('Tiling', 'Tiling', '2031-01-15T05:00:00Z');
    await make('Electrical', 'Electrical', '2030-01-15T05:00:00Z');
    await s.pm.browser.post(`${s.base}/tender-packages/${tiling.id}/invites`, {
      companyIds: [s.coA.companyId, s.coB.companyId],
    });
    const draft = await s.pm.browser.get(`${s.base}/tender-packages/${tiling.id}`);
    await s.pm.browser.post(
      `${s.base}/tender-packages/${tiling.id}/transition`,
      { action: 'send' },
      { 'if-match': etagOf(draft) },
    );
    const quoted = await s.tilerA.browser.post(`${s.base}/tender-packages/${tiling.id}/quotes`, {
      lines: [
        { scopeKey: 'floor', description: 'Floor', amount: '4000.00' },
        { scopeKey: 'wall', description: 'Wall', amount: '7000.00' },
      ],
    });
    await s.pm.browser.post(
      `${s.base}/tender-packages/${tiling.id}/quotes/${quoted.json().id}/confirm`,
      undefined,
      { 'if-match': etagOf(quoted) },
    );

    const board = await s.pm.browser.get(`/v1/orgs/${s.org.id}/bid-board`);
    expect(board.statusCode).toBe(200);
    const rows = board.json().data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.name)).toEqual(['Electrical', 'Tiling']);
    expect(rows[1]).toMatchObject({
      projectName: 'Tower T',
      status: 'out_to_tender',
      dueState: 'open',
      quotesConfirmed: 1,
      quotesToReview: 0,
      lowestExGst: '11000.00',
      invites: { submitted: 1, invited: 1, awaiting: 1 },
    });
    expect(rows[0]).toMatchObject({ status: 'draft', dueState: null, lowestExGst: null });

    const filtered = await s.pm.browser.get(`/v1/orgs/${s.org.id}/bid-board?status=draft`);
    expect(filtered.json().data).toHaveLength(1);

    // Subcontractors and clients never reach the board.
    for (const who of [s.tilerA, s.viewer]) {
      expect((await who.browser.get(`/v1/orgs/${s.org.id}/bid-board`)).statusCode).toBe(403);
    }
  });
  it('keeps reusable bidder lists for staff, checks companies and refuses outsiders', async () => {
    const s = await setup();
    const base = `/v1/orgs/${s.org.id}/bidder-lists`;
    const made = await s.pm.browser.post(base, {
      name: 'Usual tilers',
      trade: 'Tiling',
      companyIds: [s.coA.companyId, s.coB.companyId, s.coA.companyId],
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ name: 'Usual tilers', trade: 'Tiling', version: 1 });
    expect(made.json().companyIds).toEqual([s.coA.companyId, s.coB.companyId]);

    const dup = await s.pm.browser.post(base, { name: 'usual TILERS' });
    expect(dup.json().code).toBe('bidder_list.name_taken');
    const bad = await s.pm.browser.post(base, {
      name: 'Ghosts',
      companyIds: ['cmp_00000000000000000000000000'],
    });
    expect(bad.statusCode).toBe(422);

    const renamed = await s.pm.browser.patch(
      `${base}/${made.json().id}`,
      { name: 'Tilers A and B', companyIds: [s.coA.companyId] },
      { 'if-match': etagOf(made) },
    );
    expect(renamed.json()).toMatchObject({ name: 'Tilers A and B', version: 2 });
    expect(renamed.json().companyIds).toEqual([s.coA.companyId]);
    const stale = await s.pm.browser.patch(
      `${base}/${made.json().id}`,
      { trade: 'Floors' },
      { 'if-match': etagOf(made) },
    );
    expect(stale.statusCode).toBe(412);

    await s.pm.browser.post(base, { name: 'Sparkies', trade: 'Electrical' });
    expect((await s.pm.browser.get(base)).json().data.map((l: { name: string }) => l.name)).toEqual(
      ['Sparkies', 'Tilers A and B'],
    );
    expect((await s.pm.browser.get(`${base}?trade=Tiling`)).json().data).toHaveLength(1);

    for (const who of [s.tilerA, s.viewer]) {
      expect((await who.browser.get(base)).statusCode).toBe(403);
      expect((await who.browser.post(base, { name: 'Mine' })).statusCode).toBe(403);
    }
    expect((await s.pm.browser.del(`${base}/${made.json().id}`)).statusCode).toBe(204);
    expect((await s.pm.browser.get(base)).json().data).toHaveLength(1);
  });
});

describe('tender invite links (X45)', () => {
  const tokenIn = (to: string) => {
    const mail = t.messages.sent.filter((m) => m.to === to).at(-1)!;
    return /\/q\/(arl_[A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  };

  it('emails each invited company its own link once the package goes out, and lets it answer', async () => {
    const pm = await signUp(t.app, 'inv-pm');
    const org = await createOrg(pm.browser, 'Invite Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Tower Q', state: 'QLD' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const a = await signUp(t.app, 'inv-a');
    const b = await signUp(t.app, 'inv-b');
    const coA = await addMember(
      pm.browser,
      org.id,
      project.id,
      a.email,
      'Subcontractor',
      'Inv A',
      [],
      'bids@inv-a.example.com',
    );
    const coB = await addMember(pm.browser, org.id, project.id, b.email, 'Subcontractor', 'Inv B');

    const draft = await pm.browser.post(`${base}/tender-packages`, {
      name: 'Tiling',
      trade: 'Tiling',
      dueAt: '2031-01-15T05:00:00Z',
      scope,
    });
    const pkg = draft.json();
    await pm.browser.post(`${base}/tender-packages/${pkg.id}/invites`, {
      companyIds: [coA.companyId, coB.companyId],
    });
    // Nothing goes out while the package is a draft.
    expect(t.messages.sent.filter((m) => m.to === 'bids@inv-a.example.com')).toHaveLength(0);

    const sent = await pm.browser.post(
      `${base}/tender-packages/${pkg.id}/transition`,
      { action: 'send' },
      {
        'if-match': (await pm.browser.get(`${base}/tender-packages/${pkg.id}`)).headers
          .etag as string,
      },
    );
    expect(sent.statusCode).toBe(200);
    expect(JSON.stringify(sent.json())).not.toMatch(/arl_/);
    const byCompany = (
      body: { invites: Array<{ companyId: string; deliveredAt: string | null }> },
      id: string,
    ) => body.invites.find((i) => i.companyId === id)!;
    expect(byCompany(sent.json(), coA.companyId).deliveredAt).toBeTruthy();
    // No address on the company record: nothing is sent, and the invite says so.
    expect(byCompany(sent.json(), coB.companyId).deliveredAt).toBeNull();
    expect(t.messages.sent.filter((m) => m.to === 'bids@inv-a.example.com')).toHaveLength(1);

    const guest = new Browser(t.app);
    const first = tokenIn('bids@inv-a.example.com');
    const opened = await guest.post('/v1/tender-access', { token: first });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['referrer-policy']).toBe('no-referrer');
    expect(opened.json()).toMatchObject({
      package: { number: 'TP-001', name: 'Tiling', fromOrg: 'Invite Builder' },
      invite: { status: 'viewed' },
    });
    // The guest sees the scope wording only: no quantities, no other bidders.
    expect(JSON.stringify(opened.json())).not.toMatch(/quantity|Inv B/);

    const intends = await guest.post('/v1/tender-access/respond', { response: 'intends_to_quote' });
    expect(intends.json().invite.status).toBe('intends_to_quote');
    const seen = (await pm.browser.get(`${base}/tender-packages/${pkg.id}`)).json();
    expect(byCompany(seen, coA.companyId)).toMatchObject({ status: 'intends_to_quote' });

    // The builder cannot resend to a company with no address.
    const none = await pm.browser.post(
      `${base}/tender-packages/${pkg.id}/invites/${coB.companyId}/resend`,
    );
    expect(none.json().code).toBe('tender.no_contact_email');

    // A lost email: resend replaces the link, and the old one stops working at once.
    const resent = await pm.browser.post(
      `${base}/tender-packages/${pkg.id}/invites/${coA.companyId}/resend`,
    );
    expect(resent.statusCode).toBe(200);
    expect(tokenIn('bids@inv-a.example.com')).not.toBe(first);
    expect((await guest.get('/v1/tender-access')).json().code).toBe('access_link.invalid');
    expect((await new Browser(t.app).post('/v1/tender-access', { token: first })).json().code).toBe(
      'access_link.invalid',
    );

    // No cookie, no access; and a link ends with the tender.
    expect((await new Browser(t.app).get('/v1/tender-access')).json().code).toBe(
      'access_link.session_required',
    );
    const fresh = new Browser(t.app);
    expect(
      (await fresh.post('/v1/tender-access', { token: tokenIn('bids@inv-a.example.com') }))
        .statusCode,
    ).toBe(200);
    const latest = await pm.browser.get(`${base}/tender-packages/${pkg.id}`);
    await pm.browser.post(
      `${base}/tender-packages/${pkg.id}/transition`,
      { action: 'close' },
      { 'if-match': latest.headers.etag as string },
    );
    expect((await fresh.get('/v1/tender-access')).json().code).toBe('access_link.invalid');
  });
});
