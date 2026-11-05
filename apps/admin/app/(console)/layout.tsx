'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button, SkeletonRows } from '@archova/ui';
import { ApiError, api } from '@/shared/api';
import { BrandLogo } from '@/shared/BrandLogo';
import { StaffContext } from '@/shared/staff';

const NAV = [
  { href: '/', label: 'Overview', permission: null },
  { href: '/customers', label: 'Customers', permission: 'backoffice.customers.read' },
  { href: '/plans', label: 'Plans', permission: 'backoffice.pricing.read' },
  { href: '/pricing', label: 'Price book', permission: 'backoffice.pricing.read' },
  { href: '/flags', label: 'Flags and pilots', permission: 'backoffice.flags.read' },
  { href: '/approvals', label: 'Approvals', permission: 'backoffice.requests.read' },
  { href: '/staff', label: 'Staff', permission: 'backoffice.staff.read' },
] as const;

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  async function signOut() {
    await api.logout().catch(() => undefined);
    qc.clear();
    router.replace('/login');
  }

  const staff = me.data;
  const isCurrent = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="shell__bar">
        <div className="shell__brand">
          <BrandLogo height={22} />
          <span className="shell__brand-label">Owner console</span>
        </div>
        {staff ? (
          <div className="shell__user">
            <span className="shell__user-name" title={staff.email}>
              {staff.name}
            </span>
            <Button
              variant="tertiary"
              size="sm"
              className="shell__signout"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </div>
        ) : null}
        <nav aria-label="Console" className="shell__nav">
          {NAV.filter((n) => !n.permission || staff?.permissions.includes(n.permission)).map(
            (n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isCurrent(n.href) ? 'page' : undefined}
              >
                {n.label}
              </Link>
            ),
          )}
        </nav>
      </header>
      <main id="main" className="shell__main" tabIndex={-1}>
        <div className="page">
          {staff ? (
            <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>
          ) : me.isError && !unauthenticated ? (
            <p role="alert">
              {me.error instanceof Error ? me.error.message : 'Could not load the console.'}
            </p>
          ) : (
            <SkeletonRows rows={4} />
          )}
        </div>
      </main>
    </div>
  );
}
