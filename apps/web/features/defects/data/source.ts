// Defects data source, mirroring `CRUD {p}/defects`, `POST {p}/defects/bulk` and
// `POST {p}/defects/{id}/assign|ready-for-review|close|reject|dispute` (backend 04 §3). Preview: in-memory store;
// photos are file names only. Nova's trade suggestion is keyword-based and says so.

import { MOCK_COMPANIES, companyName, personCompanyId } from '@/shared/mocks/directory';
import { locationLevel } from '@/shared/mocks/locations';
import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import { canDefect, defectInputErrors, isDefectOverdue, type DefectAction } from '../lib/lifecycle';
import type {
  Defect,
  DefectInput,
  DefectNovaSuggestion,
  DefectStage,
  DefectStatus,
} from '../lib/types';

export interface Actor {
  id: string;
  name: string;
  companyId: string | null;
}

interface Store {
  defects: Defect[];
  nextNumber: number;
}

/** DEF-AC5: "Ready for inspection" needs a photo by default (a project setting). */
export const READY_NEEDS_PHOTO = true;

const at = (d: string) => `${d}T01:00:00Z`;

function seedDefect(
  p: Partial<Defect> & Pick<Defect, 'id' | 'number' | 'title' | 'assigneeCompanyId' | 'trade'>,
): Defect {
  return {
    description: '',
    status: 'open',
    priority: 'medium',
    stage: 'pre_pc',
    locationId: null,
    drawing: null,
    assigneeUserId: null,
    dueDate: null,
    raisedBy: 'Luca Romano',
    raisedByCompanyId: 'cmp_builder',
    source: 'manual',
    photos: [{ id: `${p.id}_p1`, name: `${p.id}-before.jpg`, kind: 'before' }],
    events: [
      {
        id: `${p.id}_e1`,
        fromStatus: null,
        toStatus: 'open',
        note: null,
        photoIds: [`${p.id}_p1`],
        by: 'Luca Romano',
        at: at('2026-09-22'),
      },
    ],
    createdAt: at('2026-09-22'),
    readyForReviewAt: null,
    closedAt: null,
    category: null,
    availableActions: null,
    isOverdue: null,
    version: 1,
    ...p,
  };
}

function seed(): Store {
  return {
    nextNumber: 7,
    defects: [
      seedDefect({
        id: 'dft_0001',
        number: 1,
        title: 'Paint touch-up, retail 1 east wall',
        description: 'Scuffs and roller marks on the east wall, about 2 m wide at eye height.',
        status: 'ready_for_review',
        trade: 'Painting',
        assigneeCompanyId: 'cmp_paint',
        locationId: 'loc_ground_retail_1',
        drawing: {
          sheetId: 'sht_a101',
          revisionId: 'rev_a101_c',
          label: 'A-101 Rev C',
          x: 225 / 841,
          y: 150 / 594,
        },
        dueDate: '2026-10-03',
        readyForReviewAt: at('2026-10-01'),
        photos: [
          { id: 'dft_0001_p1', name: 'dft_0001-before.jpg', kind: 'before' },
          { id: 'dft_0001_p2', name: 'retail1-east-after.jpg', kind: 'after' },
        ],
        events: [
          {
            id: 'e1',
            fromStatus: null,
            toStatus: 'open',
            note: null,
            photoIds: ['dft_0001_p1'],
            by: 'Luca Romano',
            at: at('2026-09-22'),
          },
          {
            id: 'e2',
            fromStatus: 'open',
            toStatus: 'ready_for_review',
            note: 'Two coats applied.',
            photoIds: ['dft_0001_p2'],
            by: 'Coastline Painting',
            at: at('2026-10-01'),
          },
        ],
      }),
      seedDefect({
        id: 'dft_0002',
        number: 2,
        title: 'Chipped floor tile at lobby entry',
        description: 'One 600×600 porcelain tile chipped on the corner inside the main entry door.',
        trade: 'Tiling',
        assigneeCompanyId: 'cmp_tile',
        assigneeUserId: 'usr_tile',
        locationId: 'loc_ground_lobby',
        drawing: {
          sheetId: 'sht_a101',
          revisionId: 'rev_a101_c',
          label: 'A-101 Rev C',
          x: 300 / 841,
          y: 430 / 594,
        },
        dueDate: '2026-10-08',
        priority: 'high',
      }),
      seedDefect({
        id: 'dft_0003',
        number: 3,
        title: 'Missing GPO cover plate',
        description: 'Double power point in the kitchen has no cover plate.',
        trade: 'Electrical',
        assigneeCompanyId: 'cmp_elec',
        locationId: 'loc_level_1_unit_101',
        dueDate: '2026-09-29',
      }),
      seedDefect({
        id: 'dft_0004',
        number: 4,
        title: 'Leaking tap in amenities',
        trade: 'Hydraulics',
        assigneeCompanyId: 'cmp_plumb',
        locationId: 'loc_ground_amenities',
        status: 'closed',
        dueDate: '2026-09-25',
        closedAt: at('2026-09-24'),
        events: [
          {
            id: 'e1',
            fromStatus: null,
            toStatus: 'open',
            note: null,
            photoIds: [],
            by: 'Luca Romano',
            at: at('2026-09-20'),
          },
          {
            id: 'e2',
            fromStatus: 'open',
            toStatus: 'ready_for_review',
            note: 'Washer replaced.',
            photoIds: [],
            by: 'Bayside Hydraulics',
            at: at('2026-09-23'),
          },
          {
            id: 'e3',
            fromStatus: 'ready_for_review',
            toStatus: 'closed',
            note: null,
            photoIds: [],
            by: 'Luca Romano',
            at: at('2026-09-24'),
          },
        ],
      }),
      seedDefect({
        id: 'dft_0005',
        number: 5,
        title: 'Plasterboard crack above door',
        description: 'Hairline crack from the door head to the cornice.',
        trade: 'Plasterboard and ceilings',
        assigneeCompanyId: 'cmp_paint',
        locationId: 'loc_level_2_corridor',
        status: 'disputed',
        dueDate: '2026-10-06',
        events: [
          {
            id: 'e1',
            fromStatus: null,
            toStatus: 'open',
            note: null,
            photoIds: [],
            by: 'Luca Romano',
            at: at('2026-09-26'),
          },
          {
            id: 'e2',
            fromStatus: 'open',
            toStatus: 'disputed',
            note: 'Crack is in the board, not the paint. Please send to the lining contractor.',
            photoIds: [],
            by: 'Coastline Painting',
            at: at('2026-09-29'),
          },
        ],
      }),
      seedDefect({
        id: 'dft_0006',
        number: 6,
        title: 'Roof plant deck handrail gap',
        description: 'Gap at the handrail splice exceeds 125 mm.',
        trade: 'Formwork',
        assigneeCompanyId: 'cmp_form',
        locationId: 'loc_roof_plant_deck',
        stage: 'pc',
        priority: 'critical',
        dueDate: '2026-10-10',
        raisedBy: 'Certifier walk',
        raisedByCompanyId: null,
        source: 'certifier',
      }),
    ],
  };
}

