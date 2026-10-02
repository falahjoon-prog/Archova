'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { webRoutes } from '@archova/routes';

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Signed-in app frame: skip link, top bar with org name, primary nav and account actions, and the
 * assistant panel slot that every signed-in screen gets (Ask Nova, X27). No data fetching.
 */
export function AppShell({
  orgName,
  nav,
  actions,
  assistant,
  children,
}: {
  orgName: string;
  nav: readonly NavItem[];
  actions?: ReactNode;
  /** The panel and its toggle label; omitted where the assistant doesn't apply. */
  assistant?: { label: string; panel: ReactNode };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [assistantOpen, setAssistantOpen] = useState(false);
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
        <div className="app-shell__actions">
          {assistant ? (
            <button
              type="button"
              className="app-shell__assistant-toggle ac-focusable"
              aria-expanded={assistantOpen}
              aria-controls="assistant-panel"
              onClick={() => setAssistantOpen((o) => !o)}
            >
              {assistant.label}
            </button>
          ) : null}
          {actions}
        </div>
      </header>
      <div className="app-shell__body">
        <main id="main" className="app-shell__main" tabIndex={-1}>
          {children}
        </main>
        {assistant ? (
          <aside
            id="assistant-panel"
            className="app-shell__assistant"
            aria-label={assistant.label}
            hidden={!assistantOpen}
          >
            {assistant.panel}
          </aside>
        ) : null}
      </div>
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
