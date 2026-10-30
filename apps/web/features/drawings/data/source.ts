// Drawings data source, preview edition: an in-memory store behind the same interface as the API source in
// `api.ts` (one method per screen need). `useDrawingsSource` picks one (shared/lib/data-mode). The preview also has
// what the API doesn't yet: sheet geometry and scale for measuring, and drawn sheet artwork instead of PDFs.

import type { MarkupShape, MarkupVisibility } from '@archova/markup';
import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import { buildArtwork, type SheetArtwork } from '../lib/artwork';
import {
  needsCheck,
  type Discipline,
  type DrawingMarkup,
  type DrawingPin,
  type DrawingRevision,
  type DrawingSet,
  type DrawingSheet,
  type IssuedFor,
  type ReadField,
  type ReviewSheet,
  type SheetConflict,
  type SheetGeometry,
} from '../lib/types';
import { seedDrawings, type DrawingsStore } from './seed';

const stores = projectStores<DrawingsStore>(() => seedDrawings());

export interface DrawingFilters {
  discipline?: Discipline | undefined;
  issuedFor?: IssuedFor | undefined;
  q?: string | undefined;
}

export interface SheetDetail {
  sheet: DrawingSheet;
  revisions: DrawingRevision[];
}

export interface NewDrawingSetInput {
  name: string;
  issuedFor: IssuedFor;
  files: File[];
}

export type ReviewSheetPatch = Partial<
  Record<'sheetNumber' | 'title' | 'rev' | 'discipline', string>
> & { reason?: string };

export interface Actor {
  id: string;
  name: string;
}

/** Compares revision labels for "goes backwards" checks: numbers after letters (P1/A < 0 < 1). */
export function compareRevs(a: string, b: string): number {
  const rank = (r: string) =>
    /^\d+$/.test(r)
      ? 1000 + Number(r)
      : /^[A-Z]$/.test(r)
        ? r.charCodeAt(0)
        : /^P(\d+)$/.test(r)
          ? Number(r.slice(1))
          : 500;
  return rank(a) - rank(b);
}

function toSheet(s: DrawingsStore, row: DrawingsStore['sheets'][number]): DrawingSheet {
  const revs = s.revisions.filter((r) => r.sheetId === row.id);
  const current = revs.find((r) => r.status === 'current') ?? revs[revs.length - 1]!;
  return {
    ...row,
    currentRevisionId: current.id,
    currentRev: current.rev,
    currentIssuedFor: current.issuedFor,
    currentDrawingDate: current.drawingDate,
    revisionCount: revs.length,
  };
}

export type DrawingsSource = Omit<typeof drawingsSource, 'artwork'>;

