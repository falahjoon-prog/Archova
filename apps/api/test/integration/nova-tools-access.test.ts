// Nova's toolbox against the real modules (ai/07 §3): every registered tool, run as people who may not see what it
// reads, returns only the "no access" line. The list comes from the app itself, so a tool added later has to get a case
// in `DENIED` before CI passes. `test/unit/nova-tools.test.ts` covers the tools' shape and their handling of a denial.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildNovaTools } from '@archova/compose';
import { decodeId } from '@archova/domain';
import { TRIAL_ENTITLEMENTS } from '@archova/mod-billing';
import type { TenantContext } from '@archova/kernel';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  removeMember,
  signUp,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

/** The list the app builds in `@archova/compose`, from the same module APIs. */
const tools = () =>
  buildNovaTools({
    rfis: t.modules.rfis.api,
    defects: t.modules.defects.api,
    financials: t.modules.financials.api,
    scheduling: () => t.modules.scheduling.api,
  });

const SUBJECT = 'Confidential riser wall rating';

async function setup() {
  const pm = await signUp(t.app, 'nta-pm');
  const eng = await signUp(t.app, 'nta-eng');
  const client = await signUp(t.app, 'nta-client');
  const sub = await signUp(t.app, 'nta-sub');
  const gone = await signUp(t.app, 'nta-gone');
  const org = await createOrg(pm.browser, 'Toolbox Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Tower T', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Fire Eng Co');
  await addMember(pm.browser, org.id, project.id, client.email, 'Client', 'Toolbox Developments');
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Plumbco');
  // Once on the project and then taken off it: still in the org, with no access to the project.
  await addMember(pm.browser, org.id, project.id, gone.email, 'Site Manager', 'Toolbox Builders');
  await removeMember(pm.browser, org.id, project.id, gone.email);

  // An open RFI sent to the engineer: the PM and the engineer may read it, the others may not.
  const draft = await pm.browser.post(`${base}/rfis`, {
    subject: SUBJECT,
    question: 'Which FRL applies to the riser wall?',
    assigneeIds: [eng.userId],
  });
  expect(draft.statusCode, draft.body).toBe(201);
  const rfiId = draft.json().rfi.id as string;
  const opened = await pm.browser.post(`${base}/rfis/${rfiId}/open`, undefined, {
    'if-match': draft.headers.etag as string,
  });
  expect(opened.statusCode, opened.body).toBe(200);

  return {
    org,
    projectId: decodeId('project', project.id)!,
    rfiId,
    users: { pm, eng, client, sub, gone },
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;
type Who = 'client' | 'sub' | 'gone';

const ctxOf = (s: Setup, who: keyof Setup['users']): TenantContext => ({
  orgId: decodeId('org', s.org.id)!,
  userId: decodeId('user', s.users[who].userId)!,
  principalType: 'member',
  orgRole: null,
  entitlements: TRIAL_ENTITLEMENTS,
  requestId: 'test',
});

const NO_ACCESS = /don't have access to/;
const NOT_FOUND = /was not found, or you cannot see it/;

/**
 * Who may not see what each tool reads, and what the tool then says. Every tool needs a case for someone taken off the
 * project; the others are people whose template excludes that module (the Client has no RFI or budget access, a
 * Subcontractor has no budget access and sees only the RFIs sent to them).
 */
const DENIED: Record<
  string,
  Array<{ who: Who; args?: (s: Setup) => Record<string, string>; says: RegExp }>
> = {
  overdue_rfis: [
    { who: 'gone', says: NO_ACCESS },
    { who: 'client', says: NO_ACCESS },
  ],
  rfi_details: [
    { who: 'gone', args: (s) => ({ id: s.rfiId }), says: NOT_FOUND },
    { who: 'client', args: (s) => ({ id: s.rfiId }), says: NOT_FOUND },
    { who: 'sub', args: (s) => ({ id: s.rfiId }), says: NOT_FOUND },
  ],
  open_defects: [{ who: 'gone', says: NO_ACCESS }],
  late_programme_tasks: [{ who: 'gone', says: NO_ACCESS }],
  budget_findings: [
    { who: 'gone', says: NO_ACCESS },
    { who: 'client', says: NO_ACCESS },
    { who: 'sub', says: NO_ACCESS },
  ],
};

describe('Nova tools honour the caller’s access', () => {
  it('has a denial case for every registered tool, and one for someone with no access to the project', () => {
    expect(
      tools()
        .map((x) => x.name)
        .sort(),
    ).toEqual(Object.keys(DENIED).sort());
    for (const [name, cases] of Object.entries(DENIED))
      expect(
        cases.some((c) => c.who === 'gone'),
        name,
      ).toBe(true);
  });

  it('gives each caller who may not see what a tool reads only the "no access" line', async () => {
    const s = await setup();
    for (const tool of tools()) {
      for (const c of DENIED[tool.name] ?? []) {
        const findings = await t.database.withTenantTx(
          ctxOf(s, c.who),
          (scope) => tool.run(scope, s.projectId, c.args?.(s) ?? {}),
          { readOnly: true },
        );
        const label = `${tool.name} as ${c.who}`;
        expect(findings, label).toHaveLength(1);
        expect(findings[0]!.text, label).toMatch(c.says);
        // Nothing of the RFI reaches someone who may not see it.
        expect(JSON.stringify(findings), label).not.toContain(SUBJECT);
      }
    }
  });

  it('shows the RFI to the engineer it was sent to, so the denials above are about access and not a missing record', async () => {
    const s = await setup();
    const tool = tools().find((x) => x.name === 'rfi_details')!;
    const findings = await t.database.withTenantTx(
      ctxOf(s, 'eng'),
      (scope) => tool.run(scope, s.projectId, { id: s.rfiId }),
      { readOnly: true },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.text).toContain(SUBJECT);
  });
});
