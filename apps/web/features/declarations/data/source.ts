// Subcontractor declarations data source, mirroring `{p}/declarations/*` (declarations module) and the Nova reading
// at `{p}/ai/declaration-readings`. Preview: an in-memory register with the server's rules.
import { delay, mockId, problem, projectStores } from '@/shared/mocks/runtime';
import { todayIn } from '@/shared/lib/format';
import type {
  ChaseResult,
  ClaimStatus,
  Declaration,
  DeclarationFilters,
  DeclarationInput,
  DeclarationKind,
  DeclarationStatus,
  Flag,
  Issue,
  Reading,
  Requirement,
} from '../lib/types';
import { DEFAULT_LEAD_DAYS, KIND_LABELS } from '../lib/types';

export interface DeclarationSource {
  list(projectId: string, filters: DeclarationFilters): Promise<Declaration[]>;
  create(projectId: string, input: DeclarationInput): Promise<Declaration>;
  update(projectId: string, d: Declaration, input: Partial<DeclarationInput>): Promise<Declaration>;
  transition(
    projectId: string,
    d: Declaration,
    t: { action: 'reject' | 'accept'; note?: string },
  ): Promise<Declaration>;
  flags(projectId: string): Promise<Flag[]>;
  claims(projectId: string): Promise<{ requirementsSet: boolean; data: ClaimStatus[] }>;
  requirements(projectId: string): Promise<Requirement[]>;
  setRequirements(projectId: string, items: Requirement[]): Promise<Requirement[]>;
  chase(
    projectId: string,
    input: { companyId: string; claimId?: string; send: boolean; subject?: string; body?: string },
  ): Promise<ChaseResult>;
  /** Uploads the PDF to the project and has Nova read it; nothing is recorded. */
  read(projectId: string, file: File): Promise<Reading>;
}

interface Store {
  items: Declaration[];
  requirements: Requirement[];
  next: number;
}

const DAY = 86_400_000;
const TZ = 'Australia/Sydney';
const dayNo = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
const plus = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const label = (n: number) => `DEC-${String(n).padStart(4, '0')}`;
const NAMES: Record<string, string> = {
  cmp_elec: 'Brightwire Electrical',
  cmp_plumb: 'Bayside Hydraulics',
  cmp_tile: 'Ironbark Tiling',
};

function derive(d: Declaration, lead: number): Declaration {
  const today = todayIn(TZ);
  const left = dayNo(d.validTo) - dayNo(today);
  const status: DeclarationStatus =
    d.lifecycle === 'rejected'
      ? 'rejected'
      : today < d.validFrom
        ? 'not_yet_valid'
        : left < 0
          ? 'expired'
          : left <= lead
            ? 'expiring_soon'
            : 'current';
  return { ...d, daysToEnd: left, status };
}

function make(n: number, over: Partial<Declaration>): Declaration {
  return derive(
    {
      id: `dcl_000${n}`,
      numberLabel: label(n),
      companyId: 'cmp_elec',
      kind: 'workers_comp',
      declarantName: null,
      declarantPosition: null,
      declaredOn: null,
      validFrom: plus(-200),
      validTo: plus(160),
      issuer: null,
      referenceNumber: null,
      claimId: null,
      lifecycle: 'accepted',
      status: 'current',
      daysToEnd: 0,
      notes: null,
      readByNova: false,
      version: 1,
      ...over,
    },
    30,
  );
}

const CLAIMS = [
  {
    claimId: 'pcl_0001',
    number: 3,
    contractTitle: 'Electrical',
    companyId: 'cmp_elec',
    periodEnd: plus(-4),
    coveredByStatement: false,
  },
  {
    claimId: 'pcl_0002',
    number: 2,
    contractTitle: 'Hydraulics',
    companyId: 'cmp_plumb',
    periodEnd: plus(-4),
    coveredByStatement: false,
  },
  {
    claimId: 'pcl_0003',
    number: 1,
    contractTitle: 'Wall and floor tiling',
    companyId: 'cmp_tile',
    periodEnd: plus(-4),
    coveredByStatement: true,
  },
];

