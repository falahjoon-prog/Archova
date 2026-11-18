export type HandoverCategory =
  | 'as_built'
  | 'om_manual'
  | 'warranty'
  | 'certificate'
  | 'defect_signoff'
  | 'training'
  | 'keys_access'
  | 'other';
export type HandoverStatus =
  'outstanding' | 'requested' | 'received' | 'approved' | 'not_applicable';
export type HandoverState = HandoverStatus | 'overdue';
export type HandoverAction =
  'request' | 'receive' | 'approve' | 'reject' | 'markNotApplicable' | 'reopen';
export type FlagKind =
  | 'empty_checklist'
  | 'overdue'
  | 'no_responsible'
  | 'awaiting_approval'
  | 'open_defects'
  | 'warranty_register_empty'
  | 'no_occupation_certificate';

export const CATEGORIES: HandoverCategory[] = [
  'as_built',
  'om_manual',
  'warranty',
  'certificate',
  'defect_signoff',
  'training',
  'keys_access',
  'other',
];
export const CATEGORY_LABELS: Record<HandoverCategory, string> = {
  as_built: 'As-built drawings',
  om_manual: 'O&M manuals',
  warranty: 'Warranties',
  certificate: 'Certificates and approvals',
  defect_signoff: 'Defect sign-off',
  training: 'Training and demonstrations',
  keys_access: 'Keys and access',
  other: 'Other',
};
export const STATES: HandoverState[] = [
  'outstanding',
  'requested',
  'received',
  'approved',
  'not_applicable',
  'overdue',
];
export const STATE_LABELS: Record<HandoverState, string> = {
  outstanding: 'Outstanding',
  requested: 'Requested',
  received: 'Received',
  approved: 'Approved',
  not_applicable: 'Not applicable',
  overdue: 'Overdue',
};
export const ACTION_LABELS: Record<HandoverAction, string> = {
  request: 'Request',
  receive: 'Mark received',
  approve: 'Approve',
  reject: 'Send back',
  markNotApplicable: 'Not applicable',
  reopen: 'Reopen',
};

export interface HandoverItem {
  id: string;
  numberLabel: string;
  category: HandoverCategory;
  title: string;
  description: string | null;
  required: boolean;
  status: HandoverStatus;
  state: HandoverState;
  responsibleCompanyId: string | null;
  dueOn: string | null;
  receivedOn: string | null;
  approvedOn: string | null;
  note: string | null;
  fileIds: string[];
  version: number;
}

export interface HandoverInput {
  category: HandoverCategory;
  title: string;
  description?: string | null;
  required?: boolean;
  responsibleCompanyId?: string | null;
  dueOn?: string | null;
  note?: string | null;
}

export interface HandoverFlag {
  kind: FlagKind;
  severity: 'info' | 'warn' | 'high';
  title: string;
  detail: string;
  itemId: string | null;
}

export interface HandoverSummary {
  total: number;
  required: number;
  requiredComplete: number;
  complete: number;
  received: number;
  overdue: number;
  percentComplete: number;
  byCategory: {
    category: HandoverCategory;
    total: number;
    complete: number;
    requiredOutstanding: number;
  }[];
}

export interface HandoverIssue {
  id: string;
  recipientName: string;
  note: string | null;
  incompleteCount: number;
  issuedAt: string;
}

export interface HandoverPack {
  items: HandoverItem[];
  summary: HandoverSummary;
  readyToIssue: boolean;
  flags: HandoverFlag[];
  issues: HandoverIssue[];
}

export interface HandoverExport {
  projectName: string;
  generatedAt: string;
  summary: HandoverSummary;
  items: {
    numberLabel: string;
    category: HandoverCategory;
    title: string;
    required: boolean;
    status: HandoverStatus;
    files: { id: string; filename: string; sizeBytes: number }[];
  }[];
}

export interface HandoverFilters {
  category?: HandoverCategory;
  state?: HandoverState;
}

/** What can be done to an item in its current status; mirrors the server's transition table. */
export function availableActions(status: HandoverStatus): HandoverAction[] {
  switch (status) {
    case 'outstanding':
      return ['request', 'receive', 'markNotApplicable'];
    case 'requested':
      return ['receive', 'markNotApplicable'];
    case 'received':
      return ['approve', 'reject', 'reopen'];
    case 'approved':
    case 'not_applicable':
      return ['reopen'];
  }
}

const BOM = String.fromCharCode(0xfeff);
const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The client copy as CSV: UTF-8 with a byte-order mark so Excel reads it, one row per item. */
export function exportCsv(x: HandoverExport): string {
  const rows = [
    ['No.', 'Category', 'Item', 'Required', 'Status', 'Files'],
    ...x.items.map((i) => [
      i.numberLabel,
      CATEGORY_LABELS[i.category],
      i.title,
      i.required ? 'Yes' : 'No',
      STATE_LABELS[i.status],
      i.files.map((f) => f.filename).join('; '),
    ]),
  ];
  return `${BOM}${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
