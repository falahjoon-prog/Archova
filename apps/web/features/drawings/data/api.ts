// Drawings against the documents and ai modules (backend 04 §3, ai/01 F1), with the same interface as the preview
// source in `source.ts`. Each call maps the contract's records onto the screen's types in `lib/types.ts`.
//
// Not in the API yet, so absent here: sheet geometry and scale confirmation (measure and count stay off on these
// sheets) and per-field "checked" state while a set is in review, which is kept for the session in this module.

import { ApiError, unwrap } from '@archova/api-client';
import type {
  AiSuggestion,
  DrawingRevision as ApiRevision,
  DrawingSheet as ApiSheet,
  Markup as ApiMarkup,
  MarkupShape as ApiShape,
  PublishConflict,
} from '@archova/contracts';
import type { MarkupShape } from '@archova/markup';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { uploadFile } from '@/shared/lib/uploads';
import type {
  DrawingMarkup,
  DrawingPin,
  DrawingRevision,
  DrawingSet,
  DrawingSheet,
  ReadField,
  ReviewSheet,
  SheetConflict,
} from '../lib/types';
import { compareRevs, publishBlockers, type DrawingsSource } from './source';

const TITLEBLOCK_TASK = 'drawing.titleblock';

/** Nova's discipline words and the register's codes (DISCIPLINES). */
const DISCIPLINE_CODES: Record<string, string> = {
  architectural: 'A',
  structural: 'S',
  mechanical: 'M',
  electrical: 'E',
  hydraulic: 'HY',
  fire: 'F',
  civil: 'C',
  landscape: 'L',
};
const DISCIPLINE_WORDS = Object.fromEntries(
  Object.entries(DISCIPLINE_CODES).map(([word, code]) => [code, word]),
);

const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

// ---- Mapping ----

export function toSheet(s: ApiSheet): DrawingSheet {
  const cr = s.currentRevision;
  return {
    id: s.id,
    sheetNumber: s.sheetNumber,
    title: s.title,
    discipline: s.discipline,
    area: s.area,
    currentRevisionId: cr?.id ?? '',
    currentRev: cr?.rev ?? '—',
    currentIssuedFor: cr?.issuedFor ?? null,
    currentDrawingDate: cr?.drawingDate ?? null,
    revisionCount: null,
  };
}

export function toRevision(r: ApiRevision): DrawingRevision {
  return {
    id: r.id,
    sheetId: r.sheetId ?? '',
    setId: r.setId,
    rev: r.rev,
    status: r.status === 'superseded' ? 'superseded' : 'current',
    issuedFor: r.issuedFor,
    drawingDate: r.drawingDate,
    supersededAt: r.supersededBy?.at ?? null,
    supersededByRevisionId: r.supersededBy?.revisionId ?? null,
    supersededByRev: r.supersededBy?.rev ?? null,
    widthMm: null,
    heightMm: null,
    fileId: r.fileId,
    pageIndex: r.pageIndex,
    createdAt: r.publishedAt ?? '',
  };
}

/** The API shape for one of ours: the same fields plus the shape's own id. */
export function toApiShape(shape: MarkupShape, id: string): ApiShape {
  return { id, ...shape };
}

/** Ours from the API's, or null for a shape missing the fields its kind needs. */
export function fromApiShape(s: ApiShape): MarkupShape | null {
  switch (s.kind) {
    case 'pen':
      return s.points ? { kind: 'pen', points: s.points } : null;
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
    case 'cloud':
      return s.from && s.to ? { kind: s.kind, from: s.from, to: s.to } : null;
    case 'text':
      return s.at ? { kind: 'text', at: s.at, text: s.text ?? '' } : null;
    case 'pin':
      return s.at && s.entityType && s.entityId
        ? { kind: 'pin', at: s.at, entityType: s.entityType, entityId: s.entityId }
        : null;
  }
}

/** One row per shape, as the viewer lists them; the id carries the markup and shape so actions find both. */
export function toMarkups(m: ApiMarkup, viewer: { id: string; name: string }): DrawingMarkup[] {
  return m.shapes.flatMap((s) => {
    const shape = fromApiShape(s);
    if (!shape || shape.kind === 'pin') return [];
    return [
      {
        id: `${m.id}~${s.id}`,
        revisionId: m.revisionId,
        ownerId: m.ownerId,
        ownerName: m.ownerId === viewer.id ? viewer.name : null,
        ownerCompanyId: m.ownerCompanyId,
        visibility: m.visibility,
        shape,
        createdAt: m.createdAt,
        copiedFromId: m.copiedFromId,
        version: m.version,
      },
    ];
  });
}

