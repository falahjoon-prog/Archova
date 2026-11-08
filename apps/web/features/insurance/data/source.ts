// Insurance and bonds data source, mirroring `{p}/insurance/covers`, `.../transition`, `.../flags` and
// `.../requirements` (insurance module). Preview: an in-memory register with the server's rules.

import { delay, mockId, problem, projectStores } from '@/shared/mocks/runtime';
import { todayIn } from '@/shared/lib/format';
import type {
  Cover,
  CoverAction,
  CoverFilters,
  CoverFlag,
  CoverInput,
  CoverKind,
  CoverStatus,
  FlagKind,
  Requirement,
} from '../lib/types';
import { KIND_LABELS, formatMoney } from '../lib/types';

export interface CoverSource {
  list(projectId: string, filters: CoverFilters): Promise<Cover[]>;
  create(projectId: string, input: CoverInput): Promise<Cover>;
  update(projectId: string, cover: Cover, input: Partial<CoverInput>): Promise<Cover>;
  transition(
    projectId: string,
    cover: Cover,
    t: { action: CoverAction; newExpiresOn?: string },
  ): Promise<Cover>;
  flags(projectId: string): Promise<CoverFlag[]>;
  requirements(projectId: string): Promise<Requirement[]>;
  setRequirements(projectId: string, items: Requirement[]): Promise<Requirement[]>;
}

interface Row extends Cover {
  lifecycle: 'active' | 'renewal_in_progress' | 'closed';
}
interface Store {
  items: Row[];
  requirements: Requirement[];
  next: number;
}

const DAY = 86_400_000;
const TZ = 'Australia/Sydney';
const dayNo = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
const plus = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const label = (n: number) => `INS-${String(n).padStart(4, '0')}`;

function derive(r: Row, lead = 30): Row {
  const left = r.expiresOn ? dayNo(r.expiresOn) - dayNo(todayIn(TZ)) : null;
  const status: CoverStatus =
    r.lifecycle === 'closed'
      ? 'closed'
      : r.lifecycle === 'renewal_in_progress'
        ? 'renewal_in_progress'
        : left === null
          ? 'active'
          : left < 0
            ? 'expired'
            : left <= lead
              ? 'expiring_soon'
              : 'active';
  return { ...r, daysToExpiry: left, status };
}

function make(n: number, over: Partial<Row>): Row {
  return derive({
    id: `cvr_000${n}`,
    numberLabel: label(n),
    companyId: 'cmp_elec',
    kind: 'public_liability',
    title: '',
    issuer: null,
    referenceNumber: null,
    amountCents: null,
    issuedOn: null,
    expiresOn: null,
    status: 'active',
    daysToExpiry: null,
    notes: null,
    version: 1,
    lifecycle: 'active',
    ...over,
  });
}

const stores = projectStores<Store>(() => ({
  next: 5,
  requirements: [
    { kind: 'public_liability', leadDays: 30, minAmountCents: 2_000_000_000 },
    { kind: 'workers_comp', leadDays: 30, minAmountCents: null },
  ],
  items: [
    make(1, {
      companyId: 'cmp_elec',
      kind: 'public_liability',
      title: 'Brightwire public liability',
      issuer: 'QBE Insurance',
      referenceNumber: 'PL-99812',
      amountCents: 2_000_000_000,
      issuedOn: plus(-340),
      expiresOn: plus(12),
    }),
    make(2, {
      companyId: 'cmp_elec',
      kind: 'workers_comp',
      title: 'Brightwire workers compensation',
      issuer: 'icare',
      expiresOn: plus(210),
    }),
    make(3, {
      companyId: 'cmp_plumb',
      kind: 'public_liability',
      title: 'Bayside Hydraulics public liability',
      issuer: 'Allianz',
      amountCents: 1_000_000_000,
      expiresOn: plus(-4),
    }),
    make(4, {
      companyId: 'cmp_plumb',
      kind: 'performance_bond',
      title: 'Performance bond, 5% of subcontract',
      issuer: 'Westpac',
      amountCents: 4_500_000,
    }),
  ],
}));

const find = (projectId: string, id: string) => {
  const hit = stores.get(projectId).items.find((x) => x.id === id);
  if (!hit) problem(404, 'cover.not_found', 'Cover not found.');
  return hit;
};
const pub = (r: Row): Cover => {
  const { lifecycle: _l, ...p } = r;
  void _l;
  return p;
};
const lead = (s: Store, kind: string) =>
  s.requirements.find((r) => r.kind === kind)?.leadDays ?? 30;

