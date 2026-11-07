import { and, desc, eq, inArray, isNull, like, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import {
  PHOTO_CATEGORIES,
  fileObjects,
  photoAlbumItems,
  photoAlbums,
  photoFilings,
  type PhotoCategory,
  type PhotoFilingSource,
  type PhotoRefKind,
} from '../infra/tables';
import type { ObjectStore } from '../infra/object-store';
import { DOWNLOAD_URL_TTL_S, contentDisposition } from '../domain/rules';
import {
  UNCLASSIFIED_FLAG_AFTER_MS,
  needsReview,
  suggestFiling,
  type PhotoFacts,
} from '../domain/photo-albums';
import { PHOTO_MODULES } from './files-service';

type FileRow = typeof fileObjects.$inferSelect;

export interface FilingInput {
  category: PhotoCategory;
  refKind?: PhotoRefKind | null;
  refId?: string | null;
}

/** Sort time of a photo: when it was taken, else when it was uploaded. */
const photoTime = sql<Date>`coalesce(${fileObjects.takenAt}, ${fileObjects.createdAt})`;

/** Album a photo is in: its filing if it has one, else the module it was taken in. */
const categoryExpr = sql<PhotoCategory>`coalesce(${photoFilings.category},
  case ${fileObjects.module}
    when 'diary' then 'daily_log'
    when 'defects' then 'punch_list'
    when 'quality' then 'inspections'
    when 'rfis' then 'rfis'
    else 'unclassified' end)`;

const MAX_ALBUMS = 100;
const MAX_ALBUM_PHOTOS = 1000;

/** Site photo albums over the files the project gallery already lists (`PHOTO_MODULES`). */
export function createPhotoAlbumsService({
  access,
  store,
}: {
  access: AccessService;
  store: ObjectStore;
}) {
  const read = (scope: TenantScope, projectId: string) =>
    access.assert(scope, 'files.objects.read', { projectId });
  const write = (scope: TenantScope, projectId: string) =>
    access.assert(scope, 'files.objects.upload', { projectId });

  const photoBase = (projectId: string): SQL[] => [
    eq(fileObjects.projectId, projectId),
    eq(fileObjects.status, 'ready'),
    like(fileObjects.mime, 'image/%'),
    inArray(fileObjects.module, [...PHOTO_MODULES]),
    isNull(fileObjects.deletedAt),
  ];

  const filingOn = and(
    eq(photoFilings.orgId, fileObjects.orgId),
    eq(photoFilings.fileId, fileObjects.id),
  );

  async function sign(f: FileRow) {
    return {
      url: await store.presignGet(f.storageKey, {
        contentDisposition: contentDisposition(f.filename),
        expiresInS: DOWNLOAD_URL_TTL_S,
      }),
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_S * 1000),
    };
  }

  /** Auto albums with counts and a cover, plus the project's own albums, and how many photos Nova wants filed. */
  async function listAlbums(scope: TenantScope, projectId: string) {
    await read(scope, projectId);
    const counts = await scope.tx
      .select({
        category: categoryExpr.as('category'),
        n: sql<number>`count(*)::int`.as('n'),
        stale:
          sql<number>`count(*) filter (where ${fileObjects.createdAt} <= now() - ${UNCLASSIFIED_FLAG_AFTER_MS / 1000} * interval '1 second')::int`.as(
            'stale',
          ),
      })
      .from(fileObjects)
      .leftJoin(photoFilings, filingOn)
      .where(and(...photoBase(projectId)))
      .groupBy(categoryExpr);
    const covers = await scope.tx
      .selectDistinctOn([categoryExpr], {
        category: categoryExpr.as('category'),
        file: fileObjects,
      })
      .from(fileObjects)
      .leftJoin(photoFilings, filingOn)
      .where(and(...photoBase(projectId)))
      .orderBy(categoryExpr, desc(photoTime));
    const coverBy = new Map<string, FileRow>(
      covers.map((c: { category: string; file: FileRow }) => [c.category, c.file]),
    );
    const auto = await Promise.all(
      PHOTO_CATEGORIES.map(async (category) => {
        const row = counts.find((c: { category: string }) => c.category === category);
        const cover = coverBy.get(category);
        return {
          category,
          count: row?.n ?? 0,
          needsReview: category === 'unclassified' ? (row?.stale ?? 0) : 0,
          cover: cover ? await sign(cover) : null,
        };
      }),
    );
    const manual = await scope.tx
      .select({
        id: photoAlbums.id,
        name: photoAlbums.name,
        createdAt: photoAlbums.createdAt,
        count: sql<number>`count(${photoAlbumItems.fileId})::int`,
      })
      .from(photoAlbums)
      .leftJoin(photoAlbumItems, eq(photoAlbumItems.albumId, photoAlbums.id))
      .where(eq(photoAlbums.projectId, projectId))
      .groupBy(photoAlbums.id)
      .orderBy(photoAlbums.name);
    return { auto, manual };
  }

  interface BrowseQuery {
    album?: string;
    q?: string;
    from?: Date;
    to?: Date;
    limit: number;
    cursor?: { at: Date; id: string };
  }

  /** One page of photos, newest first, filtered to an auto album (category) or a project album, with search and dates. */
  async function browse(scope: TenantScope, projectId: string, query: BrowseQuery) {
    await read(scope, projectId);
    const where = photoBase(projectId);
    if (query.album) {
      if ((PHOTO_CATEGORIES as readonly string[]).includes(query.album))
        where.push(sql`${categoryExpr} = ${query.album}`);
      else
        where.push(
          sql`exists (select 1 from ${photoAlbumItems} ai join ${photoAlbums} a on a.id = ai.album_id
            where ai.file_id = ${fileObjects.id} and ai.album_id = ${query.album} and a.project_id = ${projectId})`,
        );
    }
    if (query.q)
      where.push(
        sql`${fileObjects.filename} ilike ${'%' + query.q.replace(/[\\%_]/g, '\\$&') + '%'}`,
      );
    if (query.from) where.push(sql`${photoTime} >= ${query.from}`);
    if (query.to) where.push(sql`${photoTime} < ${query.to}`);
    if (query.cursor)
      where.push(sql`(${photoTime}, ${fileObjects.id}) < (${query.cursor.at}, ${query.cursor.id})`);
    const limit = Math.min(Math.max(query.limit, 1), 100);
    const rows = await scope.tx
      .select({ file: fileObjects, category: categoryExpr.as('category'), filing: photoFilings })
      .from(fileObjects)
      .leftJoin(photoFilings, filingOn)
      .where(and(...where))
      .orderBy(desc(photoTime), desc(fileObjects.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit) as {
      file: FileRow;
      category: PhotoCategory;
      filing: typeof photoFilings.$inferSelect | null;
    }[];

    // Nova's suggestion for photos left unfiled: from the project's recent filed photos.
    const unfiled = page.filter((r) => r.category === 'unclassified');
    let filed: PhotoFacts[] = [];
    if (unfiled.length) {
      const recent = await scope.tx
        .select({
          file: fileObjects,
          category: categoryExpr.as('category'),
          filing: photoFilings,
        })
        .from(fileObjects)
        .leftJoin(photoFilings, filingOn)
        .where(and(...photoBase(projectId), sql`${categoryExpr} <> 'unclassified'`))
        .orderBy(desc(photoTime))
        .limit(300);
      filed = recent.map(
        (r: {
          file: FileRow;
          category: PhotoCategory;
          filing: typeof photoFilings.$inferSelect | null;
        }) => facts(r.file, r.category, r.filing),
      );
    }
    const now = new Date();
    const items = await Promise.all(
      page.map(async (r) => ({
        ...r,
        ...(await sign(r.file)),
        needsReview: needsReview(r.category, r.file.createdAt, now),
        suggestion:
          r.category === 'unclassified'
            ? suggestFiling(facts(r.file, r.category, r.filing), filed)
            : null,
      })),
    );
    const last = items.at(-1);
    return {
      items,
      next:
        rows.length > limit && last
          ? { at: last.file.takenAt ?? last.file.createdAt, id: last.file.id }
          : null,
    };
  }

  const facts = (
    f: FileRow,
    category: PhotoCategory,
    filing: typeof photoFilings.$inferSelect | null,
  ): PhotoFacts => ({
    id: f.id,
    category,
    refKind: filing?.refKind ?? null,
    refId: filing?.refId ?? null,
    uploaderId: f.createdBy,
    at: f.takenAt ?? f.createdAt,
    lat: f.captureLat,
    lng: f.captureLng,
  });

  async function loadPhoto(scope: TenantScope, projectId: string, fileId: string) {
    const [f] = await scope.tx
      .select()
      .from(fileObjects)
      .where(and(eq(fileObjects.id, fileId), isNull(fileObjects.deletedAt)));
    if (!f || f.projectId !== projectId || f.status !== 'ready' || !f.mime.startsWith('image/'))
      throw new AppError('file.not_found');
    if (!(PHOTO_MODULES as readonly string[]).includes(f.module))
      throw new AppError('file.not_found');
    return f;
  }

  /** File a photo under an album category, optionally pinned to the record it belongs to. A person's filing wins over a later automatic one. */
  async function fileUnder(
    scope: TenantScope,
    projectId: string,
    fileId: string,
    input: FilingInput,
    source: PhotoFilingSource,
    opts: { checkAccess?: boolean; onlyIfUnfiled?: boolean } = {},
  ) {
    if (opts.checkAccess !== false) await write(scope, projectId);
    if (
      (input.refKind === undefined || input.refKind === null) !==
      (input.refId === undefined || input.refId === null)
    )
      throw new AppError(
        'validation_failed',
        'Give both the record type and the record, or neither.',
        [{ path: 'refId', message: 'refKind and refId come together' }],
      );
    const f = await loadPhoto(scope, projectId, fileId);
    if (opts.onlyIfUnfiled) {
      const [existing] = await scope.tx
        .select()
        .from(photoFilings)
        .where(and(eq(photoFilings.orgId, scope.ctx.orgId), eq(photoFilings.fileId, fileId)));
      // Already filed by a person, or with a record behind it: leave it.
      if (
        existing &&
        (existing.source === 'manual' || existing.source === 'nova' || existing.refId)
      )
        return existing;
      if (!existing && f.module !== 'photos' && !input.refId) return null;
    }
    const [row] = await scope.tx
      .insert(photoFilings)
      .values({
        orgId: scope.ctx.orgId,
        fileId,
        projectId,
        category: input.category,
        refKind: input.refKind ?? null,
        refId: input.refId ?? null,
        source,
        filedBy: scope.ctx.userId,
      })
      .onConflictDoUpdate({
        target: [photoFilings.orgId, photoFilings.fileId],
        set: {
          category: input.category,
          refKind: input.refKind ?? null,
          refId: input.refId ?? null,
          source,
          filedBy: scope.ctx.userId,
          filedAt: sql`now()`,
        },
      })
      .returning();
    return row!;
  }

  async function createAlbum(scope: TenantScope, projectId: string, name: string) {
    await write(scope, projectId);
    const trimmed = name.trim();
    if (!trimmed)
      throw new AppError('validation_failed', 'Name the album.', [
        { path: 'name', message: 'Required' },
      ]);
    const [{ n } = { n: 0 }] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(photoAlbums)
      .where(eq(photoAlbums.projectId, projectId));
    if ((n ?? 0) >= MAX_ALBUMS)
      throw new AppError('validation_failed', `A project can have ${MAX_ALBUMS} albums.`, [
        { path: 'name', message: 'Album limit reached' },
      ]);
    const [dup] = await scope.tx
      .select({ id: photoAlbums.id })
      .from(photoAlbums)
      .where(
        and(
          eq(photoAlbums.projectId, projectId),
          sql`lower(${photoAlbums.name}) = lower(${trimmed})`,
        ),
      );
    if (dup)
      throw new AppError('photo_album.name_taken', 'An album with that name already exists.');
    const [row] = await scope.tx
      .insert(photoAlbums)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        name: trimmed,
        createdBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  async function requireAlbum(scope: TenantScope, projectId: string, albumId: string) {
    const [a] = await scope.tx
      .select()
      .from(photoAlbums)
      .where(and(eq(photoAlbums.id, albumId), eq(photoAlbums.projectId, projectId)));
    if (!a) throw new AppError('photo_album.not_found');
    return a;
  }

  async function deleteAlbum(scope: TenantScope, projectId: string, albumId: string) {
    await write(scope, projectId);
    await requireAlbum(scope, projectId, albumId);
    await scope.tx.delete(photoAlbums).where(eq(photoAlbums.id, albumId));
  }

  async function addToAlbum(
    scope: TenantScope,
    projectId: string,
    albumId: string,
    fileId: string,
  ) {
    await write(scope, projectId);
    await requireAlbum(scope, projectId, albumId);
    await loadPhoto(scope, projectId, fileId);
    const [{ n } = { n: 0 }] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(photoAlbumItems)
      .where(eq(photoAlbumItems.albumId, albumId));
    if ((n ?? 0) >= MAX_ALBUM_PHOTOS)
      throw new AppError('validation_failed', `An album holds ${MAX_ALBUM_PHOTOS} photos.`, [
        { path: 'fileId', message: 'Album is full' },
      ]);
    await scope.tx
      .insert(photoAlbumItems)
      .values({ orgId: scope.ctx.orgId, albumId, fileId, addedBy: scope.ctx.userId })
      .onConflictDoNothing();
  }

  async function removeFromAlbum(
    scope: TenantScope,
    projectId: string,
    albumId: string,
    fileId: string,
  ) {
    await write(scope, projectId);
    await requireAlbum(scope, projectId, albumId);
    await scope.tx
      .delete(photoAlbumItems)
      .where(and(eq(photoAlbumItems.albumId, albumId), eq(photoAlbumItems.fileId, fileId)));
  }

  return { listAlbums, browse, fileUnder, createAlbum, deleteAlbum, addToAlbum, removeFromAlbum };
}

export type PhotoAlbumsService = ReturnType<typeof createPhotoAlbumsService>;
