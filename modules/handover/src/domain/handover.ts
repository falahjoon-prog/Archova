// Project handover and close-out pack: the rules, with no I/O. One checklist per project of what the client is owed at
// completion (as-builts, O&M manuals, warranties, certificates, defect sign-off, keys). The register only records what
// has been supplied and approved; it never says a building is compliant.
import type { LocalDate } from '@archova/time';

export const HANDOVER_CATEGORIES = [
  'as_built',
  'om_manual',
  'warranty',
  'certificate',
  'defect_signoff',
  'training',
  'keys_access',
  'other',
] as const;
export type HandoverCategory = (typeof HANDOVER_CATEGORIES)[number];

export const HANDOVER_CATEGORY_LABELS: Record<HandoverCategory, string> = {
  as_built: 'As-built drawings',
  om_manual: 'O&M manuals',
  warranty: 'Warranties',
  certificate: 'Certificates and approvals',
  defect_signoff: 'Defect sign-off',
  training: 'Training and demonstrations',
  keys_access: 'Keys and access',
  other: 'Other',
};

/** Stored state. "Overdue" is derived from the due date and the project's own calendar day. */
export const HANDOVER_STATUSES = [
  'outstanding',
  'requested',
  'received',
  'approved',
  'not_applicable',
] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

export type HandoverState = HandoverStatus | 'overdue';

export const HANDOVER_ACTIONS = [
  'request',
  'receive',
  'approve',
  'reject',
  'markNotApplicable',
  'reopen',
] as const;
export type HandoverAction = (typeof HANDOVER_ACTIONS)[number];

export interface TemplateItem {
  category: HandoverCategory;
  title: string;
  required: boolean;
}

/** A sensible Australian starting set, offered as a one-tap default. It is never applied silently and never twice. */
export const DEFAULT_TEMPLATE: readonly TemplateItem[] = [
  { category: 'as_built', title: 'As-built architectural drawings', required: true },
  { category: 'as_built', title: 'As-built structural drawings', required: true },
  {
    category: 'as_built',
    title: 'As-built services drawings (mechanical, electrical, hydraulic)',
    required: true,
  },
  { category: 'as_built', title: 'As-built fire services drawings', required: false },
  { category: 'om_manual', title: 'O&M manual: mechanical and ventilation', required: true },
  { category: 'om_manual', title: 'O&M manual: electrical and lighting', required: true },
  { category: 'om_manual', title: 'O&M manual: hydraulic and plumbing', required: true },
  { category: 'om_manual', title: 'O&M manual: fire protection and alarms', required: false },
  { category: 'om_manual', title: 'Appliance and equipment manuals', required: false },
  { category: 'warranty', title: 'Builder warranty and defects-liability letter', required: true },
  { category: 'warranty', title: 'Roofing and waterproofing warranties', required: true },
  { category: 'warranty', title: 'Windows, doors and glazing warranties', required: false },
  { category: 'warranty', title: 'Appliance warranties', required: false },
  {
    category: 'certificate',
    title: 'Occupation certificate or certificate of final inspection',
    required: true,
  },
  { category: 'certificate', title: 'Electrical certificate of compliance', required: true },
  {
    category: 'certificate',
    title: 'Plumbing and drainage compliance certificates',
    required: true,
  },
  { category: 'certificate', title: 'Gas compliance certificate', required: false },
  { category: 'certificate', title: 'Structural engineer certification', required: true },
  { category: 'certificate', title: 'Waterproofing certificate', required: true },
  { category: 'certificate', title: 'Termite treatment certificate', required: false },
  {
    category: 'certificate',
    title: 'Fire safety and essential services certificate',
    required: false,
  },
  {
    category: 'defect_signoff',
    title: 'Final defects list closed and signed off by the client',
    required: true,
  },
  {
    category: 'training',
    title: 'Client walkthrough and systems demonstration completed',
    required: true,
  },
  { category: 'keys_access', title: 'Keys, fobs and access cards handed over', required: true },
];