const stores = projectStores<Store>(seed);

export interface DefectFilters {
  status?: DefectStatus | undefined;
  stage?: DefectStage | undefined;
  companyId?: string | undefined;
  trade?: string | undefined;
  level?: string | undefined;
  overdueOn?: string | undefined;
  q?: string | undefined;
}

function find(projectId: string, id: string): Defect {
  const d = stores.get(projectId).defects.find((x) => x.id === id);
  if (!d) problem(404, 'not_found', "We couldn't find that defect.");
  return d;
}

function ensure(d: Defect, action: DefectAction) {
  if (!canDefect(d.status, action))
    problem(409, `defect.cannot_${action}`, `This defect is ${d.status.replace(/_/g, ' ')}.`);
}

function transition(
  d: Defect,
  to: DefectStatus,
  actor: Actor,
  note: string | null,
  photoIds: string[] = [],
) {
  d.events.push({
    id: mockId('evt'),
    fromStatus: d.status,
    toStatus: to,
    note,
    photoIds,
    by: actor.name,
    at: nowIso(),
  });
  d.status = to;
}

function addPhotos(d: Defect, names: string[], kind: 'after' | 'closeout'): string[] {
  const added = names.map((name) => ({ id: mockId('pho'), name, kind }));
  d.photos.push(...added);
  return added.map((p) => p.id);
}