export const drawingsSource = {
  async listSheets(projectId: string, filters: DrawingFilters = {}): Promise<DrawingSheet[]> {
    const s = stores.get(projectId);
    const q = filters.q?.trim().toLowerCase();
    const rows = s.sheets
      .map((row) => toSheet(s, row))
      .filter((sheet) => !filters.discipline || sheet.discipline === filters.discipline)
      .filter((sheet) => !filters.issuedFor || sheet.currentIssuedFor === filters.issuedFor)
      .filter((sheet) => !q || `${sheet.sheetNumber} ${sheet.title}`.toLowerCase().includes(q))
      .sort((a, b) => a.sheetNumber.localeCompare(b.sheetNumber, 'en-AU', { numeric: true }));
    return delay(rows);
  },

  /** Every revision in the register when "show all revisions" is on (DOC-AC5). */
  async listAllRevisions(
    projectId: string,
  ): Promise<Array<DrawingRevision & { sheetNumber: string; title: string }>> {
    const s = stores.get(projectId);
    return delay(
      s.revisions.map((r) => {
        const sheet = s.sheets.find((x) => x.id === r.sheetId)!;
        return { ...r, sheetNumber: sheet.sheetNumber, title: sheet.title };
      }),
    );
  },

  async getSheet(projectId: string, sheetId: string): Promise<SheetDetail> {
    const s = stores.get(projectId);
    const row = s.sheets.find((x) => x.id === sheetId);
    if (!row) problem(404, 'not_found', "We couldn't find that drawing.");
    return delay({
      sheet: toSheet(s, row),
      revisions: s.revisions
        .filter((r) => r.sheetId === sheetId)
        .sort((a, b) => compareRevs(b.rev, a.rev)),
    });
  },

  /** Preview only: the sheet artwork. Production renders the revision's PDF page instead. */
  artwork(projectId: string, revisionId: string): SheetArtwork | null {
    const spec = stores.get(projectId).artwork.get(revisionId);
    return spec ? buildArtwork(spec) : null;
  },

  async getGeometry(projectId: string, revisionId: string): Promise<SheetGeometry | null> {
    return delay(stores.get(projectId).geometry.get(revisionId) ?? null);
  },

  async confirmScale(
    projectId: string,
    revisionId: string,
    scale: string,
    actor: Actor,
  ): Promise<SheetGeometry> {
    const g = stores.get(projectId).geometry.get(revisionId);
    if (!g) problem(404, 'not_found', 'This sheet has no geometry yet.');
    g.scaleConfirmed = scale;
    g.scaleConfirmedBy = actor.name;
    g.scaleConfirmedAt = nowIso();
    g.scaleConflict = null;
    return delay(g);
  },

  async listPins(projectId: string, revisionId: string): Promise<DrawingPin[]> {
    return delay(stores.get(projectId).pins.get(revisionId) ?? []);
  },

  async movePin(
    projectId: string,
    revisionId: string,
    pin: DrawingPin,
    at: { x: number; y: number },
  ): Promise<void> {
    const found = stores
      .get(projectId)
      .pins.get(revisionId)
      ?.find((p) => p.id === pin.id);
    if (found) Object.assign(found, { x: at.x, y: at.y, checkLocation: false });
    return delay(undefined);
  },

  async confirmPinLocation(projectId: string, revisionId: string, pinId: string): Promise<void> {
    const pin = stores
      .get(projectId)
      .pins.get(revisionId)
      ?.find((p) => p.id === pinId);
    if (pin) pin.checkLocation = false;
    return delay(undefined);
  },

  /** Markups visible to the caller: their own private ones, their company's, and published ones (X12). */
  async listMarkups(
    projectId: string,
    revisionId: string,
    viewer: Actor & { companyId: string | null },
  ): Promise<DrawingMarkup[]> {
    const rows = stores
      .get(projectId)
      .markups.filter((m) => m.revisionId === revisionId)
      .filter(
        (m) =>
          m.visibility === 'project' ||
          m.ownerId === viewer.id ||
          (m.visibility === 'company' &&
            m.ownerCompanyId !== null &&
            m.ownerCompanyId === viewer.companyId),
      );
    return delay(rows);
  },

  async createMarkup(
    projectId: string,
    revisionId: string,
    input: { shape: MarkupShape; visibility: MarkupVisibility },
    actor: Actor & { companyId: string | null },
  ): Promise<DrawingMarkup> {
    const markup: DrawingMarkup = {
      id: mockId('mku'),
      revisionId,
      ownerId: actor.id,
      ownerName: actor.name,
      ownerCompanyId: actor.companyId,
      visibility: input.visibility,
      shape: input.shape,
      createdAt: nowIso(),
      copiedFromId: null,
      version: null,
    };
    stores.get(projectId).markups.push(markup);
    return delay(markup);
  },

  async setMarkupVisibility(
    projectId: string,
    _revisionId: string,
    markupId: string,
    visibility: MarkupVisibility,
    actor: Actor,
  ): Promise<DrawingMarkup> {
    const m = stores.get(projectId).markups.find((x) => x.id === markupId);
    if (!m) problem(404, 'not_found', "We couldn't find that markup.");
    if (m.ownerId !== actor.id)
      problem(403, 'forbidden', 'Only the author can change who sees a markup.');
    m.visibility = visibility;
    return delay(m);
  },

  async deleteMarkup(
    projectId: string,
    _revisionId: string,
    markupId: string,
    actor: Actor,
  ): Promise<void> {
    const s = stores.get(projectId);
    const m = s.markups.find((x) => x.id === markupId);
    if (m && m.ownerId !== actor.id)
      problem(403, 'forbidden', 'Only the author can delete a markup.');
    if (m?.visibility === 'project')
      problem(
        409,
        'markup.published',
        'Published markups are part of the record and can’t be deleted.',
      );
    s.markups = s.markups.filter((x) => x.id !== markupId);
    return delay(undefined);
  },

  // ---- Upload, review and publish a drawing set (F1.2, DOC-AC2 to AC4) ----

  /**
   * POST {p}/drawing-sets: in production files go through presigned uploads first and the worker splits sheets and
   * reads title blocks. The preview "reads" each file name as one sheet, with deliberately mixed confidence.
   */
  async createSet(projectId: string, input: NewDrawingSetInput): Promise<DrawingSet> {
    const s = stores.get(projectId);
    const sheets: ReviewSheet[] = input.files.map((file, i) => readTitleBlock(s, file.name, i));
    const set: DrawingSet = {
      id: mockId('dst'),
      name: input.name,
      status: 'review',
      issuedFor: input.issuedFor,
      sheets,
      createdAt: nowIso(),
    };
    s.sets.push(set);
    return delay(set);
  },

  async getSet(projectId: string, setId: string): Promise<DrawingSet> {
    const set = stores.get(projectId).sets.find((x) => x.id === setId);
    if (!set) problem(404, 'not_found', "We couldn't find that drawing set.");
    return delay(set);
  },

  async updateReviewSheet(
    projectId: string,
    setId: string,
    sheetId: string,
    patch: ReviewSheetPatch,
  ): Promise<DrawingSet> {
    const s = stores.get(projectId);
    const set = s.sets.find((x) => x.id === setId);
    const row = set?.sheets.find((x) => x.id === sheetId);
    if (!set || !row) problem(404, 'not_found', "We couldn't find that sheet.");
    for (const key of ['sheetNumber', 'title', 'rev', 'discipline'] as const) {
      const v = patch[key];
      if (v !== undefined) row[key] = { ...row[key], value: v, touched: true };
    }
    if (patch.reason !== undefined) row.reason = patch.reason;
    row.conflict = conflictFor(s, row.sheetNumber.value, row.rev.value);
    return delay(set);
  },

  async publishSet(projectId: string, setId: string): Promise<{ published: number }> {
    const s = stores.get(projectId);
    const set = s.sets.find((x) => x.id === setId);
    if (!set) problem(404, 'not_found', "We couldn't find that drawing set.");
    const blocking = publishBlockers(set);
    if (blocking.length) problem(422, 'drawing_set.not_ready', blocking[0]!);
    for (const row of set.sheets) {
      let sheet = s.sheets.find((x) => x.sheetNumber === row.sheetNumber.value);
      if (!sheet) {
        sheet = {
          id: mockId('sht'),
          sheetNumber: row.sheetNumber.value,
          title: row.title.value,
          discipline: row.discipline.value as Discipline,
          area: null,
        };
        s.sheets.push(sheet);
      }
      const revId = mockId('rev');
      const at = nowIso();
      // One step: the new revision becomes current and the old one superseded (DOC-AC4).
      for (const old of s.revisions.filter(
        (r) => r.sheetId === sheet.id && r.status === 'current',
      )) {
        old.status = 'superseded';
        old.supersededAt = at;
        old.supersededByRevisionId = revId;
        old.supersededByRev = row.rev.value;
      }
      s.revisions.push({
        id: revId,
        sheetId: sheet.id,
        setId: set.id,
        rev: row.rev.value,
        status: 'current',
        issuedFor: set.issuedFor,
        drawingDate: at.slice(0, 10),
        supersededAt: null,
        supersededByRevisionId: null,
        supersededByRev: null,
        widthMm: 841,
        heightMm: 594,
        fileId: null,
        pageIndex: 0,
        createdAt: at,
      });
      const spec = {
        sheetNumber: row.sheetNumber.value,
        title: row.title.value,
        rev: row.rev.value,
        scale: '1:100',
        variant: 2,
      };
      s.artwork.set(revId, spec);
      const segments = s.geometry.get(
        s.revisions.find((r) => r.sheetId === sheet.id && r.id !== revId)?.id ?? '',
      )?.segments;
      s.geometry.set(revId, {
        revisionId: revId,
        sheetNo: '1',
        units: 'mm',
        scaleDetected: '1:100',
        scaleConfirmed: null,
        scaleConfirmedBy: null,
        scaleConfirmedAt: null,
        scaleConflict: null,
        hasVector: true,
        segments: segments ?? [],
      });
    }
    set.status = 'published';
    return delay({ published: set.sheets.length });
  },
};