export const handoverLabel = (n: number) => `HND-${String(n).padStart(4, '0')}`;

/** Needs a file as evidence, except when the item does not apply. */
export const NEEDS_FILE: ReadonlySet<HandoverAction> = new Set(['receive']);

export type TransitionResult = { ok: true; to: HandoverStatus } | { ok: false; reason: string };

export function handoverTransition(
  from: HandoverStatus,
  action: HandoverAction,
  ctx: { fileCount?: number; note?: string | null } = {},
): TransitionResult {
  const bad = (reason: string): TransitionResult => ({ ok: false, reason });
  switch (action) {
    case 'request':
      return from === 'outstanding'
        ? { ok: true, to: 'requested' }
        : bad('Only an outstanding item can be requested.');
    case 'receive':
      if (from !== 'outstanding' && from !== 'requested')
        return bad('This item has already been received.');
      if (!ctx.fileCount) return bad('Attach the document before marking it received.');
      return { ok: true, to: 'received' };
    case 'approve':
      return from === 'received'
        ? { ok: true, to: 'approved' }
        : bad('Only a received item can be approved.');
    case 'reject':
      if (from !== 'received') return bad('Only a received item can be sent back.');
      return ctx.note?.trim() ? { ok: true, to: 'requested' } : bad('Say what needs fixing.');
    case 'markNotApplicable':
      if (from === 'not_applicable') return bad('Already marked not applicable.');
      if (from === 'approved') return bad('Reopen an approved item before changing it.');
      return ctx.note?.trim()
        ? { ok: true, to: 'not_applicable' }
        : bad('Say why it does not apply.');
    case 'reopen':
      return from === 'approved' || from === 'not_applicable' || from === 'received'
        ? { ok: true, to: 'outstanding' }
        : bad('Only a finished item can be reopened.');
  }
}

export const isComplete = (s: HandoverStatus) => s === 'approved' || s === 'not_applicable';

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);

export function handoverState(
  i: { status: HandoverStatus; dueOn: string | null },
  today: LocalDate,
): HandoverState {
  if (
    !isComplete(i.status) &&
    i.status !== 'received' &&
    i.dueOn &&
    dayNumber(i.dueOn) < dayNumber(today)
  )
    return 'overdue';
  return i.status;
}

export interface SummaryItem {
  category: HandoverCategory;
  required: boolean;
  status: HandoverStatus;
  dueOn: string | null;
}

export interface HandoverSummary {
  total: number;
  required: number;
  requiredComplete: number;
  complete: number;
  received: number;
  overdue: number;
  /** 0 to 100, over the required items; 100 when none are required. */
  percentComplete: number;
  byCategory: {
    category: HandoverCategory;
    total: number;
    complete: number;
    requiredOutstanding: number;
  }[];
}

export function summarise(items: readonly SummaryItem[], today: LocalDate): HandoverSummary {
  const req = items.filter((i) => i.required);
  const requiredComplete = req.filter((i) => isComplete(i.status)).length;
  const byCategory = HANDOVER_CATEGORIES.map((category) => {
    const rows = items.filter((i) => i.category === category);
    return {
      category,
      total: rows.length,
      complete: rows.filter((i) => isComplete(i.status)).length,
      requiredOutstanding: rows.filter((i) => i.required && !isComplete(i.status)).length,
    };
  }).filter((c) => c.total > 0);
  return {
    total: items.length,
    required: req.length,
    requiredComplete,
    complete: items.filter((i) => isComplete(i.status)).length,
    received: items.filter((i) => i.status === 'received').length,
    overdue: items.filter((i) => handoverState(i, today) === 'overdue').length,
    percentComplete: req.length ? Math.floor((requiredComplete / req.length) * 100) : 100,
    byCategory,
  };
}

