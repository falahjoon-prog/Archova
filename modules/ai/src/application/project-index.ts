// Ask Nova ingestion (ai/03 §3): extract each revision's text by page (the PDF text layer, or OCR for a scanned
// page), chunk it, embed it and store it with the access scope `documents` gave it. Sent RFIs (question and
// responses) and issued defects are indexed the same way from the text `rfis` and `defects` supply (one page per
// record). Idempotent per (revision, pipeline version), so re-runs only do new work.
// A project admin starts a full run from the API; the ai-worker brings one RFI, defect or diary day in step when it
// changes (`reindexRecord`, driven by the module's events).
import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { defectLabel, uuidv7 } from '@archova/domain';
import type { Database, TenantContext, TenantScope } from '@archova/kernel';
import { ocrPageText } from '../domain/ocr';
import { PIPELINE_VERSION, chunkPages, type PageText } from '../domain/retrieval';
import { defectRevisionId, defectText, type DefectSource } from '../domain/defect-source';
import { diaryRevisionId, diaryText, diaryTitle, type DiarySource } from '../domain/diary-source';
import type { RecordKind } from '../domain/record-events';
import { rfiRevisionId, rfiText, type RfiSource } from '../domain/rfi-source';
import { toLines } from '../domain/titleblock';
import { readPdfText, readScannedPages } from '../infra/pdf';
import { chunks, indexEntries, type ChunkSourceType } from '../infra/tables';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';

/** What `documents.api.aiSources` returns for one revision. */
export interface SourceRevision {
  sourceType: 'document' | 'drawing';
  sourceId: string;
  revisionId: string;
  revisionLabel: string;
  title: string;
  reference: string | null;
  fileId: string;
  page: number | null;
  status: 'current' | 'superseded';
  accessScope: string;
}

export interface ProjectIndexDeps {
  database: Database;
  gateway: Pick<Gateway, 'embed' | 'ocr'>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  sources: (scope: TenantScope, projectId: string) => Promise<SourceRevision[]>;
  /** `rfis.api.aiSources`: the sent RFIs with their responses. */
  rfiSources: (scope: TenantScope, projectId: string, only?: string) => Promise<RfiSource[]>;
  /** `defects.api.aiSources`: the issued defects with the notes on their history. */
  defectSources: (scope: TenantScope, projectId: string, only?: string) => Promise<DefectSource[]>;
  /** `diary.api.aiSources`: the submitted and signed-off days with all their lines. */
  diarySources: (scope: TenantScope, projectId: string, only?: string) => Promise<DiarySource[]>;
}

/** What an index entry records about a source. */
interface IndexedSource {
  sourceType: ChunkSourceType;
  sourceId: string;
  revisionId: string;
}

/** The scope RFI chunks carry: builder staff only (`rfis.api.aiAccessScopes`). */
export const RFI_ACCESS_SCOPE = 'rfis';
/** The scope defect chunks carry: builder staff only (`defects.api.aiAccessScopes`). */
export const DEFECT_ACCESS_SCOPE = 'defects';
/** The scope diary chunks carry: builder staff who read the whole diary (`diary.api.aiAccessScopes`). */
export const DIARY_ACCESS_SCOPE = 'diary';

const RECORD_SCOPES: Record<RecordKind, string> = {
  rfi: RFI_ACCESS_SCOPE,
  defect: DEFECT_ACCESS_SCOPE,
  diary: DIARY_ACCESS_SCOPE,
};

/** One record (an RFI, a defect, a diary day) as the single page of text that is chunked and embedded. */
interface RecordPage {
  sourceId: string;
  /** Changes whenever `text` does. */
  revisionId: string;
  revisionLabel: string;
  title: string;
  reference: string | null;
  /** Put before each chunk when it is embedded, so a chunk from the middle of a long record still names it. */
  header: string;
  text: string;
}

const rfiPage = (r: RfiSource): RecordPage => ({
  sourceId: r.id,
  revisionId: rfiRevisionId(r),
  revisionLabel: r.status,
  title: r.subject,
  reference: r.number,
  header: `${r.number ?? 'RFI'} ${r.subject}`,
  text: rfiText(r),
});