/** Reasons a set can't publish yet: untouched low-confidence fields, or a backwards revision without a reason. */
export function publishBlockers(set: DrawingSet): string[] {
  const out: string[] = [];
  for (const row of set.sheets) {
    const fields = [row.sheetNumber, row.title, row.rev, row.discipline];
    if (fields.some(needsCheck)) {
      out.push(
        `Check the highlighted fields for ${row.sheetNumber.value || row.fileName} before publishing.`,
      );
    }
    if (row.conflict === 'same_revision_exists') {
      out.push(
        `${row.sheetNumber.value} Rev ${row.rev.value} is already in the register. Change the revision or remove the sheet.`,
      );
    }
    if (row.conflict === 'duplicate_in_set') {
      out.push(
        `${row.sheetNumber.value} Rev ${row.rev.value} is in this set twice. Remove one of them.`,
      );
    }
    if (row.conflict === 'older_revision' && !row.reason.trim()) {
      out.push(
        `${row.sheetNumber.value} Rev ${row.rev.value} is older than the current revision. Give a reason to publish it.`,
      );
    }
  }
  return out;
}

function conflictFor(s: DrawingsStore, sheetNumber: string, rev: string): SheetConflict {
  const sheet = s.sheets.find((x) => x.sheetNumber === sheetNumber);
  if (!sheet) return 'new_sheet';
  const revs = s.revisions.filter((r) => r.sheetId === sheet.id);
  if (revs.some((r) => r.rev === rev)) return 'same_revision_exists';
  const current = revs.find((r) => r.status === 'current');
  if (current && compareRevs(rev, current.rev) < 0) return 'older_revision';
  return 'none';
}

