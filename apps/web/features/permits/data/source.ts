// Permits data source, mirroring `{p}/permits`, `.../permits/{id}`, `.../transition`, `.../flags` and
// `.../requirements` (permits module). Preview: an in-memory register with the server's rules.

import { delay, mockId, problem, projectStores } from '@/shared/mocks/runtime';
import { todayIn } from '@/shared/lib/format';
import type {
  Permit,
  PermitAction,
  PermitFilters,
  PermitFlag,
  PermitInput,
  PermitStatus,
  Requirement,
} from '../lib/types';
import { KIND_LABELS } from '../lib/types';

export interface PermitSource {
  list(projectId: string, filters: PermitFilters): Promise<Permit[]>;
  create(projectId: string, input: PermitInput): Promise<Permit>;
  update(projectId: string, permit: Permit, input: Partial<PermitInput>): Promise<Permit>;
  transition(
    projectId: string,
    permit: Permit,
    t: { action: PermitAction; newExpiresOn?: string },
  ): Promise<Permit>;
  flags(projectId: string): Promise<PermitFlag[]>;
  requirements(projectId: string): Promise<Requirement[]>;
  setRequirements(projectId: string, items: Requirement[]): Promise<Requirement[]>;
}

interface Row extends Permit {
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
const label = (n: number) => `PMT-${String(n).padStart(4, '0')}`;

function derive(r: Row, lead = 30): Row {
  const left = r.expiresOn ? dayNo(r.expiresOn) - dayNo(todayIn(TZ)) : null;
  const status: PermitStatus =
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
    id: `pmt_000${n}`,
    numberLabel: label(n),
    kind: 'other',
    title: '',
    issuingAuthority: null,
    referenceNumber: null,
    holderCompanyId: null,
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
  next: 4,
  requirements: [{ kind: 'occupation_certificate', leadDays: 30 }],
  items: [
    make(1, {
      kind: 'building_permit',
      title: 'Stage 1 building permit',
      issuingAuthority: 'City Council',
      referenceNumber: 'BP-2026-0042',
      issuedOn: plus(-200),
      expiresOn: plus(12),
    }),
    make(2, {
      kind: 'road_occupancy',
      title: 'Footpath and lane closure, Harbour St',
      issuingAuthority: 'Transport Authority',
      expiresOn: plus(-4),
    }),
    make(3, {
      kind: 'development_approval',
      title: 'DA 2025/118',
      issuingAuthority: 'City Council',
      issuedOn: plus(-400),
      expiresOn: plus(700),
    }),
  ],
}));

const find = (projectId: string, id: string) => {
  const hit = stores.get(projectId).items.find((x) => x.id === id);
  if (!hit) problem(404, 'permit.not_found', 'Permit not found.');
  return hit;
};
const pub = (r: Row): Permit => {
  const { lifecycle: _l, ...p } = r;
  void _l;
  return p;
};
const lead = (s: Store, kind: string) =>
  s.requirements.find((r) => r.kind === kind)?.leadDays ?? 30;

export const permitsPreview: PermitSource = {
  list: (projectId, f) => {
    const s = stores.get(projectId);
    return delay(
      s.items
        .map((r) => derive(r, lead(s, r.kind)))
        .filter((r) => (!f.kind || r.kind === f.kind) && (!f.status || r.status === f.status))
        .map(pub),
    );
  },
  create: (projectId, input) => {
    const s = stores.get(projectId);
    if (input.issuedOn && input.expiresOn && input.issuedOn > input.expiresOn)
      problem(422, 'validation_failed', 'The expiry date is before the issue date.');
    const row = make(s.next++, { ...input, id: mockId('pmt') });
    s.items.unshift(row);
    return delay(pub(derive(row)));
  },
  update: (projectId, permit, input) => {
    const hit = find(projectId, permit.id);
    const issued = input.issuedOn === undefined ? hit.issuedOn : input.issuedOn;
    const expires = input.expiresOn === undefined ? hit.expiresOn : input.expiresOn;
    if (issued && expires && issued > expires)
      problem(422, 'validation_failed', 'The expiry date is before the issue date.');
    Object.assign(hit, input, { version: hit.version + 1 });
    return delay(pub(derive(hit)));
  },
  transition: (projectId, permit, t) => {
    const hit = find(projectId, permit.id);
    const from = hit.lifecycle;
    if (t.action === 'startRenewal' && from === 'active') hit.lifecycle = 'renewal_in_progress';
    else if (t.action === 'markRenewed' && from !== 'closed') {
      if (!t.newExpiresOn) problem(409, 'permit.invalid_transition', 'Give the new expiry date.');
      if (hit.expiresOn && t.newExpiresOn! <= hit.expiresOn)
        problem(
          409,
          'permit.invalid_transition',
          'The new expiry date must be after the current one.',
        );
      hit.lifecycle = 'active';
      hit.expiresOn = t.newExpiresOn!;
    } else if (t.action === 'close' && from !== 'closed') hit.lifecycle = 'closed';
    else if (t.action === 'reopen' && from === 'closed') hit.lifecycle = 'active';
    else problem(409, 'permit.invalid_transition', 'That isn’t available for this permit.');
    hit.version += 1;
    return delay(pub(derive(hit)));
  },
  flags: (projectId) => {
    const s = stores.get(projectId);
    const out: PermitFlag[] = [];
    for (const r of s.items.map((x) => derive(x, lead(s, x.kind)))) {
      if (r.lifecycle === 'closed' || r.daysToExpiry === null) continue;
      const name = `${r.numberLabel} ${r.title}`;
      if (r.daysToExpiry < 0)
        out.push({
          kind: r.lifecycle === 'renewal_in_progress' ? 'expired_while_renewing' : 'expired',
          severity: 'high',
          title: `${name} expired ${-r.daysToExpiry} day${r.daysToExpiry === -1 ? '' : 's'} ago`,
          detail:
            r.lifecycle === 'renewal_in_progress'
              ? 'Renewal is in progress but the permit has passed its expiry date. Confirm the work it covers may continue.'
              : 'Work that depends on this permit may need to stop until it is renewed.',
          permitId: r.id,
          permitKind: r.kind,
        });
      else if (r.lifecycle === 'active' && r.status === 'expiring_soon')
        out.push({
          kind: 'expiring',
          severity: r.daysToExpiry <= 7 ? 'high' : 'warn',
          title: `${name} expires in ${r.daysToExpiry} day${r.daysToExpiry === 1 ? '' : 's'}`,
          detail: 'Start the renewal so the permit does not lapse.',
          permitId: r.id,
          permitKind: r.kind,
        });
    }
    const held = new Set(s.items.filter((r) => r.lifecycle !== 'closed').map((r) => r.kind));
    for (const q of s.requirements)
      if (!held.has(q.kind))
        out.push({
          kind: 'missing_required',
          severity: 'warn',
          title: `No ${KIND_LABELS[q.kind].toLowerCase()} on the register`,
          detail:
            'This project is set to expect one. Add it, or remove the requirement if it does not apply.',
          permitId: null,
          permitKind: q.kind,
        });
    return delay(
      out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1)),
    );
  },
  requirements: (projectId) => delay(stores.get(projectId).requirements),
  setRequirements: (projectId, items) => {
    stores.get(projectId).requirements = items;
    return delay(items);
  },
};

export function resetPermitsPreview() {
  stores.reset();
}