/** What other modules know about the project, passed in so the rules stay pure. `null` means "not allowed to see". */
export interface Signals {
  /** Open defects the caller can see (`defects`). */
  openDefects: number | null;
  /** Items on the warranty register (`defects`). */
  warrantyItems: number | null;
  /** Occupation certificate on the permits register and its status (`permits`); null when permits are not readable. */
  occupationCertificate: 'none' | 'present' | null;
}

export interface FlagItem extends SummaryItem {
  id: string;
  number: number;
  title: string;
  responsibleCompanyId: string | null;
  fileCount: number;
  receivedOn: string | null;
}

export type FlagKind =
  | 'empty_checklist'
  | 'overdue'
  | 'no_responsible'
  | 'awaiting_approval'
  | 'open_defects'
  | 'warranty_register_empty'
  | 'no_occupation_certificate';

export interface HandoverFlag {
  kind: FlagKind;
  severity: 'info' | 'warn' | 'high';
  title: string;
  detail: string;
  itemId: string | null;
}

/** Days a received item may wait for approval before Nova mentions it. */
export const APPROVAL_WAIT_DAYS = 7;

/** Rule-based (no model): what to chase before the pack can be issued, most urgent first. */
export function handoverFlags(
  items: readonly FlagItem[],
  signals: Signals,
  today: LocalDate,
): HandoverFlag[] {
  const out: HandoverFlag[] = [];
  if (items.length === 0) {
    out.push({
      kind: 'empty_checklist',
      severity: 'info',
      title: 'No handover checklist yet',
      detail: 'Start from the standard list and edit it to suit the project.',
      itemId: null,
    });
    return out;
  }
  for (const i of items) {
    if (isComplete(i.status)) continue;
    const label = `${handoverLabel(i.number)} ${i.title}`;
    if (handoverState(i, today) === 'overdue') {
      const days = dayNumber(today) - dayNumber(i.dueOn!);
      out.push({
        kind: 'overdue',
        severity: i.required ? 'high' : 'warn',
        title: `${label} is overdue`,
        detail: `Due ${i.dueOn}, ${days} day${days === 1 ? '' : 's'} ago.`,
        itemId: i.id,
      });
    }
    if (i.required && !i.responsibleCompanyId && i.status !== 'received') {
      out.push({
        kind: 'no_responsible',
        severity: 'warn',
        title: `${label} has nobody responsible`,
        detail: 'Name the company that supplies it so it can be chased.',
        itemId: i.id,
      });
    }
    if (i.status === 'received' && i.receivedOn) {
      const waited = dayNumber(today) - dayNumber(i.receivedOn);
      if (waited >= APPROVAL_WAIT_DAYS)
        out.push({
          kind: 'awaiting_approval',
          severity: 'warn',
          title: `${label} is waiting for approval`,
          detail: `Received ${waited} days ago and not yet checked.`,
          itemId: i.id,
        });
    }
  }
  if (signals.openDefects && signals.openDefects > 0)
    out.push({
      kind: 'open_defects',
      severity: 'high',
      title: `${signals.openDefects} open defect${signals.openDefects === 1 ? '' : 's'}`,
      detail: 'Close or agree them with the client before the defect sign-off is approved.',
      itemId: null,
    });
  const hasWarrantyItems = items.some(
    (i) => i.category === 'warranty' && i.status !== 'not_applicable',
  );
  if (signals.warrantyItems === 0 && hasWarrantyItems)
    out.push({
      kind: 'warranty_register_empty',
      severity: 'warn',
      title: 'Warranties are not on the warranty register',
      detail: 'Add each warranty so its expiry is tracked after handover.',
      itemId: null,
    });
  if (signals.occupationCertificate === 'none')
    out.push({
      kind: 'no_occupation_certificate',
      severity: 'info',
      title: 'No occupation certificate on the permits register',
      detail:
        'Add it to permits, or mark the checklist item not applicable if the project does not need one.',
      itemId: null,
    });
  const rank = { high: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Whether the pack can go to the client without anyone having to acknowledge missing items. */
export const readyToIssue = (s: HandoverSummary) =>
  s.required > 0 && s.requiredComplete === s.required;
