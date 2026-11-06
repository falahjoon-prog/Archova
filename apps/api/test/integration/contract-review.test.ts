import { PDFDocument, StandardFonts } from 'pdf-lib';
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

async function contractPdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const rows of pages) {
    const page = doc.addPage([595, 842]);
    rows.forEach((row, i) => page.drawText(row, { x: 40, y: 790 - i * 20, size: 9, font }));
  }
  return doc.save();
}

const CONTRACT = [
  [
    '1 The contract sum is $860,000 excluding GST.',
    '12.2 Liquidated damages are $2,500 a day.',
    '14.1 The Principal holds retention of 10% of each payment.',
  ],
  ['20.1 The Contractor must give notice of delay within 5 business days.'],
];

const PLAYBOOK = {
  topics: [
    {
      key: 'ld_cap',
      topic: 'Liquidated damages',
      position: 'Liquidated damages are capped.',
      threshold: '10% of the contract sum',
      severity: 'high',
      fallback: {
        title: 'LD cap',
        wording: 'Total liquidated damages are capped at 10% of the contract sum.',
        approvedBy: 'Jo Lawyer',
        approvedOn: '2026-08-01',
        reviewBy: '2099-08-01',
      },
    },
    {
      key: 'retention',
      topic: 'Retention',
      position: 'Retention is held at no more than the limit.',
      threshold: '5%',
      severity: 'medium',
      fallback: null,
    },
  ],
};

