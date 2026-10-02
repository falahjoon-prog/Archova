'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Filters, sort, tabs and view modes live in the query string (frontend 02 §1), so a filtered register can be
 * bookmarked and pasted to a colleague. Empty values are removed from the URL. Uses `replace` so filter changes
 * don't flood the back button.
 */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>;

  const set = useCallback(
    (patch: Partial<Record<K, string | null | undefined>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch) as Array<[K, string | null | undefined]>) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  return [values, set] as const;
}
