// RFIs data source, mirroring `CRUD {p}/rfis`, `POST {p}/rfis/{id}/open|close|reopen|void`,
// `POST {p}/rfis/{id}/responses` and `POST {p}/rfis/{id}/ai-draft` (backend 04 §3). Preview: in-memory store;
// the Nova calls return canned drafts with citations so the review flow can be exercised.

import { companyName, personCompanyId, personName } from '@/shared/mocks/directory';
import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import { canTransition, submitErrors, type RfiAction } from '../lib/lifecycle';
import type {
  NovaDraft,
  NovaReference,
  NovaWording,
  NovaRfiDraft,
  NovaRfiSource,
  Rfi,
  RfiAnnotation,
  RfiInput,
  RfiPhoto,
  RfiStatus,
} from '../lib/types';
import type { MarkupShape } from '@archova/markup';

interface Store {
  rfis: Rfi[];
  nextNumber: number;
  /** Photos by file id; `url` is a data or object URL, standing in for the signed download link. */
  photoFiles: Record<string, { name: string; url: string }>;
  annotations: RfiAnnotation[];
}

/** A stand-in site photo: a wall with a door opening, so marks have something to point at. */
const SAMPLE_PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#cfd4d6"/><rect y="430" width="800" height="170" fill="#9aa3a6"/><rect x="120" y="90" width="230" height="340" fill="#7a8588"/><rect x="150" y="120" width="170" height="310" fill="#e8ecee"/><rect x="430" y="60" width="260" height="190" fill="#b9c1c4"/><circle cx="560" cy="155" r="42" fill="#8e989b"/></svg>',
)}`;

export interface Actor {
  id: string;
  name: string;
  companyId: string | null;
}

const at = (d: string) => `${d}T00:30:00Z`;

function seedRfi(
  partial: Partial<Rfi> & Pick<Rfi, 'id' | 'number' | 'subject' | 'question' | 'status'>,
): Rfi {
  return {
    isPrivate: false,
    managerId: 'usr_pm',
    assigneeId: 'usr_eng',
    assigneeCompanyId: 'cmp_struct',
    ballInCourtId: 'usr_eng',
    ballInCourtCompanyId: 'cmp_struct',
    ballInCourtSince: null,
    receivedFromCompanyId: null,
    distributionCompanyIds: [],
    dueDate: null,
    costImpact: 'tbc',
    scheduleImpactDays: null,
    drawing: null,
    specSection: null,
    location: null,
    fileIds: [],
    responses: [],
    officialResponseId: null,
    activity: [],
    createdAt: at('2026-09-01'),
    answeredAt: null,
    closedAt: null,
    ...partial,
  };
}

function seed(): Store {
  return {
    nextNumber: 5,
    photoFiles: { fil_binstore: { name: 'bin-store-door.jpg', url: SAMPLE_PHOTO } },
    annotations: [],
    rfis: [
      seedRfi({
        id: 'rfi_001',
        number: 1,
        subject: 'Slab edge set-out at grid C',
        question:
          'S-201 Rev 1 shows the slab edge 150 mm off grid C, but A-101 shows it on grid. Which governs?',
        status: 'closed',
        dueDate: '2026-09-09',
        costImpact: 'no',
        drawing: { sheetId: 'sht_s201', revisionId: 'rev_s201_1', label: 'S-201 Rev 1' },
        specSection: '0331 Structural concrete',
        location: 'Ground, grid C',
        ballInCourtId: null,
        ballInCourtCompanyId: null,
        responses: [
          {
            id: 'rsp_1',
            authorId: 'usr_eng',
            authorName: 'Jo Smith',
            authorCompanyId: 'cmp_struct',
            body: 'S-201 governs. Set out the slab edge 150 mm off grid C as shown.',
            isOfficial: true,
            aiSuggestionId: null,
            fileIds: [],
            createdAt: at('2026-09-05'),
          },
        ],
        officialResponseId: 'rsp_1',
        answeredAt: at('2026-09-05'),
        closedAt: at('2026-09-06'),
        activity: [
          { id: 'a1', actor: 'Dana Okafor', action: 'submitted the RFI', at: at('2026-09-02') },
          { id: 'a2', actor: 'Jo Smith', action: 'responded', at: at('2026-09-05') },
          {
            id: 'a3',
            actor: 'Dana Okafor',
            action: 'closed the RFI with the official response',
            at: at('2026-09-06'),
          },
        ],
      }),
      seedRfi({
        id: 'rfi_002',
        number: 2,
        subject: 'Waterproofing membrane to amenities',
        question:
          'Spec 0421 calls for a liquid membrane; the architectural detail shows a sheet membrane. Please confirm which system applies.',
        status: 'answered',
        assigneeId: 'usr_arch',
        assigneeCompanyId: 'cmp_arch',
        ballInCourtId: 'usr_pm',
        ballInCourtCompanyId: 'cmp_builder',
        ballInCourtSince: at('2026-09-24'),
        dueDate: '2026-09-26',
        costImpact: 'yes',
        scheduleImpactDays: 2,
        specSection: '0421 Waterproofing',
        location: 'Ground, amenities',
        distributionCompanyIds: ['cmp_tile', 'cmp_plumb'],
        responses: [
          {
            id: 'rsp_2',
            authorId: 'usr_arch',
            authorName: 'Mei Lin',
            authorCompanyId: 'cmp_arch',
            body: 'Use the sheet membrane per detail 7/A-501. Spec 0421 will be updated.',
            isOfficial: false,
            aiSuggestionId: null,
            fileIds: [],
            createdAt: at('2026-09-24'),
          },
        ],
        answeredAt: at('2026-09-24'),
        activity: [
          { id: 'a1', actor: 'Dana Okafor', action: 'submitted the RFI', at: at('2026-09-19') },
          { id: 'a2', actor: 'Mei Lin', action: 'responded', at: at('2026-09-24') },
        ],
      }),
      seedRfi({
        id: 'rfi_003',
        number: 3,
        subject: 'Bin store door swing',
        question:
          'Rev C adds the bike store. The bin store door now swings into the bike store path. Can it be re-hung to swing out?',
        status: 'open',
        assigneeId: 'usr_arch',
        assigneeCompanyId: 'cmp_arch',
        ballInCourtId: 'usr_arch',
        ballInCourtCompanyId: 'cmp_arch',
        ballInCourtSince: at('2026-09-23'),
        dueDate: '2026-09-29',
        drawing: { sheetId: 'sht_a101', revisionId: 'rev_a101_c', label: 'A-101 Rev C' },
        location: 'Ground, bin store',
        fileIds: ['fil_binstore'],
        activity: [
          { id: 'a1', actor: 'Luca Romano', action: 'submitted the RFI', at: at('2026-09-23') },
        ],
      }),
      seedRfi({
        id: 'rfi_004',
        number: 4,
        subject: 'Lighting circuit in retail 2',
        question:
          'E-301 Rev A shows four downlights in retail 2 but the reflected ceiling plan shows six. Please confirm the quantity.',
        status: 'open',
        assigneeId: 'usr_elec',
        assigneeCompanyId: 'cmp_elec',
        ballInCourtId: 'usr_elec',
        ballInCourtCompanyId: 'cmp_elec',
        ballInCourtSince: at('2026-10-01'),
        dueDate: '2026-10-09',
        costImpact: 'tbc',
        drawing: { sheetId: 'sht_e301', revisionId: 'rev_e301_a', label: 'E-301 Rev A' },
        activity: [
          { id: 'a1', actor: 'Dana Okafor', action: 'submitted the RFI', at: at('2026-10-01') },
        ],
      }),
    ],
  };
}

const stores = projectStores<Store>(seed);

export interface RfiFilters {
  status?: RfiStatus | undefined;
  ballInCourtCompanyId?: string | undefined;
  impact?: 'yes' | undefined;
  overdueBefore?: string | undefined;
  q?: string | undefined;
}

function log(rfi: Rfi, actor: Actor, action: string, extra: Partial<Rfi['activity'][number]> = {}) {
  rfi.activity.push({ id: mockId('act'), actor: actor.name, action, at: nowIso(), ...extra });
}

function find(projectId: string, id: string): Rfi {
  const rfi = stores.get(projectId).rfis.find((r) => r.id === id);
  if (!rfi) problem(404, 'not_found', "We couldn't find that RFI.");
  return rfi;
}

function ensure(rfi: Rfi, action: RfiAction) {
  if (!canTransition(rfi.status, action))
    problem(
      409,
      `rfi.cannot_${action}`,
      `This RFI is ${rfi.status}, so it can't be ${action === 'submit' ? 'submitted' : `${action}ed`}.`,
    );
}

