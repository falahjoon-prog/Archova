'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Search } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';

/** The magnifier in the top bar: a link to search. Cmd/Ctrl+K opens it from anywhere. */
export function SearchLink() {
  const { orgSlug } = useCurrentOrg();
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        router.push(webRoutes.search(orgSlug));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, orgSlug]);
  return (
    <Link
      className="inbox-link ac-focusable"
      href={webRoutes.search(orgSlug)}
      aria-label="Search"
      aria-keyshortcuts="Control+K Meta+K"
    >
      <Search size={20} strokeWidth={1.5} aria-hidden="true" />
    </Link>
  );
}
