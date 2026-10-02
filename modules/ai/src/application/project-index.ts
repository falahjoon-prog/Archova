// Ask Nova ingestion (ai/03 §3): extract each revision's text by page (the PDF text layer, or OCR for a scanned
// page), chunk it, embed it and store it with the access scope `documents` gave it. Idempotent per (revision, pipeline version), so re-runs only do new work.
// Runs in the API process for now, started by a project admin; the ai-worker takes it over, driven by
// `documents.*` events, when the worker lands.
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import type { Database, TenantContext, TenantScope } from '@archova/kernel';
import { ocrPageText } from '../domain/ocr';
import { PIPELINE_VERSION, chunkPages, type PageText } from '../domain/retrieval';
import { toLines } from '../domain/titleblock';
import { readPdfText, readScannedPages } from '../infra/pdf';
import { chunks, indexEntries } from '../infra/tables';
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
}

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
}

/** The source types this service indexes and reconciles. */
const DOCUMENT_SOURCES: Array<'document' | 'drawing'> = ['document', 'drawing'];

const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** Revisions processed at once; each holds one file in memory. */
const CONCURRENCY = 2;

export function createProjectIndexService(deps: ProjectIndexDeps) {
  const { database } = deps;

  async function indexProject(ctx: TenantContext, projectId: string): Promise<IndexReport> {
    const { sources, done } = await database.withTenantTx(ctx, async (scope) => {
      await deps.assert(scope, 'ai.project_index.run', { projectId });
      const sources = await deps.sources(scope, projectId);
      const done = await scope.tx
        .select({ revisionId: indexEntries.revisionId })
        .from(indexEntries)
        .where(
          and(
            eq(indexEntries.projectId, projectId),
            eq(indexEntries.pipelineVersion, PIPELINE_VERSION),
          ),
        );
      return { sources, done: new Set(done.map((d) => d.revisionId)) };
    });

    const report: IndexReport = {
      indexed: 0,
      unchanged: 0,
      noText: 0,
      ocrPages: 0,
      unsupported: 0,
      chunks: 0,
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

    await database.withTenantTx(ctx, (scope) => reconcile(scope, projectId, sources));
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
      rev: SourceRevision;
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

  return { indexProject };
}

export type ProjectIndexService = ReturnType<typeof createProjectIndexService>;