export const insurancePreview: CoverSource = {
  list: (projectId, f) => {
    const s = stores.get(projectId);
    return delay(
      s.items
        .map((r) => derive(r, lead(s, r.kind)))
        .filter(
          (r) =>
            (!f.kind || r.kind === f.kind) &&
            (!f.companyId || r.companyId === f.companyId) &&
            (!f.status || r.status === f.status),
        )
        .map(pub),
    );
  },
  create: (projectId, input) => {
    const s = stores.get(projectId);
    if (input.issuedOn && input.expiresOn && input.issuedOn > input.expiresOn)
      problem(422, 'validation_failed', 'The expiry date is before the issue date.');
    const row = make(s.next++, { ...input, id: mockId('cvr') });
    s.items.unshift(row);
    return delay(pub(derive(row)));
  },
  update: (projectId, cover, input) => {
    const hit = find(projectId, cover.id);
    const issued = input.issuedOn === undefined ? hit.issuedOn : input.issuedOn;
    const expires = input.expiresOn === undefined ? hit.expiresOn : input.expiresOn;
    if (issued && expires && issued > expires)
      problem(422, 'validation_failed', 'The expiry date is before the issue date.');
    Object.assign(hit, input, { version: hit.version + 1 });
    return delay(pub(derive(hit)));
  },
  transition: (projectId, cover, t) => {
    const hit = find(projectId, cover.id);
    const from = hit.lifecycle;
    if (t.action === 'startRenewal' && from === 'active') hit.lifecycle = 'renewal_in_progress';
    else if (t.action === 'markRenewed' && from !== 'closed') {
      if (!t.newExpiresOn) problem(409, 'cover.invalid_transition', 'Give the new expiry date.');
      if (hit.expiresOn && t.newExpiresOn! <= hit.expiresOn)
        problem(
          409,
          'cover.invalid_transition',
          'The new expiry date must be after the current one.',
        );
      hit.lifecycle = 'active';
      hit.expiresOn = t.newExpiresOn!;
    } else if (t.action === 'close' && from !== 'closed') hit.lifecycle = 'closed';
    else if (t.action === 'reopen' && from === 'closed') hit.lifecycle = 'active';
    else problem(409, 'cover.invalid_transition', 'That isn’t available for this cover.');
    hit.version += 1;
    return delay(pub(derive(hit)));
  },
  flags: (projectId) => {
    const s = stores.get(projectId);
    const rows = s.items
      .map((x) => derive(x, lead(s, x.kind)))
      .filter((r) => r.lifecycle !== 'closed');
    const out: CoverFlag[] = [];
    const add = (
      kind: FlagKind,
      severity: CoverFlag['severity'],
      r: { companyId: string; id: string | null; kind: CoverKind | null },
      title: string,
      detail: string,
    ) =>
      out.push({
        kind,
        severity,
        companyId: r.companyId,
        title,
        detail,
        coverId: r.id,
        coverKind: r.kind,
      });
    const who = (id: string) =>
      id === 'cmp_plumb' ? 'Bayside Hydraulics' : 'Brightwire Electrical';
    for (const r of rows) {
      if (r.daysToExpiry === null) continue;
      const live = rows.some(
        (o) =>
          o.id !== r.id &&
          o.companyId === r.companyId &&
          o.kind === r.kind &&
          (o.daysToExpiry ?? 0) >= 0,
      );
      if (r.daysToExpiry < 0 && !live)
        add(
          r.lifecycle === 'renewal_in_progress' ? 'expired_while_renewing' : 'expired',
          'high',
          r,
          `${who(r.companyId)}: ${r.numberLabel} ${KIND_LABELS[r.kind].toLowerCase()} expired ${-r.daysToExpiry} day${r.daysToExpiry === -1 ? '' : 's'} ago.`,
          'Cover has lapsed. The company is blocked at the site gate until a current one is recorded.',
        );
      else if (r.daysToExpiry >= 0 && r.lifecycle === 'active' && r.status === 'expiring_soon')
        add(
          'expiring',
          r.daysToExpiry <= 7 ? 'high' : 'warn',
          r,
          `${who(r.companyId)}: ${r.numberLabel} ${KIND_LABELS[r.kind].toLowerCase()} expires in ${r.daysToExpiry} day${r.daysToExpiry === 1 ? '' : 's'}.`,
          'Ask the company for the renewed certificate or bond before it lapses.',
        );
    }
    for (const companyId of new Set(rows.map((r) => r.companyId)))
      for (const q of s.requirements) {
        const mine = rows.filter((r) => r.companyId === companyId && r.kind === q.kind);
        if (mine.length === 0)
          add(
            'missing',
            'high',
            { companyId, id: null, kind: q.kind },
            `${who(companyId)}: No ${KIND_LABELS[q.kind].toLowerCase()} on the register.`,
            'This project expects it. Add it, or remove the requirement if it does not apply.',
          );
        else if (q.minAmountCents !== null) {
          const known = mine.flatMap((r) => (r.amountCents === null ? [] : [r.amountCents]));
          if (known.length > 0 && Math.max(...known) < q.minAmountCents)
            add(
              'below_minimum',
              'warn',
              { companyId, id: null, kind: q.kind },
              `${who(companyId)}: ${KIND_LABELS[q.kind]} is ${formatMoney(Math.max(...known))}; this project asks for at least ${formatMoney(q.minAmountCents)}.`,
              'Check the amount against the subcontract, or ask for a higher limit.',
            );
        }
      }
    const rank = { high: 0, warn: 1, info: 2 } as const;
    return delay(out.sort((a, b) => rank[a.severity] - rank[b.severity]));
  },
  requirements: (projectId) => delay(stores.get(projectId).requirements),
  setRequirements: (projectId, items) => {
    stores.get(projectId).requirements = items;
    return delay(items);
  },
};

export function resetInsurancePreview() {
  stores.reset();
}
