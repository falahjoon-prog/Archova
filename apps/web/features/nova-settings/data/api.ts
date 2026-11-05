import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type AiSettings = components['schemas']['AiSettings'];
export type AiUsage = components['schemas']['AiUsage'];
export type AiFeature = components['schemas']['AiFeature'];
export type UpdateAiSettings = components['schemas']['UpdateAiSettingsRequest'];

export const AI_FEATURES: AiFeature[] = [
  'ask',
  'drawing_register',
  'drawing_compare',
  'rfi_draft',
  'diary_summary',
  'defect_tagging',
  'safety_hazards',
  'minutes',
  'estimating',
  'contract_review',
];

export const FEATURE_LABELS: Record<string, string> = {
  ask: 'Ask Nova',
  drawing_register: 'Drawing register',
  drawing_compare: 'Drawing compare',
  rfi_draft: 'RFI drafts',
  diary_summary: 'Diary summaries',
  defect_tagging: 'Defect tagging',
  safety_hazards: 'Site photo hazard signals',
  minutes: 'Meeting minutes',
  estimating: 'Estimating',
  contract_review: 'Contract review',
};

export function createNovaSettingsApi(orgId: string) {
  return {
    async settings(): Promise<AiSettings> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/ai/settings', { params: { path: { orgId } } }));
    },
    async usage(): Promise<AiUsage> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/ai/usage', { params: { path: { orgId } } }));
    },
    async update(current: AiSettings, patch: UpdateAiSettings): Promise<AiSettings> {
      return unwrap(
        await api.PATCH('/v1/orgs/{orgId}/ai/settings', {
          params: { path: { orgId }, header: { 'If-Match': `"${current.version}"` } },
          body: patch,
        }),
      );
    },
  };
}
