// Handover data source, mirroring `{p}/handover`, `.../items`, `.../items/{id}/transition`, `.../template`,
// `.../export` and `.../issues` (handover module). Preview: an in-memory checklist with the server's rules.

import { delay, mockId, problem, projectStores } from '@/shared/mocks/runtime';
import { todayIn } from '@/shared/lib/format';
import type {
  HandoverAction,
  HandoverCategory,
  HandoverExport,
  HandoverFlag,
  HandoverInput,
  HandoverIssue,
  HandoverItem,
  HandoverPack,
  HandoverStatus,
  HandoverSummary,
} from '../lib/types';
import { CATEGORIES } from '../lib/types';

export interface HandoverSource {
  pack(projectId: string): Promise<HandoverPack>;
  create(projectId: string, input: HandoverInput): Promise<HandoverItem>;
  update(
    projectId: string,
    item: HandoverItem,
    input: Partial<HandoverInput>,
  ): Promise<HandoverItem>;
  attach(projectId: string, item: HandoverItem, files: File[]): Promise<HandoverItem>;
  transition(
    projectId: string,
    item: HandoverItem,
    t: { action: HandoverAction; note?: string },
  ): Promise<HandoverItem>;
  applyTemplate(projectId: string): Promise<number>;
  export(projectId: string): Promise<HandoverExport>;
  issue(
    projectId: string,
    input: { recipientName: string; note?: string; acknowledgeIncomplete?: boolean },
  ): Promise<HandoverIssue>;
}

interface Store {
  items: HandoverItem[];
  issues: HandoverIssue[];
  next: number;
}

const DAY = 86_400_000;
const TZ = 'Australia/Sydney';
const dayNo = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
const plus = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const label = (n: number) => `HND-${String(n).padStart(4, '0')}`;
const complete = (s: HandoverStatus) => s === 'approved' || s === 'not_applicable';