const stores = projectStores<Store>(() => ({
  next: 5,
  requirements: [
    { kind: 'workers_comp', leadDays: 30 },
    { kind: 'payroll_tax', leadDays: 14 },
    { kind: 'wages', leadDays: 7 },
  ],
  items: [
    make(1, {
      companyId: 'cmp_elec',
      kind: 'workers_comp',
      issuer: 'icare',
      referenceNumber: 'WC-558812',
      validTo: plus(160),
    }),
    make(2, {
      companyId: 'cmp_elec',
      kind: 'payroll_tax',
      validFrom: plus(-34),
      validTo: plus(-4),
      declarantName: 'Sam Sparks',
      declarantPosition: 'Director',
      declaredOn: plus(-3),
    }),
    make(3, {
      companyId: 'cmp_elec',
      kind: 'wages',
      validFrom: plus(-34),
      validTo: plus(-4),
      declarantName: 'Sam Sparks',
      declarantPosition: 'Director',
      declaredOn: plus(-3),
    }),
    make(4, {
      companyId: 'cmp_plumb',
      kind: 'workers_comp',
      issuer: 'Allianz',
      validFrom: plus(-340),
      validTo: plus(14),
    }),
  ],
}));

const find = (projectId: string, id: string) => {
  const hit = stores.get(projectId).items.find((x) => x.id === id);
  if (!hit) problem(404, 'declaration.not_found', 'Declaration not found.');
  return hit;
};
const lead = (s: Store, kind: DeclarationKind) =>
  s.requirements.find((r) => r.kind === kind)?.leadDays ?? DEFAULT_LEAD_DAYS[kind];

function claimIssues(s: Store, companyId: string, claimId: string, periodEnd: string): Issue[] {
  const out: Issue[] = [];
  for (const r of s.requirements) {
    const mine = s.items.filter(
      (d) =>
        d.companyId === companyId &&
        d.kind === r.kind &&
        (d.claimId === null || d.claimId === claimId),
    );
    const ok = mine.some(
      (d) =>
        d.lifecycle === 'accepted' &&
        (d.claimId === claimId || (d.validFrom <= periodEnd && periodEnd <= d.validTo)),
    );
    if (ok) continue;
    const name = KIND_LABELS[r.kind];
    const accepted = mine.filter((d) => d.lifecycle === 'accepted');
    out.push(
      accepted.length
        ? {
            kind: 'expired',
            level: 'blocking',
            declarationKind: r.kind,
            message: `${accepted[0]!.numberLabel} ${name.toLowerCase()} does not cover this claim's period.`,
          }
        : mine.length
          ? {
              kind: 'rejected',
              level: 'blocking',
              declarationKind: r.kind,
              message: `${mine[0]!.numberLabel} was rejected; ask for a corrected ${name.toLowerCase()}.`,
            }
          : {
              kind: 'missing',
              level: 'blocking',
              declarationKind: r.kind,
              message: `No ${name.toLowerCase()} declaration received.`,
            },
    );
  }
  return out;
}

