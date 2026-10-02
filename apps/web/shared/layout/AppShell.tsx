'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { webRoutes } from '@archova/routes';

export interface NavItem {
  href: string;
  label: string;
}

/** Signed-in app frame: skip link, top bar with org name, primary nav and account actions. No data fetching. */
export function AppShell({
  orgName,
  nav,
  actions,
  children,
}: {
  orgName: string;
  nav: readonly NavItem[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-shell__bar">
        <div className="app-shell__brand">
          <Link className="app-shell__logo ac-focusable" href={webRoutes.orgPicker()}>
            Archova
          </Link>
          <span className="app-shell__org" title="Organisation">
            {orgName}
          </span>
        </div>
        <nav aria-label="Primary" className="app-shell__nav">
          <ul>
            {nav.map((item) => {
              const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="app-shell__nav-link ac-focusable"
                    aria-current={current ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="app-shell__actions">{actions}</div>
      </header>
      <main id="main" className="app-shell__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

/** Centred single-column frame for sign-in, sign-up and the organisation picker. */
export function CentredShell({ children }: { children: ReactNode }) {
  return (
    <div className="centred-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <main id="main" className="centred-shell__main" tabIndex={-1}>
        <p className="centred-shell__brand">Archova</p>
        {children}
      </main>
    </div>
  );
}
