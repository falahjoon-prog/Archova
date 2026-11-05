// Specification books: one issued spec PDF per book, split into sections by page range (DOC-US10).
// A new book can supersede an older one; a section number then resolves to the current book's section.
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { specBooks, specSections } from '../infra/tables';
import type { DocumentsContext } from './context';

export type SpecBookRow = typeof specBooks.$inferSelect;
export type SpecSectionRow = typeof specSections.$inferSelect;

export interface SpecSectionInput {
  sectionNumber: string;
  title: string;
  division?: string | null;
  pageFrom: number;
  pageTo: number;
  revision?: string | null;
}

/** "03 30 00" belongs to division "03"; a number that doesn't start with two digits has no division. */
export function divisionOf(sectionNumber: string): string | null {
  const m = /^(\d{2})(?:\s?\d{2})*$/.exec(sectionNumber.trim());
  return m ? m[1]! : null;
}

const invalid = (path: string, message: string) =>
  new AppError('spec_book.invalid', message, [{ path, message }]);

/** Checks a whole section list at once: numbers unique, page ranges sane. Returns the cleaned rows in order. */
export function cleanSections(input: readonly SpecSectionInput[]) {
  const seen = new Set<string>();
  return input.map((s, i) => {
    const sectionNumber = s.sectionNumber.trim().replace(/\s+/g, ' ');
    const title = s.title.trim();
    if (!sectionNumber) throw invalid(`sections/${i}/sectionNumber`, 'Give the section a number.');
    if (!title) throw invalid(`sections/${i}/title`, 'Give the section a title.');
    const key = sectionNumber.toLowerCase();
    if (seen.has(key)) throw invalid(`sections/${i}/sectionNumber`, 'This number is used twice.');
    seen.add(key);
    if (s.pageTo < s.pageFrom)
      throw invalid(`sections/${i}/pageTo`, 'The last page comes before the first.');
    return {
      sectionNumber,
      title,
      division: s.division?.trim() || divisionOf(sectionNumber),
      pageFrom: s.pageFrom,
      pageTo: s.pageTo,
      revision: s.revision?.trim() || null,
    };
  });
}

export function createSpecService(c: DocumentsContext) {
  async function loadBook(scope: TenantScope, projectId: string, bookId: string) {
    const [row] = await scope.tx
      .select()
      .from(specBooks)
      .where(and(eq(specBooks.id, bookId), eq(specBooks.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('spec_book.not_found');
    return row;
  }

  async function sectionsOf(scope: TenantScope, bookId: string) {
    return scope.tx
      .select()
      .from(specSections)
      .where(eq(specSections.bookId, bookId))
      .orderBy(asc(specSections.sort));
  }

  async function list(scope: TenantScope, projectId: string) {
    await c.requireProject(scope, projectId);
    const books = await scope.tx
      .select()
      .from(specBooks)
      .where(eq(specBooks.projectId, projectId))
      .orderBy(desc(specBooks.createdAt));
    const counts = books.length
      ? await scope.tx
          .select({ bookId: specSections.bookId, n: sql<number>`count(*)::int` })
          .from(specSections)
          .where(
            inArray(
              specSections.bookId,
              books.map((b) => b.id),
            ),
          )
          .groupBy(specSections.bookId)
      : [];
    const byBook = new Map(counts.map((r) => [r.bookId, r.n]));
    return books.map((book) => ({ book, sectionCount: byBook.get(book.id) ?? 0 }));
  }

  async function get(scope: TenantScope, projectId: string, bookId: string) {
    await c.requireProject(scope, projectId);
    const book = await loadBook(scope, projectId, bookId);
    return { book, sections: await sectionsOf(scope, book.id) };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: {
      name: string;
      issuedDate?: string | null;
      fileId?: string | null;
      supersedesBookId?: string | null;
    },
  ) {
    await c.requireProject(scope, projectId);
    const name = input.name.trim();
    if (!name) throw invalid('name', 'Give the book a name.');
    if (input.fileId) await c.requireReadyFile(scope, projectId, input.fileId);
    const old = input.supersedesBookId
      ? await loadBook(scope, projectId, input.supersedesBookId)
      : null;
    if (old && old.status !== 'current')
      throw invalid('supersedesBookId', 'That book has already been superseded.');
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(specBooks)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        name,
        issuedDate: input.issuedDate ?? null,
        fileId: input.fileId ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    if (old)
      await scope.tx
        .update(specBooks)
        .set({
          status: 'superseded',
          supersededById: id,
          updatedBy: scope.ctx.userId,
          version: old.version + 1,
        })
        .where(eq(specBooks.id, old.id));
    scope.events.add({
      type: 'documents.spec_book.created.v1',
      projectId,
      entityType: 'spec_book',
      entityId: id,
      entityVersion: 1,
      data: { bookId: id, supersedes: old?.id ?? null },
    });
    return { book: row!, sections: [] as SpecSectionRow[] };
  }

  /** Replaces the whole section list of a book. The book's version is the concurrency check. */
  async function replaceSections(
    scope: TenantScope,
    projectId: string,
    bookId: string,
    expectedVersion: number,
    input: readonly SpecSectionInput[],
  ) {
    await c.requireProject(scope, projectId);
    const book = await loadBook(scope, projectId, bookId);
    if (book.version !== expectedVersion) throw versionConflict();
    const cleaned = cleanSections(input);
    const [bumped] = await scope.tx
      .update(specBooks)
      .set({ updatedBy: scope.ctx.userId, version: book.version + 1, updatedAt: new Date() })
      .where(and(eq(specBooks.id, bookId), eq(specBooks.version, expectedVersion)))
      .returning();
    if (!bumped) throw versionConflict();
    await scope.tx.delete(specSections).where(eq(specSections.bookId, bookId));
    if (cleaned.length)
      await scope.tx.insert(specSections).values(
        cleaned.map((s, sort) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          bookId,
          sort,
          ...s,
        })),
      );
    scope.events.add({
      type: 'documents.spec_book.sections_replaced.v1',
      projectId,
      entityType: 'spec_book',
      entityId: bookId,
      entityVersion: bumped.version,
      data: { bookId, sections: cleaned.length },
    });
    return { book: bumped, sections: await sectionsOf(scope, bookId) };
  }

  /** Sections in current books whose number starts with, or title contains, the text. For linking a reference. */
  async function search(scope: TenantScope, projectId: string, q: string, limit: number) {
    await c.requireProject(scope, projectId);
    const text = q.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
    const rows = await scope.tx
      .select({ section: specSections, book: specBooks })
      .from(specSections)
      .innerJoin(specBooks, eq(specBooks.id, specSections.bookId))
      .where(
        and(
          eq(specSections.projectId, projectId),
          eq(specBooks.status, 'current'),
          text
            ? or(
                ilike(specSections.sectionNumber, `${text}%`),
                ilike(specSections.title, `%${text}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(specSections.sectionNumber))
      .limit(limit);
    return rows;
  }

  return { list, get, create, replaceSections, search };
}

export type SpecService = ReturnType<typeof createSpecService>;