export const defectsSource: DefectsSource = {
  live: false,
  async list(projectId: string, f: DefectFilters = {}): Promise<Defect[]> {
    const q = f.q?.trim().toLowerCase();
    const rows = stores
      .get(projectId)
      .defects.filter((d) => !f.status || d.status === f.status)
      .filter((d) => !f.stage || d.stage === f.stage)
      .filter((d) => !f.companyId || d.assigneeCompanyId === f.companyId)
      .filter((d) => !f.trade || d.trade === f.trade)
      .filter((d) => !f.level || locationLevel(d.locationId) === f.level)
      .filter((d) => !f.overdueOn || isDefectOverdue(d, f.overdueOn))
      .filter(
        (d) =>
          !q ||
          `${d.title} ${d.description} DEF-${String(d.number ?? '').padStart(4, '0')}`
            .toLowerCase()
            .includes(q),
      );
    return delay(rows);
  },

  async get(projectId: string, id: string): Promise<Defect> {
    return delay(find(projectId, id));
  },

  /** Raised on the web: online, so it's numbered straight away (DEF-AC2). */
  async create(
    projectId: string,
    input: DefectInput,
    actor: Actor,
    aiSuggestionId: string | null,
  ): Promise<Defect> {
    const errors = defectInputErrors(input);
    if (Object.keys(errors).length) problem(422, 'validation', Object.values(errors)[0]!);
    const s = stores.get(projectId);
    const id = mockId('dft');
    const photos = input.photos.map((f) => ({
      id: mockId('pho'),
      name: f.name,
      kind: 'before' as const,
    }));
    const d: Defect = {
      id,
      number: s.nextNumber++,
      title: input.title.trim(),
      description: input.description.trim(),
      status: 'open',
      priority: input.priority,
      trade: input.trade,
      category: input.category,
      stage: input.stage,
      locationId: input.locationId,
      drawing: input.drawing,
      assigneeCompanyId: input.assigneeCompanyId!,
      assigneeUserId: input.assigneeUserId,
      dueDate: input.dueDate,
      raisedBy: actor.name,
      raisedByCompanyId: actor.companyId,
      source: aiSuggestionId ? 'ai_suggested' : 'manual',
      photos,
      events: [
        {
          id: mockId('evt'),
          fromStatus: null,
          toStatus: 'open',
          note: null,
          photoIds: photos.map((p) => p.id),
          by: actor.name,
          at: nowIso(),
        },
      ],
      createdAt: nowIso(),
      readyForReviewAt: null,
      closedAt: null,
      availableActions: null,
      isOverdue: null,
      version: 1,
    };
    s.defects.push(d);
    return delay(d);
  },

  /** Bulk assign from the register (cross-cutting bulk actions; `POST {p}/defects/bulk`). */
  async bulkAssign(
    projectId: string,
    ids: string[],
    patch: { companyId?: string; dueDate?: string; stage?: DefectStage },
    actor: Actor,
  ): Promise<Defect[]> {
    const out: Defect[] = [];
    for (const id of ids) {
      const d = find(projectId, id);
      if (!canDefect(d.status, 'reassign') && patch.companyId) continue;
      if (patch.companyId && patch.companyId !== d.assigneeCompanyId) {
        d.assigneeCompanyId = patch.companyId;
        d.assigneeUserId = null;
        const to = d.status === 'disputed' ? 'open' : d.status;
        transition(d, to, actor, `Assigned to ${companyName(patch.companyId)}`);
      }
      if (patch.dueDate) d.dueDate = patch.dueDate;
      if (patch.stage) d.stage = patch.stage;
      out.push(d);
    }
    return delay(out);
  },

  async markReady(
    projectId: string,
    id: string,
    v: { note: string; photos: File[] },
    actor: Actor,
  ): Promise<Defect> {
    const d = find(projectId, id);
    ensure(d, 'ready');
    if (READY_NEEDS_PHOTO && v.photos.length === 0)
      problem(422, 'defect.photo_required', 'Add an “after” photo to show the fix.');
    const ids = addPhotos(
      d,
      v.photos.map((f) => f.name),
      'after',
    );
    transition(d, 'ready_for_review', actor, v.note.trim() || null, ids);
    d.readyForReviewAt = nowIso();
    return delay(d);
  },

  async close(
    projectId: string,
    id: string,
    v: { note: string; photos: File[] },
    actor: Actor,
  ): Promise<Defect> {
    const d = find(projectId, id);
    ensure(d, 'close');
    const ids = addPhotos(
      d,
      v.photos.map((f) => f.name),
      'closeout',
    );
    transition(d, 'closed', actor, v.note.trim() || null, ids);
    d.closedAt = nowIso();
    return delay(d);
  },

  /** Reject, dispute and void all need a reason the other party sees (DEF-AC6). */
  async withReason(
    projectId: string,
    id: string,
    action: 'reject' | 'dispute' | 'void',
    reason: string,
    actor: Actor,
  ): Promise<Defect> {
    const d = find(projectId, id);
    ensure(d, action);
    if (!reason.trim()) problem(422, 'validation', 'Give a reason.');
    const to: DefectStatus =
      action === 'reject' ? 'open' : action === 'dispute' ? 'disputed' : 'void';
    transition(d, to, actor, reason.trim());
    if (action === 'reject') d.readyForReviewAt = null;
    return delay(d);
  },

  async issue(projectId: string, id: string, actor: Actor): Promise<Defect> {
    const d = find(projectId, id);
    ensure(d, 'issue');
    transition(d, 'open', actor, null);
    return delay(d);
  },

  async reassign(
    projectId: string,
    id: string,
    v: { companyId: string; userId: string | null; dueDate: string | null },
    actor: Actor,
  ): Promise<Defect> {
    const d = find(projectId, id);
    ensure(d, 'reassign');
    d.assigneeCompanyId = v.companyId;
    d.assigneeUserId = v.userId && personCompanyId(v.userId) === v.companyId ? v.userId : null;
    d.dueDate = v.dueDate;
    transition(d, 'open', actor, `Assigned to ${companyName(v.companyId)}`);
    return delay(d);
  },

  // ---- Nova (preview). Production: Ari F5 from the photo, pin and description, with confidence. ----

  /** Trade, company and title from the description. Keyword matching in the preview. */
  async novaSuggest(
    _projectId: string,
    v: { description: string },
  ): Promise<DefectNovaSuggestion | null> {
    const description = v.description;
    const text = description.toLowerCase();
    const rules: Array<[RegExp, string]> = [
      [/tile|grout|tiling/, 'cmp_tile'],
      [/paint|scuff|roller|touch[- ]?up/, 'cmp_paint'],
      [/gpo|power|light|switch|cable|electric/, 'cmp_elec'],
      [/tap|leak|drain|toilet|basin|pipe/, 'cmp_plumb'],
      [/plaster|crack|ceiling|cornice|lining/, 'cmp_dry'],
    ];
    const hit = rules.find(([re]) => re.test(text));
    if (!hit) return delay(null, 300);
    const company = MOCK_COMPANIES.find((c) => c.id === hit[1])!;
    const first = description.trim().split(/[.\n]/)[0] ?? '';
    const title = first.length > 60 ? `${first.slice(0, 57)}…` : first;
    return delay(
      {
        id: mockId('ais'),
        title: title.charAt(0).toUpperCase() + title.slice(1),
        description: null,
        trade: company.trade,
        category: null,
        priority: null,
        companyId: company.id,
        gaps: [],
        unsupportedNumbers: [],
      },
      300,
    );
  },

  /** Nothing to record in the preview; the API keeps the decision on the suggestion. */
  async novaDecide(): Promise<void> {},

  /** Open defects at the same location or drawing with overlapping words (DEF-US10). */
  async novaDuplicates(
    projectId: string,
    v: { title: string; locationId: string | null; drawing: Defect['drawing'] },
  ): Promise<Defect[]> {
    const words = new Set(
      v.title
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3),
    );
    const rows = stores
      .get(projectId)
      .defects.filter((d) => d.status !== 'closed' && d.status !== 'void')
      .filter(
        (d) =>
          (v.locationId && d.locationId === v.locationId) ||
          (v.drawing && d.drawing?.sheetId === v.drawing.sheetId),
      )
      .filter((d) =>
        d.title
          .toLowerCase()
          .split(/\W+/)
          .some((w) => words.has(w)),
      );
    return delay(rows);
  },
};