export const rfisSource = {
  async list(projectId: string, f: RfiFilters = {}): Promise<Rfi[]> {
    const q = f.q?.trim().toLowerCase();
    const rows = stores
      .get(projectId)
      .rfis.filter((r) => !f.status || r.status === f.status)
      .filter((r) => !f.ballInCourtCompanyId || r.ballInCourtCompanyId === f.ballInCourtCompanyId)
      .filter((r) => !f.impact || r.costImpact === 'yes')
      .filter(
        (r) =>
          !f.overdueBefore ||
          (r.status === 'open' && r.dueDate !== null && r.dueDate < f.overdueBefore),
      )
      .filter(
        (r) =>
          !q ||
          `${r.subject} ${r.question} RFI-${String(r.number ?? '').padStart(3, '0')}`
            .toLowerCase()
            .includes(q),
      );
    return delay(rows);
  },

  async get(projectId: string, id: string): Promise<Rfi> {
    return delay(find(projectId, id));
  },

  /** Creates a draft, or submits straight away when `submit` is set. */
  async create(projectId: string, input: RfiInput, actor: Actor, submit: boolean): Promise<Rfi> {
    const rfi: Rfi = {
      ...input,
      id: mockId('rfi'),
      number: null,
      status: 'draft',
      managerId: actor.id,
      assigneeCompanyId: personCompanyId(input.assigneeId),
      ballInCourtId: actor.id,
      ballInCourtCompanyId: actor.companyId,
      ballInCourtSince: null,
      receivedFromCompanyId: null,
      fileIds: [],
      responses: [],
      officialResponseId: null,
      activity: [],
      createdAt: nowIso(),
      answeredAt: null,
      closedAt: null,
    };
    log(rfi, actor, 'created a draft');
    stores.get(projectId).rfis.push(rfi);
    if (submit) return this.submit(projectId, rfi.id, actor);
    return delay(rfi);
  },

  async update(projectId: string, id: string, input: RfiInput, actor: Actor): Promise<Rfi> {
    const rfi = find(projectId, id);
    if (rfi.status === 'closed' || rfi.status === 'void')
      problem(409, 'rfi.locked', 'Closed and void RFIs can’t be edited.');
    if (rfi.dueDate !== input.dueDate && rfi.status !== 'draft') {
      log(rfi, actor, 'changed the due date', {
        before: rfi.dueDate ?? 'none',
        after: input.dueDate ?? 'none',
      });
    }
    if (rfi.assigneeId !== input.assigneeId && rfi.status !== 'draft') {
      log(rfi, actor, 'reassigned the RFI', {
        before: personName(rfi.assigneeId),
        after: personName(input.assigneeId),
      });
      if (rfi.status === 'open') {
        rfi.ballInCourtId = input.assigneeId;
        rfi.ballInCourtCompanyId = personCompanyId(input.assigneeId);
        rfi.ballInCourtSince = nowIso();
      }
    }
    Object.assign(rfi, input, { assigneeCompanyId: personCompanyId(input.assigneeId) });
    return delay(rfi);
  },

  /** Issues the next number (never reused, RFI-AC1) and hands the ball to the assignee. */
  async submit(projectId: string, id: string, actor: Actor): Promise<Rfi> {
    const s = stores.get(projectId);
    const rfi = find(projectId, id);
    ensure(rfi, 'submit');
    const errors = submitErrors(rfi);
    if (Object.keys(errors).length) {
      problem(422, 'validation', Object.values(errors)[0]!);
    }
    rfi.number = s.nextNumber++;
    rfi.status = 'open';
    rfi.ballInCourtId = rfi.assigneeId;
    rfi.ballInCourtCompanyId = rfi.assigneeCompanyId;
    rfi.ballInCourtSince = nowIso();
    log(rfi, actor, 'submitted the RFI', {
      detail: `Waiting on ${companyName(rfi.assigneeCompanyId)}`,
    });
    return delay(rfi);
  },

  async photos(projectId: string, rfi: Rfi): Promise<RfiPhoto[]> {
    const files = stores.get(projectId).photoFiles;
    const origins = new Map<string, RfiPhoto['origin']>();
    for (const id of rfi.fileIds) origins.set(id, 'question');
    for (const r of rfi.responses)
      for (const id of r.fileIds) origins.set(id, origins.get(id) ?? 'response');
    return delay(
      [...origins].flatMap(([fileId, origin]) =>
        files[fileId] ? [{ fileId, name: files[fileId].name, url: files[fileId].url, origin }] : [],
      ),
    );
  },

  async addPhoto(projectId: string, rfiId: string, photo: File): Promise<Rfi> {
    const s = stores.get(projectId);
    const rfi = find(projectId, rfiId);
    if (rfi.status === 'closed' || rfi.status === 'void')
      problem(409, 'rfi.locked', 'Closed and void RFIs can’t be edited.');
    const fileId = mockId('fil');
    s.photoFiles[fileId] = { name: photo.name, url: URL.createObjectURL(photo) };
    rfi.fileIds = [...rfi.fileIds, fileId];
    return delay(rfi);
  },

  async annotations(projectId: string, rfiId: string): Promise<RfiAnnotation[]> {
    find(projectId, rfiId);
    return delay(stores.get(projectId).annotations.filter((a) => a.id.startsWith(`${rfiId}:`)));
  },

  /** One layer per person per photo, replaced whole; an empty list removes it. */
  async saveAnnotation(
    projectId: string,
    rfiId: string,
    fileId: string,
    shapes: readonly MarkupShape[],
    actor: Actor,
  ): Promise<RfiAnnotation | null> {
    const s = stores.get(projectId);
    const rfi = find(projectId, rfiId);
    if (rfi.status === 'closed' || rfi.status === 'void')
      problem(409, 'rfi.locked', 'Closed and void RFIs can’t be marked up.');
    const id = `${rfiId}:${fileId}:${actor.id}`;
    s.annotations = s.annotations.filter((a) => a.id !== id);
    if (shapes.length === 0) return delay(null);
    const layer: RfiAnnotation = {
      id,
      fileId,
      authorId: actor.id,
      authorName: actor.name,
      shapes: [...shapes],
      updatedAt: nowIso(),
    };
    s.annotations.push(layer);
    return delay(layer);
  },

  /** A response moves the RFI to Answered and the ball back to the RFI manager (RFI-AC4). */
  async respond(
    projectId: string,
    id: string,
    input: { body: string; aiSuggestionId: string | null },
    actor: Actor,
  ): Promise<Rfi> {
    const rfi = find(projectId, id);
    ensure(rfi, 'respond');
    if (!input.body.trim()) problem(422, 'validation', 'Write a response.');
    rfi.responses.push({
      id: mockId('rsp'),
      authorId: actor.id,
      authorName: actor.name,
      authorCompanyId: actor.companyId,
      body: input.body.trim(),
      isOfficial: false,
      aiSuggestionId: input.aiSuggestionId,
      fileIds: [],
      createdAt: nowIso(),
    });
    if (rfi.status === 'open') {
      rfi.status = 'answered';
      rfi.answeredAt = nowIso();
      rfi.ballInCourtId = rfi.managerId;
      rfi.ballInCourtCompanyId = personCompanyId(rfi.managerId) ?? 'cmp_builder';
      rfi.ballInCourtSince = nowIso();
    }
    log(rfi, actor, input.aiSuggestionId ? 'responded (started from a Nova draft)' : 'responded');
    return delay(rfi);
  },

  /** Close with exactly one official response (RFI-AC7). */
  async close(
    projectId: string,
    id: string,
    officialResponseId: string,
    actor: Actor,
  ): Promise<Rfi> {
    const rfi = find(projectId, id);
    ensure(rfi, 'close');
    if (!rfi.responses.some((r) => r.id === officialResponseId))
      problem(422, 'rfi.official_response_required', 'Choose the official response.');
    for (const r of rfi.responses) r.isOfficial = r.id === officialResponseId;
    rfi.officialResponseId = officialResponseId;
    rfi.status = 'closed';
    rfi.closedAt = nowIso();
    rfi.ballInCourtId = null;
    rfi.ballInCourtCompanyId = null;
    rfi.ballInCourtSince = null;
    log(rfi, actor, 'closed the RFI with the official response');
    return delay(rfi);
  },

  async reopen(projectId: string, id: string, reason: string, actor: Actor): Promise<Rfi> {
    const rfi = find(projectId, id);
    ensure(rfi, 'reopen');
    if (!reason.trim()) problem(422, 'validation', 'Give a reason for reopening.');
    rfi.status = 'open';
    rfi.closedAt = null;
    rfi.officialResponseId = null;
    for (const r of rfi.responses) r.isOfficial = false;
    rfi.ballInCourtId = rfi.assigneeId;
    rfi.ballInCourtCompanyId = rfi.assigneeCompanyId;
    rfi.ballInCourtSince = nowIso();
    log(rfi, actor, 'reopened the RFI', { detail: reason.trim() });
    return delay(rfi);
  },

  async void(projectId: string, id: string, reason: string, actor: Actor): Promise<Rfi> {
    const rfi = find(projectId, id);
    ensure(rfi, 'void');
    if (!reason.trim()) problem(422, 'validation', 'Give a reason for voiding.');
    rfi.status = 'void';
    rfi.ballInCourtId = null;
    rfi.ballInCourtCompanyId = null;
    rfi.ballInCourtSince = null;
    log(rfi, actor, 'voided the RFI', { detail: reason.trim() });
    return delay(rfi);
  },

  // ---- Nova (preview): canned suggestions. Production: POST {p}/rfis/{id}/ai-draft and the ai module. ----

  async novaDraftResponse(projectId: string, id: string, direction?: string): Promise<NovaDraft> {
    const rfi = find(projectId, id);
    const references: NovaReference[] = [
      ...(rfi.drawing
        ? [
            {
              id: 'c_dwg',
              kind: 'drawing' as const,
              sourceId: rfi.drawing.sheetId,
              revisionId: rfi.drawing.revisionId,
              label: rfi.drawing.label,
              quote: 'Sheet membrane to detail 7.',
            },
          ]
        : []),
      ...(rfi.specSection
        ? [
            {
              id: 'c_spec',
              kind: 'document' as const,
              sourceId: 'doc_spec',
              revisionId: 'docrev_spec',
              label: `Spec ${rfi.specSection}`,
              quote: 'Install to manufacturer’s written instructions.',
            },
          ]
        : []),
    ];
    const told = direction?.trim();
    return delay(
      {
        id: mockId('ais'),
        text: told
          ? `${told.charAt(0).toUpperCase()}${told.slice(1)}${/[.!?]$/.test(told) ? '' : '.'} Please confirm on site before installation.`
          : rfi.drawing
            ? `Based on ${rfi.drawing.label}, the arrangement shown on the current revision governs. Please proceed as drawn and confirm on site before installation.`
            : 'I couldn’t find a drawing or specification clause that answers this. Please answer from your own records.',
        basis: references.length ? 'documents' : told ? 'direction' : 'none',
        needsDecision: references.length ? [] : ['Whether the work changes scope or time.'],
        references,
        unsupportedNumbers: [],
        unreadFiles: [],
      },
      400,
    );
  },

  async novaDraftRfi(_projectId: string, source: NovaRfiSource): Promise<NovaRfiDraft> {
    const text =
      source.note.trim().replace(/\s+/g, ' ') ||
      (source.photo
        ? 'the condition in the attached photo.'
        : 'the marked-up area of the drawing.');
    return delay(
      {
        suggestionId: mockId('ais'),
        subject: text.split(/[.!?]/)[0]!.slice(0, 80) || 'Site query',
        question: `On site we found: ${text} Please confirm how this should be built and say whether it changes scope or time.`,
        discipline: null,
        references: [],
        gaps: source.markup ? ['proposed_solution'] : ['location', 'proposed_solution'],
        unsupportedNumbers: [],
        similar: [],
        drawing: null,
      },
      400,
    );
  },

  async novaDecide(
    _projectId: string,
    _suggestionId: string,
    _decision: 'accepted' | 'edited' | 'rejected',
  ) {},

  async novaImproveQuestion(text: string): Promise<NovaWording> {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    const sentence = trimmed.endsWith('?') ? trimmed : `${trimmed.replace(/[.]$/, '')}?`;
    return delay(
      {
        id: mockId('ais'),
        text: `Please confirm: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)} If this changes scope or time, please say so in your answer.`,
      },
      400,
    );
  },

  /** "Similar RFIs" before submit (RFI-US3): word overlap on the subject in the preview. */
  async novaSimilar(
    projectId: string,
    subject: string,
  ): Promise<Array<Pick<Rfi, 'id' | 'number' | 'subject' | 'status'>>> {
    const words = new Set(
      subject
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3),
    );
    if (!words.size) return delay([]);
    const hits = stores
      .get(projectId)
      .rfis.filter(
        (r) =>
          r.number !== null &&
          r.subject
            .toLowerCase()
            .split(/\W+/)
            .some((w) => words.has(w)),
      )
      .map(({ id, number, subject: s, status }) => ({ id, number, subject: s, status }));
    return delay(hits);
  },
};

export type RfisSource = typeof rfisSource;

export function resetRfisPreview() {
  stores.reset();
}
