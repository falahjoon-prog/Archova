'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
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
  /** The panel, its toggle label and open state; omitted where the assistant doesn't apply. */
  assistant?: {
    label: string;
    panel: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const assistantOpen = assistant?.open ?? false;
  const onAssistantChange = assistant?.onOpenChange;
  const toggleAssistant = assistant ? () => assistant.onOpenChange(!assistant.open) : undefined;

  // Cmd/Ctrl+J opens and closes Ask Nova from anywhere (frontend 03 §5).
  useEffect(() => {
    if (!onAssistantChange) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        onAssistantChange(!assistantOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAssistantChange, assistantOpen]);
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
              aria-keyshortcuts="Control+J Meta+J"
              onClick={toggleAssistant}
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