const TEMPLATE: { category: HandoverCategory; title: string; required: boolean }[] = [
  { category: 'as_built', title: 'As-built architectural drawings', required: true },
  { category: 'as_built', title: 'As-built structural drawings', required: true },
  { category: 'om_manual', title: 'O&M manual: mechanical and ventilation', required: true },
  { category: 'om_manual', title: 'O&M manual: electrical and lighting', required: true },
  { category: 'warranty', title: 'Roofing and waterproofing warranties', required: true },
  {
    category: 'certificate',
    title: 'Occupation certificate or certificate of final inspection',
    required: true,
  },
  { category: 'certificate', title: 'Electrical certificate of compliance', required: true },
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

function derive(r: HandoverItem): HandoverItem {
  const overdue =
    !complete(r.status) &&
    r.status !== 'received' &&
    r.dueOn !== null &&
    dayNo(r.dueOn) < dayNo(todayIn(TZ));
  return { ...r, state: overdue ? 'overdue' : r.status };
}

function make(n: number, over: Partial<HandoverItem>): HandoverItem {
  return derive({
    id: `hoi_000${n}`,
    numberLabel: label(n),
    category: 'other',
    title: '',
    description: null,
    required: true,
    status: 'outstanding',
    state: 'outstanding',
    responsibleCompanyId: null,
    dueOn: null,
    receivedOn: null,
    approvedOn: null,
    note: null,
    fileIds: [],
    version: 1,
    ...over,
  });
}

const stores = projectStores<Store>(() => ({
  next: 7,
  issues: [],
  items: [
    make(1, {
      category: 'as_built',
      title: 'As-built architectural drawings',
      status: 'approved',
      fileIds: ['fil_a'],
      approvedOn: plus(-6),
      receivedOn: plus(-9),
    }),
    make(2, {
      category: 'om_manual',
      title: 'O&M manual: electrical and lighting',
      status: 'received',
      fileIds: ['fil_b', 'fil_c'],
      receivedOn: plus(-9),
      responsibleCompanyId: 'cmp_1',
    }),
    make(3, {
      category: 'warranty',
      title: 'Roofing and waterproofing warranties',
      status: 'requested',
      dueOn: plus(-3),
      responsibleCompanyId: 'cmp_2',
    }),
    make(4, {
      category: 'certificate',
      title: 'Electrical certificate of compliance',
      dueOn: plus(10),
    }),
    make(5, {
      category: 'certificate',
      title: 'Gas compliance certificate',
      required: false,
      status: 'not_applicable',
      note: 'All-electric building',
    }),
    make(6, {
      category: 'keys_access',
      title: 'Keys, fobs and access cards handed over',
      dueOn: plus(21),
    }),
  ],
}));

const find = (projectId: string, id: string) => {
  const hit = stores.get(projectId).items.find((x) => x.id === id);
  if (!hit) problem(404, 'handover.item_not_found', 'Item not found.');
  return hit;
};

function summarise(items: HandoverItem[]): HandoverSummary {
  const req = items.filter((i) => i.required);
  const done = req.filter((i) => complete(i.status)).length;
  return {
    total: items.length,
    required: req.length,
    requiredComplete: done,
    complete: items.filter((i) => complete(i.status)).length,
    received: items.filter((i) => i.status === 'received').length,
    overdue: items.filter((i) => i.state === 'overdue').length,
    percentComplete: req.length ? Math.floor((done / req.length) * 100) : 100,
    byCategory: CATEGORIES.map((category) => {
      const rows = items.filter((i) => i.category === category);
      return {
        category,
        total: rows.length,
        complete: rows.filter((i) => complete(i.status)).length,
        requiredOutstanding: rows.filter((i) => i.required && !complete(i.status)).length,
      };
    }).filter((c) => c.total > 0),
  };
}

function flagsFor(items: HandoverItem[]): HandoverFlag[] {
  if (items.length === 0)
    return [
      {
        kind: 'empty_checklist',
        severity: 'info',
        title: 'No handover checklist yet',
        detail: 'Start from the standard list and edit it to suit the project.',
        itemId: null,
      },
    ];
  const out: HandoverFlag[] = [];
  for (const i of items) {
    if (complete(i.status)) continue;
    const name = `${i.numberLabel} ${i.title}`;
    if (i.state === 'overdue') {
      const days = dayNo(todayIn(TZ)) - dayNo(i.dueOn!);
      out.push({
        kind: 'overdue',
        severity: i.required ? 'high' : 'warn',
        title: `${name} is overdue`,
        detail: `Due ${i.dueOn}, ${days} day${days === 1 ? '' : 's'} ago.`,
        itemId: i.id,
      });
    }
    if (i.required && !i.responsibleCompanyId && i.status !== 'received')
      out.push({
        kind: 'no_responsible',
        severity: 'warn',
        title: `${name} has nobody responsible`,
        detail: 'Name the company that supplies it so it can be chased.',
        itemId: i.id,
      });
    if (i.status === 'received' && i.receivedOn) {
      const waited = dayNo(todayIn(TZ)) - dayNo(i.receivedOn);
      if (waited >= 7)
        out.push({
          kind: 'awaiting_approval',
          severity: 'warn',
          title: `${name} is waiting for approval`,
          detail: `Received ${waited} days ago and not yet checked.`,
          itemId: i.id,
        });
    }
  }
  out.push({
    kind: 'open_defects',
    severity: 'high',
    title: '4 open defects',
    detail: 'Close or agree them with the client before the defect sign-off is approved.',
    itemId: null,
  });
  const rank = { high: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const TRANSITIONS: Record<HandoverAction, { from: HandoverStatus[]; to: HandoverStatus }> = {
  request: { from: ['outstanding'], to: 'requested' },
  receive: { from: ['outstanding', 'requested'], to: 'received' },
  approve: { from: ['received'], to: 'approved' },
  reject: { from: ['received'], to: 'requested' },
  markNotApplicable: { from: ['outstanding', 'requested', 'received'], to: 'not_applicable' },
  reopen: { from: ['received', 'approved', 'not_applicable'], to: 'outstanding' },
};

export const handoverPreview: HandoverSource = {
  pack: (projectId) => {
    const s = stores.get(projectId);
    const items = s.items.map(derive);
    const summary = summarise(items);
    return delay({
      items,
      summary,
      readyToIssue: summary.required > 0 && summary.requiredComplete === summary.required,
      flags: flagsFor(items),
      issues: s.issues,
    });
  },
  create: (projectId, input) => {
    const s = stores.get(projectId);
    const row = make(s.next++, { ...input, id: mockId('hoi') });
    s.items.push(row);
    return delay(row);
  },
  update: (projectId, item, input) => {
    const hit = find(projectId, item.id);
    Object.assign(hit, input, { version: hit.version + 1 });
    return delay(derive(hit));
  },
  attach: (projectId, item, files) => {
    const hit = find(projectId, item.id);
    if (hit.status === 'approved')
      problem(
        409,
        'handover.invalid_transition',
        'Reopen an approved item before changing its files.',
      );
    hit.fileIds = [...hit.fileIds, ...files.map((f) => mockId(`fil_${f.name}`))];
    hit.version += 1;
    return delay(derive(hit));
  },
  transition: (projectId, item, t) => {
    const hit = find(projectId, item.id);
    const rule = TRANSITIONS[t.action];
    if (!rule.from.includes(hit.status))
      problem(409, 'handover.invalid_transition', 'That isn’t available for this item.');
    if (t.action === 'receive' && hit.fileIds.length === 0)
      problem(
        409,
        'handover.invalid_transition',
        'Attach the document before marking it received.',
      );
    if ((t.action === 'reject' || t.action === 'markNotApplicable') && !t.note?.trim())
      problem(
        409,
        'handover.invalid_transition',
        t.action === 'reject' ? 'Say what needs fixing.' : 'Say why it does not apply.',
      );
    hit.status = rule.to;
    hit.receivedOn =
      rule.to === 'received' ? todayIn(TZ) : rule.to === 'outstanding' ? null : hit.receivedOn;
    hit.approvedOn = rule.to === 'approved' ? todayIn(TZ) : null;
    if (t.note) hit.note = t.note;
    hit.version += 1;
    return delay(derive(hit));
  },
  applyTemplate: (projectId) => {
    const s = stores.get(projectId);
    const have = new Set(s.items.map((i) => i.title.toLowerCase()));
    let added = 0;
    for (const t of TEMPLATE) {
      if (have.has(t.title.toLowerCase())) continue;
      s.items.push(make(s.next++, { ...t, id: mockId('hoi') }));
      added += 1;
    }
    return delay(added);
  },
  export: (projectId) => {
    const s = stores.get(projectId);
    const items = s.items.map(derive);
    return delay({
      projectName: 'Harbour Street Apartments',
      generatedAt: new Date().toISOString(),
      summary: summarise(items),
      items: items.map((i) => ({
        numberLabel: i.numberLabel,
        category: i.category,
        title: i.title,
        required: i.required,
        status: i.status,
        files: i.fileIds.map((id, n) => ({
          id,
          filename: `${i.numberLabel}-${n + 1}.pdf`,
          sizeBytes: 120_000,
        })),
      })),
    });
  },
  issue: (projectId, input) => {
    const s = stores.get(projectId);
    const items = s.items.map(derive);
    if (items.length === 0)
      problem(422, 'handover.nothing_to_issue', 'Add items to the checklist first.');
    const incomplete = items.filter((i) => i.required && !complete(i.status)).length;
    if (incomplete > 0 && !input.acknowledgeIncomplete)
      problem(
        409,
        'handover.incomplete',
        `${incomplete} required item${incomplete === 1 ? ' is' : 's are'} not complete. Confirm to issue anyway.`,
      );
    const issue: HandoverIssue = {
      id: mockId('hoz'),
      recipientName: input.recipientName,
      note: input.note ?? null,
      incompleteCount: incomplete,
      issuedAt: new Date().toISOString(),
    };
    s.issues.unshift(issue);
    return delay(issue);
  },
};

export function resetHandoverPreview() {
  stores.reset();
}