export const declarationsPreview: DeclarationSource = {
  list: (projectId, f) => {
    const s = stores.get(projectId);
    return delay(
      s.items
        .map((d) => derive(d, lead(s, d.kind)))
        .filter(
          (d) =>
            (!f.kind || d.kind === f.kind) &&
            (!f.companyId || d.companyId === f.companyId) &&
            (!f.status || d.status === f.status),
        ),
    );
  },
  create: (projectId, input) => {
    const s = stores.get(projectId);
    if (input.validFrom > input.validTo)
      problem(422, 'validation_failed', 'The end date is before the start date.');
    const row = make(s.next++, { ...input, id: mockId('dcl') } as Partial<Declaration>);
    s.items.unshift(row);
    return delay(derive(row, lead(s, row.kind)));
  },
  update: (projectId, d, input) => {
    const s = stores.get(projectId);
    const hit = find(projectId, d.id);
    const from = input.validFrom ?? hit.validFrom;
    const to = input.validTo ?? hit.validTo;
    if (from > to) problem(422, 'validation_failed', 'The end date is before the start date.');
    Object.assign(hit, input, { version: hit.version + 1 });
    return delay(derive(hit, lead(s, hit.kind)));
  },
  transition: (projectId, d, t) => {
    const s = stores.get(projectId);
    const hit = find(projectId, d.id);
    if (t.action === 'reject' && hit.lifecycle === 'accepted') {
      if (!t.note?.trim())
        problem(422, 'validation_failed', 'Say why the declaration is rejected.');
      hit.lifecycle = 'rejected';
    } else if (t.action === 'accept' && hit.lifecycle === 'rejected') hit.lifecycle = 'accepted';
    else
      problem(409, 'declaration.invalid_transition', 'That isn’t available for this declaration.');
    hit.version += 1;
    return delay(derive(hit, lead(s, hit.kind)));
  },
  flags: (projectId) => {
    const s = stores.get(projectId);
    const rows = s.items.map((d) => derive(d, lead(s, d.kind)));
    const out: Flag[] = [];
    for (const d of rows)
      if (d.status === 'expiring_soon')
        out.push({
          kind: 'expiring',
          severity: d.daysToEnd <= 7 ? 'high' : 'warn',
          companyId: d.companyId,
          title: `${NAMES[d.companyId]}: ${d.numberLabel} ${KIND_LABELS[d.kind].toLowerCase()} runs out in ${d.daysToEnd} day${d.daysToEnd === 1 ? '' : 's'}.`,
          detail: 'Ask the subcontractor for the next declaration before it runs out.',
          declarationId: d.id,
          declarationKind: d.kind,
        });
    for (const companyId of new Set(rows.map((r) => r.companyId)))
      for (const q of s.requirements)
        if (
          !rows.some(
            (r) =>
              r.companyId === companyId &&
              r.kind === q.kind &&
              r.status !== 'expired' &&
              r.status !== 'rejected',
          )
        )
          out.push({
            kind: 'missing',
            severity: 'high',
            companyId,
            title: `${NAMES[companyId]}: No ${KIND_LABELS[q.kind].toLowerCase()} declaration on the register.`,
            detail:
              'This project asks for it with every claim. Ask the subcontractor for it before their next claim is paid.',
            declarationId: null,
            declarationKind: q.kind,
          });
    const rank = { high: 0, warn: 1, info: 2 } as const;
    return delay(out.sort((a, b) => rank[a.severity] - rank[b.severity]));
  },
  claims: (projectId) => {
    const s = stores.get(projectId);
    return delay({
      requirementsSet: s.requirements.length > 0,
      data: CLAIMS.map((c) => {
        const issues =
          c.coveredByStatement || s.requirements.length === 0
            ? []
            : claimIssues(s, c.companyId, c.claimId, c.periodEnd);
        return {
          ...c,
          companyName: NAMES[c.companyId] ?? 'A company',
          state: issues.length ? ('blocked' as const) : ('cleared' as const),
          issues,
        };
      }),
    });
  },
  requirements: (projectId) => delay(stores.get(projectId).requirements),
  setRequirements: (projectId, items) => {
    stores.get(projectId).requirements = items;
    return delay(items);
  },
  chase: (projectId, input) => {
    const s = stores.get(projectId);
    const claim = CLAIMS.find((c) => c.claimId === input.claimId);
    const issues = claim ? claimIssues(s, input.companyId, claim.claimId, claim.periodEnd) : [];
    if (issues.length === 0)
      return delay({ draft: null, recipient: 'accounts@example.com', sent: false });
    const kinds = [...new Set(issues.map((i) => i.declarationKind))];
    const draft = {
      subject:
        `Harbour Street: declarations needed for payment claim ${claim?.number ?? ''}`.trim(),
      kinds,
      body: [
        `Hi ${NAMES[input.companyId] ?? 'there'},`,
        '',
        `To complete our records for payment claim ${claim?.number ?? ''} on Harbour Street, we still need:`,
        '',
        ...kinds.map((k) => `- ${KIND_LABELS[k]}: not yet received`),
        '',
        'Please reply to this email with the signed declarations attached (PDF).',
        '',
        'Thank you,',
        'The project team',
      ].join('\n'),
    };
    if (!input.send) return delay({ draft, recipient: 'accounts@example.com', sent: false });
    return delay({
      draft: { ...draft, subject: input.subject || draft.subject, body: input.body || draft.body },
      recipient: 'accounts@example.com',
      sent: true,
    });
  },
  read: (_projectId, file) =>
    delay({
      fileId: mockId('fil'),
      kind: /payroll/i.test(file.name)
        ? 'payroll_tax'
        : /wage/i.test(file.name)
          ? 'wages'
          : 'workers_comp',
      companyName: 'Bayside Hydraulics',
      declarantName: 'Lee Tran',
      declarantPosition: 'Director',
      declaredOn: plus(-2),
      validFrom: plus(-30),
      validTo: plus(335),
      issuer: 'Allianz',
      referenceNumber: 'WC-771204',
      signed: true,
      sources: {
        validTo: 'p.1: Policy period …',
        referenceNumber: 'p.1: Policy number: WC-771204',
      },
      warnings: [],
    } satisfies Reading),
};

export function resetDeclarationsPreview() {
  stores.reset();
}