/** Pins are markups pointing at a record (RFI, defect); the label is what the pin was placed with. */
export function toPins(m: ApiMarkup): DrawingPin[] {
  return m.shapes.flatMap((s) => {
    if (s.kind !== 'pin' || !s.at || !s.entityId) return [];
    if (s.entityType !== 'rfi' && s.entityType !== 'defect') return [];
    return [
      {
        id: `${m.id}~${s.id}`,
        entityType: s.entityType,
        entityId: s.entityId,
        label: s.text ?? s.entityId,
        title: s.text ?? '',
        status: '',
        x: s.at.x,
        y: s.at.y,
        checkLocation: m.needsLocationCheck,
        markupId: m.id,
        version: m.version,
      },
    ];
  });
}

const CONFLICT_KINDS: Record<PublishConflict['kind'], SheetConflict> = {
  new_sheet: 'new_sheet',
  revision_exists: 'same_revision_exists',
  older_than_current: 'older_revision',
  duplicate_in_set: 'duplicate_in_set',
};

/** What Nova read for each field, from a `drawing.titleblock` suggestion's payload. */
interface TitleBlockPayload {
  fileId: string;
  page: number;
  isDrawing: boolean;
  fields: Record<
    'number' | 'title' | 'revision' | 'discipline' | 'revisionDate' | 'scale',
    { value: string | null; confidence: number; flagged: boolean }
  >;
}

const FIELD_KEYS = {
  sheetNumber: 'number',
  title: 'title',
  rev: 'revision',
  discipline: 'discipline',
} as const;
type FieldKey = keyof typeof FIELD_KEYS;

/** Session state for a set in review: fields a person has checked, and reasons for older revisions. */
const checked = new Map<string, Set<FieldKey>>();
const reasons = new Map<string, string>();

export function toReviewSheet(
  r: ApiRevision,
  fileName: string,
  conflict: PublishConflict | undefined,
  suggestion: AiSuggestion | undefined,
): ReviewSheet {
  const payload = suggestion?.payload as TitleBlockPayload | undefined;
  // A decided suggestion was checked in an earlier session; without one (a scan), every field needs a look.
  const decided = suggestion !== undefined && suggestion.status !== 'pending';
  const field = (key: FieldKey, value: string): ReadField => {
    const read = payload?.fields[FIELD_KEYS[key]];
    return {
      value,
      confidence: read?.confidence ?? 0,
      flagged: read ? read.flagged : true,
      touched: decided || (checked.get(r.id)?.has(key) ?? false),
    };
  };
  return {
    id: r.id,
    fileName,
    pageIndex: r.pageIndex,
    sheetNumber: field('sheetNumber', r.sheetNumber),
    title: field('title', r.title),
    rev: field('rev', r.rev),
    discipline: field('discipline', r.discipline ?? ''),
    conflict: conflict ? CONFLICT_KINDS[conflict.kind] : 'none',
    reason: reasons.get(r.id) ?? '',
    version: r.version,
    suggestionId: suggestion?.id ?? null,
  };
}

