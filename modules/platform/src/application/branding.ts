import { eq } from 'drizzle-orm';
import { AppError, type TenantScope } from '@archova/kernel';
import { orgs } from '../infra/tables';

/**
 * Org-level look and feel, layered on the design tokens (design 02): a logo, one accent colour that replaces the
 * brand amber, and which Portfolio widgets show, in order. Primary actions, status colours and safety orange are
 * never customised. Stored under `orgs.settings.branding`; the logo is `orgs.logo_file_id`.
 */
export const DASHBOARD_WIDGETS = [
  { key: 'projects', label: 'Projects' },
  { key: 'rfis', label: 'RFIs open' },
  { key: 'defects', label: 'Defects open' },
  { key: 'submittals', label: 'Submittals with reviewers' },
  { key: 'claims', label: 'Claims unpaid' },
  { key: 'variations', label: 'Variations to decide' },
  { key: 'incidents', label: 'Incidents open' },
  { key: 'programme', label: 'Programme activities open' },
  { key: 'budget', label: 'Forecast vs budget' },
  { key: 'project_table', label: 'Projects table' },
] as const;

const WIDGET_KEYS: ReadonlySet<string> = new Set(DASHBOARD_WIDGETS.map((w) => w.key));
export const DEFAULT_WIDGETS: readonly string[] = DASHBOARD_WIDGETS.map((w) => w.key);
const HEX = /^#[0-9a-f]{6}$/i;

/** WCAG relative luminance of a #RRGGBB colour. Accents are only marks and bars, so they just need to stand out from both page surfaces. */
export function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const WHITE = 1;
const DARK_SURFACE = luminance('#16212A');

/** Files port: the files module is built after platform, so it is resolved lazily. */
export interface BrandingFilesPort {
  getFile(
    scope: TenantScope,
    fileId: string,
  ): Promise<{ status: string; mime: string; projectId: string | null }>;
}

export interface BrandingView {
  logoFileId: string | null;
  accentColor: string | null;
  dashboardWidgets: string[];
  version: number;
}

export interface BrandingInput {
  logoFileId?: string | null;
  accentColor?: string | null;
  dashboardWidgets?: string[];
}

interface Stored {
  accentColor?: string | null;
  dashboardWidgets?: string[];
}

export function createBrandingService(files: () => BrandingFilesPort | undefined) {
  const view = (o: typeof orgs.$inferSelect): BrandingView => {
    const b = ((o.settings as { branding?: Stored } | null)?.branding ?? {}) as Stored;
    return {
      logoFileId: o.logoFileId,
      accentColor: b.accentColor ?? null,
      dashboardWidgets: b.dashboardWidgets ?? [...DEFAULT_WIDGETS],
      version: o.version,
    };
  };

  async function load(scope: TenantScope) {
    const [o] = await scope.tx.select().from(orgs).where(eq(orgs.id, scope.ctx.orgId)).limit(1);
    if (!o || o.deletedAt) throw new AppError('org.not_found');
    return o;
  }

  async function get(scope: TenantScope) {
    return view(await load(scope));
  }

  async function update(scope: TenantScope, input: BrandingInput) {
    const o = await load(scope);
    const stored = ((o.settings as { branding?: Stored } | null)?.branding ?? {}) as Stored;
    const next: Stored = { ...stored };
    const problems: Array<{ path: string; message: string }> = [];

    if (input.accentColor !== undefined) {
      const c = input.accentColor;
      if (c === null) next.accentColor = null;
      else if (!HEX.test(c))
        problems.push({ path: 'accentColor', message: 'Use a colour like #1F6FEB' });
      else if (contrast(luminance(c), WHITE) < 1.5 || contrast(luminance(c), DARK_SURFACE) < 1.5)
        problems.push({
          path: 'accentColor',
          message: 'Pick a colour that shows on both light and dark pages',
        });
      else next.accentColor = c.toUpperCase();
    }
    if (input.dashboardWidgets !== undefined) {
      const w = input.dashboardWidgets;
      if (w.some((k) => !WIDGET_KEYS.has(k)) || new Set(w).size !== w.length)
        problems.push({ path: 'dashboardWidgets', message: 'Unknown or repeated widget' });
      else if (w.length === 0)
        problems.push({ path: 'dashboardWidgets', message: 'Keep at least one widget' });
      else next.dashboardWidgets = w;
    }
    let logoFileId = o.logoFileId;
    if (input.logoFileId !== undefined) {
      if (input.logoFileId === null) logoFileId = null;
      else {
        const f = await files()?.getFile(scope, input.logoFileId);
        if (
          !f ||
          f.projectId !== null ||
          f.status !== 'ready' ||
          !/^image\/(png|jpeg|webp)$/.test(f.mime)
        )
          problems.push({
            path: 'logoFileId',
            message: 'Upload a PNG, JPEG or WebP logo for the company',
          });
        else logoFileId = input.logoFileId;
      }
    }
    if (problems.length)
      throw new AppError('validation_failed', 'Check the highlighted fields.', problems);

    const [row] = await scope.tx
      .update(orgs)
      .set({
        settings: { ...(o.settings as object), branding: next },
        logoFileId,
        version: o.version + 1,
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(orgs.id, o.id))
      .returning();
    return view(row!);
  }

  return { get, update };
}

export type BrandingService = ReturnType<typeof createBrandingService>;