async function setup() {
  const owner = await signUp(t.app, 'cr-owner');
  const mgr = await signUp(t.app, 'cr-mgr');
  const site = await signUp(t.app, 'cr-site');
  const org = await createOrg(owner.browser, 'Contract Builders');
  const project = await createProject(owner.browser, org.id, { name: 'Tower C', state: 'NSW' });
  const other = await createProject(owner.browser, org.id, { name: 'Tower D', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(owner.browser, org.id, project.id, mgr.email, 'Project Admin', 'Main Co');
  await addMember(owner.browser, org.id, project.id, site.email, 'Site Manager', 'Site Co');
  const file = await uploadBytes(
    t,
    owner.browser,
    org.id,
    project.id,
    await contractPdf(CONTRACT),
    'subcontract.pdf',
  );
  const elsewhere = await uploadBytes(
    t,
    owner.browser,
    org.id,
    other.id,
    await contractPdf(CONTRACT),
    'other.pdf',
  );
  return { owner, mgr, site, org, project, base, file, elsewhere };
}

const REQUEST = { contractType: 'subcontract', ourSide: 'we_pay', baseForm: 'as4000' };

describe('Nova contract review (F34)', () => {
  it('lets an org admin keep the playbook and reads it back in order', async () => {
    const s = await setup();
    const put = await s.owner.browser.put(
      `/v1/orgs/${s.org.id}/ai/contract-playbooks/subcontract`,
      PLAYBOOK,
    );
    expect(put.statusCode).toBe(200);
    expect(put.json().topics.map((x: { key: string }) => x.key)).toEqual(['ld_cap', 'retention']);
    const got = await s.owner.browser.get(`/v1/orgs/${s.org.id}/ai/contract-playbooks/subcontract`);
    expect(got.json().topics[0].fallback).toMatchObject({ approvedBy: 'Jo Lawyer' });
    // Another contract type has its own, empty playbook.
    const head = await s.owner.browser.get(
      `/v1/orgs/${s.org.id}/ai/contract-playbooks/head_contract`,
    );
    expect(head.json().topics).toEqual([]);
    // Replacing is a replace: the second call leaves only what it sent.
    const next = await s.owner.browser.put(
      `/v1/orgs/${s.org.id}/ai/contract-playbooks/subcontract`,
      { topics: [PLAYBOOK.topics[1]] },
    );
    expect(next.json().topics).toHaveLength(1);
    // Duplicate keys are refused.
    const dup = await s.owner.browser.put(
      `/v1/orgs/${s.org.id}/ai/contract-playbooks/subcontract`,
      { topics: [PLAYBOOK.topics[1], PLAYBOOK.topics[1]] },
    );
    expect(dup.statusCode).toBe(422);
  });

  it('keeps the playbook to org admins', async () => {
    const s = await setup();
    for (const user of [s.mgr, s.site]) {
      expect(
        (await user.browser.get(`/v1/orgs/${s.org.id}/ai/contract-playbooks/subcontract`))
          .statusCode,
      ).toBeGreaterThanOrEqual(403);
      expect(
        (await user.browser.put(`/v1/orgs/${s.org.id}/ai/contract-playbooks/subcontract`, PLAYBOOK))
          .statusCode,
      ).toBeGreaterThanOrEqual(403);
    }
  });

  it('reviews a contract: summary, time bars and playbook departures, each with its clause and quote', async () => {
    const s = await setup();
    await s.owner.browser.put(`/v1/orgs/${s.org.id}/ai/contract-playbooks/subcontract`, PLAYBOOK);
    const before = t.ai.calls.length;
    const res = await s.mgr.browser.post(`${s.base}/ai/contract-reviews`, {
      fileId: s.file,
      ...REQUEST,
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.runId).toMatch(/^air_/);
    expect(d.suggestionId).toMatch(/^ais_/);
    expect(d).toMatchObject({
      fileId: s.file,
      fileName: 'subcontract.pdf',
      contractType: 'subcontract',
      playbookMissing: false,
      playbookTopics: 2,
      pageCount: 2,
      unreadPages: [],
      truncated: false,
      multiState: false,
      dropped: { notOnPage: 0, bannedWords: 0, unknownTopic: 0 },
    });
    expect(d.disclaimer).toContain('This is not legal advice.');
    expect(d.summary.map((x: { key: string }) => x.key)).toEqual([
      'contract_sum',
      'retention',
      'liquidated_damages',
    ]);
    expect(d.summaryNotFound).toContain('insurance');
    expect(d.timeBars).toEqual([
      expect.objectContaining({
        event: 'delay_notice',
        days: 5,
        dayType: 'business',
        source: expect.objectContaining({ page: 2, clause: '20.1' }),
      }),
    ]);
    expect(
      d.flags.map((f: { topicKey: string; severity: string }) => [f.topicKey, f.severity]),
    ).toEqual([
      ['ld_cap', 'high'],
      ['retention', 'medium'],
    ]);
    expect(d.flags[0]).toMatchObject({
      source: { page: 1, clause: '12.2', quote: expect.stringContaining('Liquidated damages') },
      wordingStatus: 'offered',
      approvedWording: {
        wording: 'Total liquidated damages are capped at 10% of the contract sum.',
        approvedBy: 'Jo Lawyer',
        label: 'Draft wording, not legal advice. Have it reviewed before use.',
        approvalNote: expect.stringContaining('recorded by an org admin'),
      },
    });
    // No approved wording for retention: Nova offers none, and writes none.
    expect(d.flags[1]).toMatchObject({ wordingStatus: 'none', approvedWording: null });

    // The model got the playbook and the contract text, not ids.
    const call = t.ai.calls.slice(before).find((c) => c.task === 'contract.review')!;
    expect(call.text).toContain('<topic key="ld_cap">');
    expect(call.text).toContain('Liquidated damages are $2,500 a day.');
    expect(call.text).not.toContain(s.file);
  });

  it('flags only clauses that match a signed statutory rule, with the table wording, for the project state', async () => {
    const s = await setup();
    const ruleSql = `insert into ai.ai_legal_rules
      (id, rule_key, version, state, contract_types, topic, detect, wording, provision, status, signed_by, signed_on)
      values ($1, $2, 1, $3, '{subcontract}', $4, 'A clause that sets liquidated damages.', $5, 'Test Act s1', $6, $7, $8)`;
    const pool = t.adminDb.pool;
    await pool.query(ruleSql, [
      '0192a000-0000-7000-8000-00000000a001',
      'ld_rule',
      'NSW',
      'Liquidated damages',
      'May be void under Test Act s1. Get advice.',
      'signed',
      'Lawyer A',
      '2026-10-20',
    ]);
    // A draft rule, and a signed rule for another state, are never used.
    await pool.query(ruleSql, [
      '0192a000-0000-7000-8000-00000000a002',
      'ret_rule',
      'NSW',
      'Retention',
      'Draft wording',
      'draft',
      null,
      null,
    ]);
    await pool.query(ruleSql, [
      '0192a000-0000-7000-8000-00000000a003',
      'vic_rule',
      'VIC',
      'Liquidated damages',
      'VIC wording',
      'signed',
      'Lawyer B',
      '2026-10-21',
    ]);
    try {
      const run = (extra: Record<string, unknown>) =>
        s.mgr.browser.post(`${s.base}/ai/contract-reviews`, {
          fileId: s.file,
          ...REQUEST,
          ...extra,
        });
      const nsw = (await run({ state: 'NSW' })).json();
      expect(nsw).toMatchObject({ statutoryState: 'NSW', statutoryRulesChecked: 1 });
      expect(nsw.statutoryFlags).toEqual([
        expect.objectContaining({
          ruleKey: 'ld_rule',
          wording: 'May be void under Test Act s1. Get advice.',
          signedBy: 'Lawyer A',
          source: expect.objectContaining({ page: 1, clause: '12.2' }),
        }),
      ]);
      const call = t.ai.calls.filter((c) => c.task === 'contract.review').at(-1)!;
      expect(call.text).toContain('<rule key="ld_rule">');
      expect(call.text).not.toContain('ret_rule');
      expect(call.text).not.toContain('vic_rule');

      const qld = (await run({ state: 'QLD' })).json();
      expect(qld).toMatchObject({
        statutoryState: 'QLD',
        statutoryRulesChecked: 0,
        statutoryFlags: [],
      });
      // Several states, or no state: no statutory check at all.
      const multi = (await run({ state: 'NSW', multiState: true })).json();
      expect(multi).toMatchObject({
        statutoryState: null,
        statutoryRulesChecked: 0,
        statutoryFlags: [],
      });
      const none = (await run({})).json();
      expect(none).toMatchObject({ statutoryState: null, statutoryRulesChecked: 0 });
    } finally {
      await pool.query(
        `delete from ai.ai_legal_rules where id::text like '0192a000-0000-7000-8000-00000000a00%'`,
      );
    }
  });

  it('says so when there is no playbook, and still summarises', async () => {
    const s = await setup();
    const d = (
      await s.mgr.browser.post(`${s.base}/ai/contract-reviews`, {
        fileId: s.file,
        ...REQUEST,
        contractType: 'head_contract',
        multiState: true,
      })
    ).json();
    expect(d).toMatchObject({
      playbookMissing: true,
      playbookTopics: 0,
      flags: [],
      multiState: true,
    });
    expect(d.summary.length).toBeGreaterThan(0);
  });

  it('lets the commercial team list and decide a review, and no one else open it', async () => {
    const s = await setup();
    const made = (
      await s.owner.browser.post(`${s.base}/ai/contract-reviews`, { fileId: s.file, ...REQUEST })
    ).json();
    const mine = (await s.mgr.browser.get(`${s.base}/ai/suggestions?task=contract.review`)).json();
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0]).toMatchObject({
      id: made.suggestionId,
      task: 'contract.review',
      targetType: 'contract_file',
      targetId: s.file,
      payload: { fileId: s.file, fileName: 'subcontract.pdf' },
    });
    // A site manager has no commercial role: they see no review and can't decide it.
    expect(
      (await s.site.browser.get(`${s.base}/ai/suggestions?task=contract.review`)).json().data,
    ).toEqual([]);
    expect(
      (
        await s.site.browser.post(`${s.base}/ai/suggestions/${made.suggestionId}/decision`, {
          decision: 'rejected',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await s.mgr.browser.post(`${s.base}/ai/suggestions/${made.suggestionId}/decision`, {
          decision: 'rejected',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('lists reviews and records a decision on a flag, keeping the history', async () => {
    const s = await setup();
    await s.owner.browser.put(`/v1/orgs/${s.org.id}/ai/contract-playbooks/subcontract`, PLAYBOOK);
    const made = (
      await s.mgr.browser.post(`${s.base}/ai/contract-reviews`, { fileId: s.file, ...REQUEST })
    ).json();
    expect(made.decisions).toEqual([]);
    const listed = (await s.mgr.browser.get(`${s.base}/ai/contract-reviews`)).json();
    expect(listed.data.map((r: { suggestionId: string }) => r.suggestionId)).toEqual([
      made.suggestionId,
    ]);
    const decide = (index: number, body: object, user = s.mgr) =>
      user.browser.post(
        `${s.base}/ai/contract-reviews/${made.suggestionId}/flags/${index}/decision`,
        body,
      );
    // "Not relevant" needs a reason; a flag that is not in the review is refused.
    expect((await decide(0, { decision: 'not_relevant' })).statusCode).toBe(422);
    expect((await decide(9, { decision: 'negotiate' })).statusCode).toBe(404);
    expect((await decide(0, { decision: 'negotiate' })).statusCode).toBe(200);
    const after = await decide(0, { decision: 'refer_to_lawyer', note: 'Ask Jo' });
    expect(after.statusCode).toBe(200);
    expect(after.json().decisions).toEqual([
      expect.objectContaining({ flagIndex: 0, decision: 'negotiate', note: null }),
      expect.objectContaining({ flagIndex: 0, decision: 'refer_to_lawyer', note: 'Ask Jo' }),
    ]);
    const got = (
      await s.mgr.browser.get(`${s.base}/ai/contract-reviews/${made.suggestionId}`)
    ).json();
    expect(got.decisions).toHaveLength(2);
    // A site manager has no commercial role: nothing to list, open or decide.
    expect((await s.site.browser.get(`${s.base}/ai/contract-reviews`)).statusCode).toBe(403);
    expect(
      (await s.site.browser.get(`${s.base}/ai/contract-reviews/${made.suggestionId}`)).statusCode,
    ).toBe(403);
    expect((await decide(0, { decision: 'accept_risk' }, s.site)).statusCode).toBe(403);
  });

  it('refuses callers without the commercial role before any model call', async () => {
    const s = await setup();
    const calls = t.ai.calls.length;
    const denied = await s.site.browser.post(`${s.base}/ai/contract-reviews`, {
      fileId: s.file,
      ...REQUEST,
    });
    expect(denied.statusCode).toBe(403);
    // A contract uploaded to another project is not read from this one.
    const other = await s.mgr.browser.post(`${s.base}/ai/contract-reviews`, {
      fileId: s.elsewhere,
      ...REQUEST,
    });
    expect(other.statusCode).toBeGreaterThanOrEqual(400);
    expect(t.ai.calls.length).toBe(calls);
  });

  it('answers a question from the contract with its clause, and says so when it is silent', async () => {
    const s = await setup();
    const made = (
      await s.mgr.browser.post(`${s.base}/ai/contract-reviews`, { fileId: s.file, ...REQUEST })
    ).json();
    const ask = (question: string, user = s.mgr, id = made.suggestionId) =>
      user.browser.post(`${s.base}/ai/contract-reviews/${id}/questions`, { question });
    const before = t.ai.calls.length;
    const a = await ask('How much retention does the Principal hold?');
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({
      kind: 'answered',
      question: 'How much retention does the Principal hold?',
      runId: expect.stringMatching(/^air_/),
      citations: [{ page: 1, clause: '14.1', quote: expect.stringContaining('retention of 10%') }],
      unreadPages: [],
      truncated: false,
    });
    const call = t.ai.calls.slice(before).find((c) => c.task === 'contract.ask')!;
    expect(call.text).toContain('<question>How much retention');
    expect(call.text).toContain('14.1 The Principal holds retention');
    expect(call.text).not.toContain(s.file);

    // The contract is silent: the fixed wording, no citations, nothing from general knowledge.
    const silent = (await ask('What is the defects liability period?')).json();
    expect(silent).toMatchObject({
      kind: 'not_addressed',
      answer: "The contract doesn't address this.",
      citations: [],
    });
    // A question that asks for a legal view is not answered.
    expect((await ask('Is the liquidated damages clause enforceable?')).json().kind).toBe(
      'not_addressed',
    );
    // The question is bounded.
    expect((await ask('?')).statusCode).toBe(422);
    expect((await ask('x'.repeat(501))).statusCode).toBe(422);
  });

  it('keeps Ask to the commercial team and to this project, before any model call', async () => {
    const s = await setup();
    const made = (
      await s.mgr.browser.post(`${s.base}/ai/contract-reviews`, { fileId: s.file, ...REQUEST })
    ).json();
    const calls = t.ai.calls.length;
    const url = `${s.base}/ai/contract-reviews/${made.suggestionId}/questions`;
    expect((await s.site.browser.post(url, { question: 'Who is the Principal?' })).statusCode).toBe(
      403,
    );
    // A review that doesn't exist is not found.
    expect(
      (
        await s.mgr.browser.post(
          `${s.base}/ai/contract-reviews/ais_00000000000000000000000000/questions`,
          { question: 'Who is the Principal?' },
        )
      ).statusCode,
    ).toBe(404);
    expect(t.ai.calls.length).toBe(calls);
  });

  it('refuses a PDF with no text', async () => {
    const s = await setup();
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const blank = await uploadBytes(
      t,
      s.owner.browser,
      s.org.id,
      s.project.id,
      await doc.save(),
      'blank.pdf',
    );
    const res = await s.mgr.browser.post(`${s.base}/ai/contract-reviews`, {
      fileId: blank,
      ...REQUEST,
    });
    expect(res.statusCode).toBe(422);
  });

  it('compares two reviewed contracts and keeps Compare to the commercial team, this project and two different reviews', async () => {
    const s = await setup();
    const revised = await uploadBytes(
      t,
      s.owner.browser,
      s.org.id,
      s.project.id,
      await contractPdf([
        [
          CONTRACT[0]![0]!,
          CONTRACT[0]![1]!,
          '14.1 The Principal holds retention of 5% of each payment.',
          '25.2 The Contractor pays a security of 2% of the contract sum.',
        ],
        CONTRACT[1]!,
      ]),
      'revised.pdf',
    );
    const review = async (fileId: string) =>
      (await s.mgr.browser.post(`${s.base}/ai/contract-reviews`, { fileId, ...REQUEST })).json();
    const a = await review(s.file);
    const b = await review(revised);
    const url = `${s.base}/ai/contract-compares`;
    const before = t.ai.calls.length;
    const res = await s.mgr.browser.post(url, {
      baseReviewId: a.suggestionId,
      otherReviewId: b.suggestionId,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      runId: expect.stringMatching(/^air_/),
      base: { suggestionId: a.suggestionId, fileName: 'subcontract.pdf', unreadPages: [] },
      other: { suggestionId: b.suggestionId, fileName: 'revised.pdf', truncated: false },
    });
    const kinds = Object.fromEntries(
      body.changes.map(
        (c: { kind: string; base?: { clause: string }; other?: { clause: string } }) => [
          (c.base ?? c.other)!.clause,
          c.kind,
        ],
      ),
    );
    expect(kinds).toMatchObject({ '14.1': 'changed', '25.2': 'added' });
    const call = t.ai.calls.slice(before).find((c) => c.task === 'contract.compare')!;
    expect(call.text).toContain('<base>');
    expect(call.text).toContain('<other>');
    expect(call.text).not.toContain(s.file);

    // Not allowed for site staff, not for a review of another contract that doesn't exist, not against itself:
    // none of them reaches the model.
    const calls = t.ai.calls.length;
    const one = { baseReviewId: a.suggestionId, otherReviewId: b.suggestionId };
    expect((await s.site.browser.post(url, one)).statusCode).toBe(403);
    expect(
      (
        await s.mgr.browser.post(url, {
          baseReviewId: a.suggestionId,
          otherReviewId: 'ais_00000000000000000000000000',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await s.mgr.browser.post(url, {
          baseReviewId: a.suggestionId,
          otherReviewId: a.suggestionId,
        })
      ).statusCode,
    ).toBe(422);
    expect(t.ai.calls.length).toBe(calls);
  });

  it('proposes schedule of values lines with their page quotes and saves nothing', async () => {
    const s = await setup();
    const schedule = await uploadBytes(
      t,
      s.owner.browser,
      s.org.id,
      s.project.id,
      await contractPdf([
        [
          'Pricing Schedule (amounts exclude GST)',
          '1.01 Preliminaries $40,000.00',
          'Painting $30,000.00',
          'Subtotal $70,000.00',
        ],
      ]),
      'schedule.pdf',
    );
    const url = `${s.base}/ai/contract-sov-drafts`;
    const before = t.ai.calls.length;
    const res = await s.owner.browser.post(url, { fileId: schedule, contractValue: '80000.00' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      runId: expect.stringMatching(/^air_/),
      lines: [
        { code: '1.01', description: 'Preliminaries', amount: '40000.00', source: { page: 1 } },
        { code: '', description: 'Painting', amount: '30000.00', source: { page: 1 } },
      ],
      linesTotalExGst: '70000.00',
      contractValueExGst: '80000.00',
      totalCheck: 'differs',
      difference: '-10000.00',
      warnings: expect.arrayContaining(['total_differs']),
    });
    const call = t.ai.calls.slice(before).find((c) => c.task === 'contract.sov')!;
    expect(call.text).toContain('<contract_value>80000.00</contract_value>');
    expect(call.text).toContain('1.01 Preliminaries $40,000.00');
    expect(call.text).not.toContain(schedule);
    // A proposal only: no contract exists afterwards.
    const contracts = (await s.owner.browser.get(`${s.base}/contracts`)).json();
    expect(contracts.data).toEqual([]);

    // Not for site staff, not for a file of another project, not for a value that is not an amount:
    // none of them reaches the model.
    const calls = t.ai.calls.length;
    expect((await s.site.browser.post(url, { fileId: schedule })).statusCode).toBe(403);
    expect(
      (await s.owner.browser.post(url, { fileId: s.elsewhere })).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await s.owner.browser.post(url, { fileId: schedule, contractValue: 'lots' })).statusCode,
    ).toBe(422);
    expect(t.ai.calls.length).toBe(calls);
  });
});