function readTitleBlock(s: DrawingsStore, fileName: string, i: number): ReviewSheet {
  const base = fileName.replace(/\.[^.]+$/, '');
  // "A-101_RevD.pdf" → A-101 / D; anything else becomes a new sheet with low confidence.
  const m = /^([A-Z]{1,2}-\d{3})(?:[ _-]+Rev[ _-]?([A-Z0-9]+))?/i.exec(base);
  const sheetNumber = m?.[1]?.toUpperCase() ?? `A-${(201 + i).toString()}`;
  const rev = m?.[2]?.toUpperCase() ?? 'A';
  const existing = s.sheets.find((x) => x.sheetNumber === sheetNumber);
  const field = (value: string, confidence: number): ReadField => ({
    value,
    confidence,
    touched: false,
  });
  const discipline = sheetNumber.split('-')[0] ?? 'A';
  return {
    id: mockId('rsh'),
    fileName,
    pageIndex: i,
    sheetNumber: field(sheetNumber, m ? 0.97 : 0.55),
    title: field(existing?.title ?? 'Untitled sheet', existing ? 0.93 : 0.62),
    rev: field(rev, m?.[2] ? 0.95 : 0.6),
    discipline: field(discipline, 0.9),
    conflict: conflictFor(s, sheetNumber, rev),
    reason: '',
  };
}

/** Test helper. */
export function resetDrawingsPreview() {
  stores.reset();
}
