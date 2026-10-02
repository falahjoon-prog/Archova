import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
} from '@archova/kernel';
import type { AdminService, AiSettings } from '../application/admin';

const toSettingsDto = (s: AiSettings) => ({
  aiEnabled: s.aiEnabled,
  featuresEnabled: s.featuresEnabled as never,
  monthlyCreditCap: s.monthlyCreditCap,
  externalAiEnabled: s.externalAiEnabled,
  retentionDays: s.retentionDays,
  version: s.version,
});

export function aiRoutes(database: Database, admin: AdminService) {
  const ro = { readOnly: true } as const;
  return defineRoutes({
    getAiSettings: async (input) => {
      const s = await database.withTenantTx(
        requireTenant(input),
        (scope) => admin.getSettings(scope),
        ro,
      );
      return { status: 200, body: toSettingsDto(s), headers: { etag: etag(s.version) } };
    },
    updateAiSettings: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const s = await database.withTenantTx(requireTenant(input), (scope) =>
        admin.updateSettings(scope, expected, input.body),
      );
      return { status: 200, body: toSettingsDto(s), headers: { etag: etag(s.version) } };
    },
    getAiUsage: async (input) => {
      const usage = await database.withTenantTx(
        requireTenant(input),
        (scope) => admin.getUsage(scope),
        ro,
      );
      return { status: 200, body: usage };
    },
    submitAiFeedback: async (input) => {
      const runId = decodeId('aiRun', input.params.runId);
      if (!runId) throw new AppError('ai.run.not_found');
      await database.withTenantTx(requireTenant(input), (scope) =>
        admin.submitFeedback(scope, runId, {
          rating: input.body.rating === 'up' ? 1 : -1,
          reason: input.body.reason ?? null,
          comment: input.body.comment ?? null,
        }),
      );
      return { status: 204 };
    },
  });
}
