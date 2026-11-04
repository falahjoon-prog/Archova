'use client';

import { useQuery } from '@tanstack/react-query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { queries } from '@/shared/lib/api';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';

/**
 * Whether a feature flag is on for the current org (backend 09 §5). Off while loading and on any error, so a new
 * feature never flashes in and then away. The server enforces the same flag on the routes it gates; this only hides
 * the UI. Preview mode has no API, so every flag is on there.
 */
export function useFeatureFlag(key: string): boolean {
  const { orgId } = useCurrentOrg();
  const flags = useQuery({ ...queries.featureFlags(orgId), enabled: !previewDataOnly });
  if (previewDataOnly) return true;
  return flags.data?.flags[key] === true;
}