/** What the screens and hooks use: the preview store above, or `createDefectsApi` once the module is reachable. */
export interface DefectsSource {
  /** Live forms pick a location from the project's tree (or a drawing pin); preview uses its own mock tree. */
  live: boolean;
  list(projectId: string, f?: DefectFilters): Promise<Defect[]>;
  get(projectId: string, id: string): Promise<Defect>;
  create(
    projectId: string,
    input: DefectInput,
    actor: Actor,
    aiSuggestionId: string | null,
  ): Promise<Defect>;
  bulkAssign(
    projectId: string,
    ids: string[],
    patch: { companyId?: string; dueDate?: string; stage?: DefectStage },
    actor: Actor,
  ): Promise<Defect[]>;
  markReady(
    projectId: string,
    id: string,
    v: { note: string; photos: File[] },
    actor: Actor,
  ): Promise<Defect>;
  close(
    projectId: string,
    id: string,
    v: { note: string; photos: File[] },
    actor: Actor,
  ): Promise<Defect>;
  withReason(
    projectId: string,
    id: string,
    action: 'reject' | 'dispute' | 'void',
    reason: string,
    actor: Actor,
  ): Promise<Defect>;
  reassign(
    projectId: string,
    id: string,
    v: { companyId: string; userId: string | null; dueDate: string | null },
    actor: Actor,
  ): Promise<Defect>;
  /** Draft to open: assigns the company and sends it (needs the company already on the draft). */
  issue(projectId: string, id: string, actor: Actor): Promise<Defect>;
  novaSuggest(
    projectId: string,
    v: { description: string; photos: File[]; drawing: Defect['drawing'] },
  ): Promise<DefectNovaSuggestion | null>;
  novaDecide(
    projectId: string,
    suggestionId: string,
    decision: 'accepted' | 'edited' | 'rejected',
  ): Promise<void>;
  novaDuplicates(
    projectId: string,
    v: { title: string; locationId: string | null; drawing: Defect['drawing'] },
  ): Promise<Defect[]>;
}

export function resetDefectsPreview() {
  stores.reset();
}
