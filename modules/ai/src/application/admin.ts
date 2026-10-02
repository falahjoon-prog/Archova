// Org controls (ai/04 §8), credit usage (ai/05 §6) and feedback (ai/06 §5).
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import { effectiveAllowance } from '../domain/credits';
import { feedback, orgSettings, requests, usageLedger, type FeedbackReason } from '../infra/tables';

export interface AiSettings {
  aiEnabled: boolean;
  featuresEnabled: string[] | null;
  monthlyCreditCap: number | null;
  externalAiEnabled: boolean;
  retentionDays: number;
  version: number;
}

export const DEFAULT_SETTINGS: AiSettings = {
  aiEnabled: true,
  featuresEnabled: null,
  monthlyCreditCap: null,
  externalAiEnabled: true,
  retentionDays: 30,
  version: 0,
};

export type AiSettingsPatch = Partial<Omit<AiSettings, 'version'>>;

export function createAdminService(deps: {
  orgTimeZone: (scope: TenantScope) => Promise<string>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function getSettings(scope: TenantScope): Promise<AiSettings> {
    const [row] = await scope.tx
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.orgId, scope.ctx.orgId))
      .limit(1);
    if (!row) return DEFAULT_SETTINGS;
    return {
      aiEnabled: row.aiEnabled,
      featuresEnabled: row.featuresEnabled,
      monthlyCreditCap: row.monthlyCreditCap,
      externalAiEnabled: row.externalAiEnabled,
      retentionDays: row.retentionDays,
      version: row.version,
    };
  }

  /** Optimistic concurrency: version 0 means "no row yet" (defaults). */
  async function updateSettings(
    scope: TenantScope,
    expectedVersion: number,
    patch: AiSettingsPatch,
  ): Promise<AiSettings> {
    const current = await getSettings(scope);
    if (current.version !== expectedVersion) throw versionConflict();
    const next = { ...current, ...patch };
    const values = {
      aiEnabled: next.aiEnabled,
      featuresEnabled: next.featuresEnabled,
      monthlyCreditCap: next.monthlyCreditCap,
      externalAiEnabled: next.externalAiEnabled,
      retentionDays: next.retentionDays,
      updatedBy: scope.ctx.userId,
    };
    if (expectedVersion === 0) {
      const inserted = await scope.tx
        .insert(orgSettings)
        .values({ orgId: scope.ctx.orgId, ...values, createdBy: scope.ctx.userId })
        .onConflictDoNothing()
        .returning({ version: orgSettings.version });
      if (!inserted.length) throw versionConflict();
    } else {
      const updated = await scope.tx
        .update(orgSettings)
        .set({ ...values, version: sql`${orgSettings.version} + 1` })
        .where(
          and(eq(orgSettings.orgId, scope.ctx.orgId), eq(orgSettings.version, expectedVersion)),
        )
        .returning({ version: orgSettings.version });
      if (!updated.length) throw versionConflict();
    }
    return getSettings(scope);
  }

  /** This month's credits by feature against the allowance (calendar month in the org's zone). */
  async function getUsage(scope: TenantScope) {
    const tz = await deps.orgTimeZone(scope);
    const today = localDateOf(now(), tz);
    const monthStart = `${today.slice(0, 7)}-01`;
    const rows = await scope.tx
      .select({
        feature: usageLedger.feature,
        credits: sql<string>`sum(${usageLedger.credits})`,
        runs: sql<string>`sum(${usageLedger.runs})`,
      })
      .from(usageLedger)
      .where(and(eq(usageLedger.orgId, scope.ctx.orgId), gte(usageLedger.day, monthStart)))
      .groupBy(usageLedger.feature)
      .orderBy(asc(usageLedger.feature));
    const byFeature = rows.map((r) => ({
      feature: r.feature,
      credits: Number(r.credits),
      runs: Number(r.runs),
    }));
    const settings = await getSettings(scope);
    const used = byFeature.reduce((s, f) => s + f.credits, 0);
    const allowance = effectiveAllowance({
      planAllowance: scope.ctx.entitlements.limits['limit.ai_credits'] ?? null,
      orgCap: settings.monthlyCreditCap,
    });
    return {
      periodStart: monthStart,
      timezone: tz,
      allowance,
      used: Math.round(used * 100) / 100,
      remaining: allowance === null ? null : Math.max(0, allowance - used),
      byFeature,
    };
  }

  /** Only the person who ran the request can rate it. */
  async function submitFeedback(
    scope: TenantScope,
    runId: string,
    input: { rating: 1 | -1; reason?: FeedbackReason | null; comment?: string | null },
  ) {
    const [run] = await scope.tx
      .select({ userId: requests.userId })
      .from(requests)
      .where(and(eq(requests.orgId, scope.ctx.orgId), eq(requests.runId, runId)))
      .limit(1);
    if (!run || run.userId !== scope.ctx.userId) throw new AppError('ai.run.not_found');
    await scope.tx
      .insert(feedback)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        runId,
        userId: scope.ctx.userId,
        rating: input.rating,
        reason: input.reason ?? null,
        comment: input.comment ?? null,
      })
      .onConflictDoUpdate({
        target: [feedback.orgId, feedback.runId, feedback.userId],
        set: {
          rating: input.rating,
          reason: input.reason ?? null,
          comment: input.comment ?? null,
          updatedAt: sql`now()`,
        },
      });
  }

  return { getSettings, updateSettings, getUsage, submitFeedback };
}

export type AdminService = ReturnType<typeof createAdminService>;
