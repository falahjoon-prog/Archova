import { desc, eq } from 'drizzle-orm';
import type { ProductUpdateDto, ProductUpdateInput } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type KernelServices } from '@archova/kernel';
import { productUpdates, staffUsers } from '../infra/tables';

/** What anyone may read: only published updates, newest first. Drafts and archived rows never leave the console. */
export interface PublicProductUpdate {
  id: string;
  title: string;
  summary: string;
  body: string;
  kind: ProductUpdateDto['kind'];
  banner: boolean;
  publishedAt: string;
}

const PUBLIC_LIMIT = 50;

/** Owner-to-customer product updates: release notes and platform notices written in the console. */
export function createProductUpdateService(
  deps: Pick<KernelServices, 'database'> & { now?: () => Date },
) {
  const now = deps.now ?? (() => new Date());
  const tx = <T>(fn: Parameters<typeof deps.database.withGlobalTx<T>>[1]) =>
    deps.database.withGlobalTx('backoffice', fn);

  const toDto = (
    r: typeof productUpdates.$inferSelect,
    createdByName: string | null,
  ): ProductUpdateDto => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    body: r.body,
    kind: r.kind,
    status: r.status,
    showBanner: r.showBanner,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    createdBy: createdByName ?? 'Unknown',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });

  async function list(): Promise<ProductUpdateDto[]> {
    return tx(async (t) => {
      const rows = await t
        .select({ u: productUpdates, by: staffUsers.name })
        .from(productUpdates)
        .leftJoin(staffUsers, eq(staffUsers.id, productUpdates.createdBy))
        .orderBy(desc(productUpdates.createdAt));
      return rows.map((r) => toDto(r.u, r.by));
    });
  }

  async function create(staffId: string, input: ProductUpdateInput): Promise<ProductUpdateDto[]> {
    await tx((t) =>
      t.insert(productUpdates).values({ id: uuidv7(), ...input, createdBy: staffId }),
    );
    return list();
  }

  async function load(t: Parameters<Parameters<typeof tx>[0]>[0], id: string) {
    const [row] = await t.select().from(productUpdates).where(eq(productUpdates.id, id));
    if (!row) throw new AppError('not_found', 'That update does not exist.');
    return row;
  }

  /** Edits are allowed on drafts and on published updates (typo fixes); an archived one stays as it was. */
  async function update(id: string, input: ProductUpdateInput): Promise<ProductUpdateDto[]> {
    await tx(async (t) => {
      const row = await load(t, id);
      if (row.status === 'archived')
        throw new AppError('conflict', 'An archived update cannot be edited.');
      await t
        .update(productUpdates)
        .set({ ...input, updatedAt: now() })
        .where(eq(productUpdates.id, id));
    });
    return list();
  }

  async function publish(staffId: string, id: string): Promise<ProductUpdateDto[]> {
    await tx(async (t) => {
      const row = await load(t, id);
      if (row.status !== 'draft') throw new AppError('conflict', 'Only a draft can be published.');
      await t
        .update(productUpdates)
        .set({ status: 'published', publishedAt: now(), publishedBy: staffId, updatedAt: now() })
        .where(eq(productUpdates.id, id));
    });
    return list();
  }

  /** Takes a published update off the website and out of the banner; the row stays for the record. */
  async function archive(id: string): Promise<ProductUpdateDto[]> {
    await tx(async (t) => {
      const row = await load(t, id);
      if (row.status === 'archived') return;
      await t
        .update(productUpdates)
        .set({ status: 'archived', updatedAt: now() })
        .where(eq(productUpdates.id, id));
    });
    return list();
  }

  async function listPublic(): Promise<PublicProductUpdate[]> {
    return tx(async (t) => {
      const rows = await t
        .select()
        .from(productUpdates)
        .where(eq(productUpdates.status, 'published'))
        .orderBy(desc(productUpdates.publishedAt))
        .limit(PUBLIC_LIMIT);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        body: r.body,
        kind: r.kind,
        banner: r.showBanner,
        publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
      }));
    });
  }

  return { list, create, update, publish, archive, listPublic };
}

export type ProductUpdateService = ReturnType<typeof createProductUpdateService>;
