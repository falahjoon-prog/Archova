'use client';

import { useRouter } from 'next/navigation';
import { webRoutes } from '@archova/routes';
import { needsFullNavigation, safeNextPath } from '@/shared/lib/safe-next';

/** After sign-in or sign-up: go to the validated `next`, or the organisation picker. */
export function useRedirectAfterSignIn(next: string | undefined) {
  const router = useRouter();
  return () => {
    const target = safeNextPath(next, webRoutes.orgPicker());
    if (needsFullNavigation(target)) window.location.assign(target);
    else router.replace(target);
  };
}