const defectPage = (d: DefectSource): RecordPage => ({
  sourceId: d.id,
  revisionId: defectRevisionId(d),
  revisionLabel: d.status,
  title: d.title,
  reference: defectLabel(d.number),
  header: `${defectLabel(d.number)} ${d.title}`,
  text: defectText(d),
});

const diaryPage = (d: DiarySource): RecordPage => ({
  sourceId: d.entryId,
  revisionId: diaryRevisionId(d),
  revisionLabel: d.status.replace('_', ' '),
  title: diaryTitle(d.date),
  reference: d.date,
  header: diaryTitle(d.date),
  text: diaryText(d),
});

export interface IndexReport {
  /** Revisions indexed in this run. */
  indexed: number;
  /** Revisions already indexed at this pipeline version. */
  unchanged: number;
  /** Revisions with no text, even after OCR (blank pages, photos, drawings with no words). */
  noText: number;
  /** Scanned pages read with OCR in this run. */
  ocrPages: number;
  /** Files that aren't PDFs. */
  unsupported: number;
  chunks: number;
  /** RFIs indexed in this run, and RFIs already indexed at this text and pipeline version. */
  rfisIndexed: number;
  rfisUnchanged: number;
  /** Defects indexed in this run, and defects already indexed at this text and pipeline version. */
  defectsIndexed: number;
  defectsUnchanged: number;
  /** Diary days indexed in this run, and days already indexed at this text and pipeline version. */
  diaryIndexed: number;
  diaryUnchanged: number;
}

/** The source types this service indexes and reconciles. */
const DOCUMENT_SOURCES: Array<'document' | 'drawing'> = ['document', 'drawing'];

const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** Revisions processed at once; each holds one file in memory. */
const CONCURRENCY = 2;

