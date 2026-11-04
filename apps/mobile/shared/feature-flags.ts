import { useQuery } from '@tanstack/react-query';
import { queries } from '../lib/api';
import { useCurrentOrg } from './org';

/**
 * Whether a feature flag is on for the current org (backend 09 §5). Off while loading, offline with nothing cached,
 * and on any error. The server enforces the same flag on the routes it gates; this only hides the UI.
 */
export function useFeatureFlag(key: string): boolean {
  const { orgId } = useCurrentOrg();
  const flags = useQuery({ ...queries.featureFlags(orgId ?? ''), enabled: Boolean(orgId) });
  return flags.data?.flags[key] === true;
}