/** Runs `fn` over `items` a few at a time. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---- Source ----

export function createDrawingsApi(orgId: string): DrawingsSource {
  const listApiMarkups = async (projectId: string, revisionId: string) =>
    unwrap(
      await api.GET(
        '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/markups',
        { params: { path: { orgId, projectId, drawingRevisionId: revisionId } } },
      ),
    ).data;

  const sheetRevisions = async (projectId: string, sheetId: string) =>
    unwrap(
      await api.GET('/v1/orgs/{orgId}/projects/{projectId}/drawings/{drawingSheetId}/revisions', {
        params: { path: { orgId, projectId, drawingSheetId: sheetId } },
      }),
    ).data;

  const fileNames = async (fileIds: string[]) => {
    const unique = [...new Set(fileIds)];
    const names = await mapLimit(unique, 6, async (fileId) => {
      const res = await api.GET('/v1/orgs/{orgId}/files/{fileId}', {
        params: { path: { orgId, fileId } },
      });
      return res.data?.filename ?? 'Drawing file';
    });
    return new Map(unique.map((id, i) => [id, names[i]!]));
  };

  const titleBlockSuggestions = (projectId: string) =>
    allPages(async (cursor) =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/ai/suggestions', {
          params: {
            path: { orgId, projectId },
            query: { task: TITLEBLOCK_TASK, limit: 200, ...(cursor ? { cursor } : {}) },
          },
        }),
      ),
    );

  const source: DrawingsSource = {
    async listSheets(projectId, filters = {}) {
      const sheets = await allPages(async (cursor) =>
        unwrap(
          await api.GET('/v1/orgs/{orgId}/projects/{projectId}/drawings', {
            params: {
              path: { orgId, projectId },
              query: {
                limit: 200,
                ...(filters.discipline ? { discipline: filters.discipline } : {}),
                ...(filters.issuedFor ? { issuedFor: filters.issuedFor } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
          }),
        ),
      );
      const q = filters.q?.trim().toLowerCase();
      return sheets
        .map(toSheet)
        .filter((s) => !q || `${s.sheetNumber} ${s.title}`.toLowerCase().includes(q))
        .sort((a, b) => a.sheetNumber.localeCompare(b.sheetNumber, 'en-AU', { numeric: true }));
    },

    async listAllRevisions(projectId) {
      const sheets = await source.listSheets(projectId);
      const perSheet = await mapLimit(sheets, 6, async (sheet) =>
        (await sheetRevisions(projectId, sheet.id)).map((r) => ({
          ...toRevision(r),
          sheetNumber: r.sheetNumber,
          title: r.title,
        })),
      );
      return perSheet.flat();
    },

    async getSheet(projectId, sheetId) {
      const revs = (await sheetRevisions(projectId, sheetId)).filter((r) => r.status !== 'draft');
      const current = revs.find((r) => r.status === 'current') ?? revs[0];
      if (!current) throw new ApiError(404, null);
      return {
        sheet: {
          id: sheetId,
          sheetNumber: current.sheetNumber,
          title: current.title,
          discipline: current.discipline,
          area: null,
          currentRevisionId: current.id,
          currentRev: current.rev,
          currentIssuedFor: current.issuedFor,
          currentDrawingDate: current.drawingDate,
          revisionCount: revs.length,
        },
        revisions: revs.map(toRevision).sort((a, b) => compareRevs(b.rev, a.rev)),
      };
    },

    async getGeometry() {
      return null;
    },

    async confirmScale() {
      throw new ApiError(501, {
        type: 'about:blank',
        title: 'Not available yet',
        status: 501,
        detail: "Setting the scale needs the sheet geometry service, which isn't connected yet.",
        code: 'not_available',
      } as never);
    },

    async listPins(projectId, revisionId) {
      return (await listApiMarkups(projectId, revisionId)).flatMap(toPins);
    },

    async confirmPinLocation(projectId, revisionId, pinId) {
      const markupId = pinId.split('~')[0]!;
      const markup = (await listApiMarkups(projectId, revisionId)).find((m) => m.id === markupId);
      if (!markup) return;
      await ensureCsrfToken();
      unwrap(
        await api.PATCH(
          '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/markups/{markupId}',
          {
            params: {
              path: { orgId, projectId, drawingRevisionId: revisionId, markupId },
              header: ifMatch(markup.version),
            },
            body: { locationConfirmed: true },
          },
        ),
      );
    },

    async listMarkups(projectId, revisionId, viewer) {
      return (await listApiMarkups(projectId, revisionId)).flatMap((m) => toMarkups(m, viewer));
    },

    async createMarkup(projectId, revisionId, input, actor) {
      await ensureCsrfToken();
      const created = unwrap(
        await api.POST(
          '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/markups',
          {
            params: { path: { orgId, projectId, drawingRevisionId: revisionId } },
            body: { visibility: input.visibility, shapes: [toApiShape(input.shape, 's1')] },
          },
        ),
      );
      return toMarkups(created, actor)[0]!;
    },

    async setMarkupVisibility(projectId, revisionId, markupId, visibility, actor) {
      const [id] = markupId.split('~');
      const markup = await findMarkup(projectId, revisionId, id!);
      await ensureCsrfToken();
      const updated = unwrap(
        await api.PATCH(
          '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/markups/{markupId}',
          {
            params: {
              path: { orgId, projectId, drawingRevisionId: markup.revisionId, markupId: id! },
              header: ifMatch(markup.version),
            },
            body: { visibility },
          },
        ),
      );
      const rows = toMarkups(updated, actor);
      return rows.find((m) => m.id === markupId) ?? rows[0]!;
    },

    async deleteMarkup(projectId, revisionId, markupId) {
      const [id] = markupId.split('~');
      const markup = await findMarkup(projectId, revisionId, id!);
      await ensureCsrfToken();
      unwrap(
        await api.DELETE(
          '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/markups/{markupId}',
          {
            params: {
              path: { orgId, projectId, drawingRevisionId: markup.revisionId, markupId: id! },
              header: ifMatch(markup.version),
            },
          },
        ),
      );
    },

    // ---- Upload, review and publish a drawing set (F1.2, DOC-AC2 to AC4) ----

    async createSet(projectId, input) {
      await ensureCsrfToken();
      const set = unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/drawing-sets', {
          params: { path: { orgId, projectId } },
          body: { name: input.name },
        }),
      );
      for (const file of input.files) {
        const stored = await uploadFile(orgId, { file, projectId, module: 'documents' });
        await ensureCsrfToken();
        // Nova reads every sheet's title block; nothing goes in the register until the set is published.
        const read = unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/drawing-register/extractions', {
            params: { path: { orgId, projectId } },
            body: { fileId: stored.id },
          }),
        );
        const sheets = read.suggestions
          .map((s) => s.payload as unknown as TitleBlockPayload)
          .filter((p) => p.isDrawing)
          .map((p) => ({ page: p.page, fields: p.fields }));
        // Scanned pages Nova couldn't read still go in the set, for a person to fill in.
        for (const page of read.skippedPages) sheets.push({ page, fields: undefined as never });
        for (const sheet of sheets.sort((a, b) => a.page - b.page)) {
          const f = sheet.fields;
          const discipline = f?.discipline.value ? DISCIPLINE_CODES[f.discipline.value] : undefined;
          const date = f?.revisionDate.value;
          await ensureCsrfToken();
          unwrap(
            await api.POST(
              '/v1/orgs/{orgId}/projects/{projectId}/drawing-sets/{drawingSetId}/revisions',
              {
                params: { path: { orgId, projectId, drawingSetId: set.id } },
                body: {
                  sheetNumber: f?.number.value || `Page ${sheet.page}`,
                  title: f?.title.value || 'Untitled sheet',
                  rev: f?.revision.value || '?',
                  ...(discipline ? { discipline } : {}),
                  issuedFor: input.issuedFor,
                  fileId: stored.id,
                  pageIndex: sheet.page - 1,
                  ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { drawingDate: date } : {}),
                },
              },
            ),
          );
        }
      }
      return source.getSet(projectId, set.id);
    },

    async getSet(projectId, setId) {
      const review = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/drawing-sets/{drawingSetId}/review', {
          params: { path: { orgId, projectId, drawingSetId: setId } },
        }),
      );
      const fileIds = review.revisions.map((r) => r.fileId);
      const [names, suggestions] = await Promise.all([
        fileNames(fileIds),
        titleBlockSuggestions(projectId),
      ]);
      const suggestionFor = (r: ApiRevision) =>
        suggestions.find((s) => {
          const p = s.payload as unknown as TitleBlockPayload;
          return p.fileId === r.fileId && p.page === r.pageIndex + 1;
        });
      const sheets = review.revisions
        .slice()
        .sort((a, b) => (a.fileId === b.fileId ? a.pageIndex - b.pageIndex : 0))
        .map((r) =>
          toReviewSheet(
            r,
            names.get(r.fileId) ?? 'Drawing file',
            review.conflicts.find((c) => c.revisionId === r.id),
            suggestionFor(r),
          ),
        );
      return {
        id: review.set.id,
        name: review.set.name,
        status: review.set.status,
        issuedFor: review.revisions[0]?.issuedFor ?? null,
        sheets,
        createdAt: review.set.createdAt,
      } satisfies DrawingSet;
    },

    async updateReviewSheet(projectId, setId, sheetId, patch) {
      if (patch.reason !== undefined) reasons.set(sheetId, patch.reason);
      const keys = (Object.keys(FIELD_KEYS) as FieldKey[]).filter((k) => patch[k] !== undefined);
      if (keys.length) {
        const touched = checked.get(sheetId) ?? new Set<FieldKey>();
        for (const k of keys) touched.add(k);
        checked.set(sheetId, touched);
        const row = (await source.getSet(projectId, setId)).sheets.find((s) => s.id === sheetId);
        const body: Record<string, string | null> = {};
        for (const k of keys) {
          const value = patch[k]!.trim();
          if (row && value !== row[k].value) body[k] = k === 'discipline' ? value || null : value;
        }
        if (row?.version !== undefined && Object.keys(body).length) {
          await ensureCsrfToken();
          unwrap(
            await api.PATCH(
              '/v1/orgs/{orgId}/projects/{projectId}/drawing-sets/{drawingSetId}/revisions/{drawingRevisionId}',
              {
                params: {
                  path: { orgId, projectId, drawingSetId: setId, drawingRevisionId: sheetId },
                  header: ifMatch(row.version),
                },
                body,
              },
            ),
          );
        }
      }
      return source.getSet(projectId, setId);
    },

    async publishSet(projectId, setId) {
      const set = await source.getSet(projectId, setId);
      const blocking = publishBlockers(set);
      if (blocking.length) {
        throw new ApiError(422, {
          type: 'about:blank',
          title: blocking[0]!,
          status: 422,
          detail: blocking[0]!,
          code: 'drawing_set.not_ready',
        } as never);
      }
      // Record what people did with Nova's reading of each sheet (ai/04 §7): accepted as read, or edited.
      const suggestions = await titleBlockSuggestions(projectId);
      for (const sheet of set.sheets) {
        const suggestion = suggestions.find((x) => x.id === sheet.suggestionId);
        if (suggestion?.status === 'pending') await decideSheet(projectId, sheet, suggestion);
      }
      await ensureCsrfToken();
      unwrap(
        await api.POST(
          '/v1/orgs/{orgId}/projects/{projectId}/drawing-sets/{drawingSetId}/publish',
          {
            params: { path: { orgId, projectId, drawingSetId: setId } },
            body: {
              confirmNewSheets: true,
              reasons: set.sheets
                .filter((s) => s.conflict === 'older_revision')
                .map((s) => ({ revisionId: s.id, reason: s.reason.trim() })),
            },
          },
        ),
      );
      for (const sheet of set.sheets) {
        checked.delete(sheet.id);
        reasons.delete(sheet.id);
      }
      return { published: set.sheets.length };
    },
  };

  /** Reads the markup fresh for its version, so a stale tab gets a clean conflict rather than a lost update. */
  async function findMarkup(
    projectId: string,
    revisionId: string,
    markupId: string,
  ): Promise<ApiMarkup> {
    const found = (await listApiMarkups(projectId, revisionId)).find((m) => m.id === markupId);
    if (!found) throw new ApiError(404, null);
    return found;
  }

  async function decideSheet(projectId: string, sheet: ReviewSheet, suggestion: AiSuggestion) {
    const read = (suggestion.payload as unknown as TitleBlockPayload).fields;
    const fields = {
      number: sheet.sheetNumber.value,
      title: sheet.title.value,
      revision: sheet.rev.value,
      discipline:
        DISCIPLINE_WORDS[sheet.discipline.value] ?? (sheet.discipline.value ? 'other' : null),
    };
    const edited =
      fields.number !== read.number.value ||
      fields.title !== read.title.value ||
      fields.revision !== read.revision.value ||
      fields.discipline !== read.discipline.value;
    await ensureCsrfToken();
    unwrap(
      await api.POST(
        '/v1/orgs/{orgId}/projects/{projectId}/ai/suggestions/{suggestionId}/decision',
        {
          params: { path: { orgId, projectId, suggestionId: suggestion.id } },
          body: edited ? { decision: 'edited', fields: fields as never } : { decision: 'accepted' },
        },
      ),
    );
  }

  return source;
}