export function createProjectIndexService(deps: ProjectIndexDeps) {
  const { database } = deps;

  async function indexProject(ctx: TenantContext, projectId: string): Promise<IndexReport> {
    const { sources, rfiSources, defectSources, diarySources, done } = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'ai.project_index.run', { projectId });
        const sources = await deps.sources(scope, projectId);
        const rfiSources = await deps.rfiSources(scope, projectId);
        const defectSources = await deps.defectSources(scope, projectId);
        const diarySources = await deps.diarySources(scope, projectId);
        const done = await scope.tx
          .select({ revisionId: indexEntries.revisionId })
          .from(indexEntries)
          .where(
            and(
              eq(indexEntries.projectId, projectId),
              eq(indexEntries.pipelineVersion, PIPELINE_VERSION),
            ),
          );
        return {
          sources,
          rfiSources,
          defectSources,
          diarySources,
          done: new Set(done.map((d) => d.revisionId)),
        };
      },
    );

    const report: IndexReport = {
      indexed: 0,
      unchanged: 0,
      noText: 0,
      ocrPages: 0,
      unsupported: 0,
      chunks: 0,
      rfisIndexed: 0,
      rfisUnchanged: 0,
      defectsIndexed: 0,
      defectsUnchanged: 0,
      diaryIndexed: 0,
      diaryUnchanged: 0,
    };
    const todo = sources.filter((s) => {
      if (done.has(s.revisionId)) report.unchanged++;
      return !done.has(s.revisionId);
    });
    // One drawing set PDF holds many sheets: read each file once.
    const byFile = new Map<string, SourceRevision[]>();
    for (const s of todo) byFile.set(s.fileId, [...(byFile.get(s.fileId) ?? []), s]);
    const files = [...byFile.entries()];
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const [fileId, revs] = files[next++]!;
        await indexFile(ctx, projectId, fileId, revs, report);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

    const rfiPages = rfiSources.map(rfiPage);
    const defectPages = defectSources.map(defectPage);
    const diaryPages = diarySources.map(diaryPage);
    const rfiCounts = await indexRecords(ctx, projectId, 'rfi', RFI_ACCESS_SCOPE, rfiPages, done);
    report.rfisIndexed = rfiCounts.indexed;
    report.rfisUnchanged = rfiCounts.unchanged;
    const defectCounts = await indexRecords(
      ctx,
      projectId,
      'defect',
      DEFECT_ACCESS_SCOPE,
      defectPages,
      done,
    );
    report.defectsIndexed = defectCounts.indexed;
    report.defectsUnchanged = defectCounts.unchanged;
    const diaryCounts = await indexRecords(
      ctx,
      projectId,
      'diary',
      DIARY_ACCESS_SCOPE,
      diaryPages,
      done,
    );
    report.diaryIndexed = diaryCounts.indexed;
    report.diaryUnchanged = diaryCounts.unchanged;

    await database.withTenantTx(ctx, async (scope) => {
      await reconcile(scope, projectId, sources);
      await reconcileRecords(scope, projectId, 'rfi', rfiPages);
      await reconcileRecords(scope, projectId, 'defect', defectPages);
      await reconcileRecords(scope, projectId, 'diary', diaryPages);
    });
    return report;
  }

  async function indexFile(
    ctx: TenantContext,
    projectId: string,
    fileId: string,
    revs: SourceRevision[],
    report: IndexReport,
  ) {
    const file = await database.withTenantTx(ctx, (scope) =>
      deps.readFile(scope, fileId, MAX_FILE_BYTES),
    );
    if (file.file.mime !== 'application/pdf') {
      await database.withTenantTx(ctx, (scope) =>
        recordEntries(
          scope,
          projectId,
          revs.map((r) => ({ rev: r, outcome: 'unsupported' as const, pages: 0, chunks: 0 })),
        ),
      );
      report.unsupported += revs.length;
      return;
    }
    const pdf = await readPdfText(file.bytes);
    const pageText = new Map<number, string>(
      pdf.pages.map((p) => [p.page, toLines(p.items).join('\n')]),
    );
    // Pages these revisions need that have no text layer are scans: read them with OCR.
    const needed = revs.some((r) => r.page === null)
      ? [...pageText.keys()]
      : revs.map((r) => r.page!);
    const blank = [...new Set(needed)].filter((p) => pageText.has(p) && !pageText.get(p)!.trim());
    if (blank.length) {
      const scans = await readScannedPages(file.bytes, blank);
      const read = await deps.gateway.ocr(
        ctx,
        scans.map((s) => s.png),
        { feature: 'ask', projectId },
      );
      scans.forEach((s, i) => pageText.set(s.page, ocrPageText(read[i]!.lines)));
      report.ocrPages += scans.length;
    }
    for (const rev of revs) {
      // A drawing is one page of its set; a document is the whole file.
      const pages: PageText[] =
        rev.page === null
          ? [...pageText.entries()].map(([page, text]) => ({ page, text }))
          : [{ page: rev.page, text: pageText.get(rev.page) ?? '' }];
      const pieces = chunkPages(pages);
      if (pieces.length === 0) {
        await database.withTenantTx(ctx, (scope) =>
          recordEntries(scope, projectId, [
            { rev, outcome: 'no_text', pages: pages.length, chunks: 0 },
          ]),
        );
        report.noText++;
        continue;
      }
      // The heading travels with each chunk's embedding so "the hydraulic spec" finds its clauses.
      const header = `${rev.reference ? `${rev.reference} ` : ''}${rev.title} (rev ${rev.revisionLabel})`;
      const { model, vectors } = await deps.gateway.embed(
        ctx,
        pieces.map((p) => `${header}\n${p.text}`),
        { purpose: 'document', feature: 'ask', projectId },
      );
      await database.withTenantTx(ctx, async (scope) => {
        await scope.tx
          .insert(chunks)
          .values(
            pieces.map((p, i) => ({
              id: uuidv7(),
              orgId: scope.ctx.orgId,
              projectId,
              sourceType: rev.sourceType,
              sourceId: rev.sourceId,
              revisionId: rev.revisionId,
              revisionLabel: rev.revisionLabel,
              title: rev.title,
              reference: rev.reference,
              page: p.page,
              chunkIndex: p.chunkIndex,
              text: p.text,
              embedding: vectors[i]!,
              embeddingModel: model,
              accessScope: rev.accessScope,
              status: rev.status,
              pipelineVersion: PIPELINE_VERSION,
            })),
          )
          .onConflictDoNothing();
        await recordEntries(scope, projectId, [
          { rev, outcome: 'indexed', pages: pages.length, chunks: pieces.length },
        ]);
      });
      report.indexed++;
      report.chunks += pieces.length;
    }
  }

  async function recordEntries(
    scope: TenantScope,
    projectId: string,
    entries: Array<{
      rev: IndexedSource;
      outcome: 'indexed' | 'no_text' | 'unsupported';
      pages: number;
      chunks: number;
    }>,
  ) {
    await scope.tx
      .insert(indexEntries)
      .values(
        entries.map((e) => ({
          orgId: scope.ctx.orgId,
          projectId,
          revisionId: e.rev.revisionId,
          pipelineVersion: PIPELINE_VERSION,
          sourceType: e.rev.sourceType,
          sourceId: e.rev.sourceId,
          outcome: e.outcome,
          pages: e.pages,
          chunks: e.chunks,
        })),
      )
      .onConflictDoNothing();
  }

  /** Chunks and embeds each record whose text is new since the last run (a changed record has a new revision id). */
  async function indexRecords(
    ctx: TenantContext,
    projectId: string,
    sourceType: RecordKind,
    accessScope: string,
    pages: RecordPage[],
    done: Set<string>,
  ) {
    const counts = { indexed: 0, unchanged: 0 };
    for (const r of pages) {
      if (done.has(r.revisionId)) {
        counts.unchanged++;
        continue;
      }
      const rev: IndexedSource = { sourceType, sourceId: r.sourceId, revisionId: r.revisionId };
      const pieces = chunkPages([{ page: 1, text: r.text }]);
      const { model, vectors } = await deps.gateway.embed(
        ctx,
        pieces.map((p) => `${r.header}\n${p.text}`),
        { purpose: 'document', feature: 'ask', projectId },
      );
      await database.withTenantTx(ctx, async (scope) => {
        await scope.tx
          .insert(chunks)
          .values(
            pieces.map((p, i) => ({
              id: uuidv7(),
              orgId: scope.ctx.orgId,
              projectId,
              sourceType,
              sourceId: r.sourceId,
              revisionId: r.revisionId,
              revisionLabel: r.revisionLabel,
              title: r.title,
              reference: r.reference,
              page: p.page,
              chunkIndex: p.chunkIndex,
              text: p.text,
              embedding: vectors[i]!,
              embeddingModel: model,
              accessScope,
              status: 'current' as const,
              pipelineVersion: PIPELINE_VERSION,
            })),
          )
          .onConflictDoNothing();
        await recordEntries(scope, projectId, [
          { rev, outcome: 'indexed', pages: 1, chunks: pieces.length },
        ]);
      });
      counts.indexed++;
    }
    return counts;
  }

  /** Drops chunks of records whose text has changed since, of records that were voided or deleted, and of older pipeline versions. */
  async function reconcileRecords(
    scope: TenantScope,
    projectId: string,
    sourceType: RecordKind,
    pages: RecordPage[],
    /** Reconcile one record (its page, if it is still a source) instead of the whole project. */
    onlySource?: string,
  ) {
    const live = pages.map((p) => p.revisionId);
    const inProject = and(
      eq(chunks.orgId, scope.ctx.orgId),
      eq(chunks.projectId, projectId),
      eq(chunks.sourceType, sourceType),
      onlySource ? eq(chunks.sourceId, onlySource) : undefined,
    );
    await scope.tx
      .delete(chunks)
      .where(
        and(
          inProject,
          or(
            live.length ? notInArray(chunks.revisionId, live) : sql`true`,
            sql`${chunks.pipelineVersion} <> ${PIPELINE_VERSION}`,
          ),
        ),
      );
    await scope.tx
      .delete(indexEntries)
      .where(
        and(
          eq(indexEntries.projectId, projectId),
          eq(indexEntries.sourceType, sourceType),
          onlySource ? eq(indexEntries.sourceId, onlySource) : undefined,
          live.length ? notInArray(indexEntries.revisionId, live) : sql`true`,
        ),
      );
  }

  /**
   * Brings stored chunks in line with the register (ai/03 §3 step 6 and §5): a new current revision supersedes the
   * old one's chunks, a document moved to another folder takes its new access scope, deleted records and older
   * pipeline versions drop out.
   */
  async function reconcile(scope: TenantScope, projectId: string, sources: SourceRevision[]) {
    const live = sources.map((s) => s.revisionId);
    // Only what `documents` supplies: induction chunks (induction-qa.ts) are kept in step by their own versions.
    const inProject = and(
      eq(chunks.orgId, scope.ctx.orgId),
      eq(chunks.projectId, projectId),
      inArray(chunks.sourceType, DOCUMENT_SOURCES),
    );
    await scope.tx
      .delete(chunks)
      .where(and(inProject, live.length ? notInArray(chunks.revisionId, live) : sql`true`));
    await scope.tx
      .delete(chunks)
      .where(and(inProject, sql`${chunks.pipelineVersion} <> ${PIPELINE_VERSION}`));
    await scope.tx
      .delete(indexEntries)
      .where(
        and(
          eq(indexEntries.projectId, projectId),
          inArray(indexEntries.sourceType, DOCUMENT_SOURCES),
          live.length ? notInArray(indexEntries.revisionId, live) : sql`true`,
        ),
      );
    // Group revisions by their target status and scope, then fix any chunk that differs.
    const groups = new Map<string, string[]>();
    for (const s of sources) {
      const key = `${s.status}|${s.accessScope}`;
      groups.set(key, [...(groups.get(key) ?? []), s.revisionId]);
    }
    for (const [key, ids] of groups) {
      const [status, accessScope] = key.split('|') as ['current' | 'superseded', string];
      await scope.tx
        .update(chunks)
        .set({ status, accessScope, updatedAt: sql`now()` })
        .where(
          and(
            inProject,
            inArray(chunks.revisionId, ids),
            sql`(${chunks.status} <> ${status} or ${chunks.accessScope} <> ${accessScope})`,
          ),
        );
    }
  }

  /** The page of one record, or none when it is not a source (a draft, voided, deleted or not found). */
  async function recordPages(
    scope: TenantScope,
    projectId: string,
    kind: RecordKind,
    recordId: string,
  ): Promise<RecordPage[]> {
    if (kind === 'rfi') return (await deps.rfiSources(scope, projectId, recordId)).map(rfiPage);
    if (kind === 'defect')
      return (await deps.defectSources(scope, projectId, recordId)).map(defectPage);
    return (await deps.diarySources(scope, projectId, recordId)).map(diaryPage);
  }

  /**
   * Brings one record's chunks in line with the register after it changed: text that no longer matches is dropped
   * first, with no model call, so a voided or amended record is never searchable while its new text waits for an
   * embedding; then the current text is embedded if it is new. For background callers, which build the context:
   * no route reaches this, and it checks no permission of its own.
   */
  async function reindexRecord(
    ctx: TenantContext,
    projectId: string,
    kind: RecordKind,
    recordId: string,
  ) {
    const { pages, done } = await database.withTenantTx(ctx, async (scope) => {
      const pages = await recordPages(scope, projectId, kind, recordId);
      const entries = await scope.tx
        .select({ revisionId: indexEntries.revisionId })
        .from(indexEntries)
        .where(
          and(
            eq(indexEntries.projectId, projectId),
            eq(indexEntries.sourceType, kind),
            eq(indexEntries.sourceId, recordId),
            eq(indexEntries.pipelineVersion, PIPELINE_VERSION),
          ),
        );
      await reconcileRecords(scope, projectId, kind, pages, recordId);
      return { pages, done: new Set(entries.map((e) => e.revisionId)) };
    });
    return indexRecords(ctx, projectId, kind, RECORD_SCOPES[kind], pages, done);
  }

  return { indexProject, reindexRecord };
}

export type ProjectIndexService = ReturnType<typeof createProjectIndexService>;
