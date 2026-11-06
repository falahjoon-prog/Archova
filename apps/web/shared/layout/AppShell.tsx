'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { webRoutes } from '@archova/routes';
import { NovaIcon } from '@archova/ui/icons';
import { BrandLogo } from './BrandLogo';

export interface NavItem {
  href: string;
  label: string;
}

/** A labelled dropdown of related links, so a long module list doesn't become one scrolling row. */
export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

export type NavEntry = NavItem | NavGroup;

const isGroup = (entry: NavEntry): entry is NavGroup => 'items' in entry;

const isCurrentPath = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** Disclosure menu: click (or Enter/Space) opens it, Escape, an outside click or navigating closes it. */
function NavDropdown({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const current = group.items.some((item) => isCurrentPath(pathname, item.href));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <li ref={ref} className="app-shell__nav-group">
      <button
        type="button"
        className="app-shell__nav-link app-shell__nav-trigger ac-focusable"
        aria-expanded={open}
        aria-current={current ? 'page' : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {group.label}
        <span className="app-shell__nav-caret" aria-hidden="true" />
      </button>
      {open ? (
        <ul className="app-shell__nav-menu">
          {group.items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="app-shell__nav-menu-link ac-focusable"
                aria-current={isCurrentPath(pathname, item.href) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
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
  nav: readonly NavEntry[];
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
  const barRef = useRef<HTMLElement>(null);
  const assistantOpen = assistant?.open ?? false;
  const onAssistantChange = assistant?.onOpenChange;
  const toggleAssistant = assistant ? () => assistant.onOpenChange(!assistant.open) : undefined;

  // The bar is sticky and its height changes with the breakpoint (one to three rows), so sticky things below it
  // (the project sidebar) read `--app-bar-h` instead of guessing.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty('--app-bar-h', `${bar.offsetHeight}px`);
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--app-bar-h');
    };
  }, []);

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
      <header ref={barRef} className="app-shell__bar">
        <div className="app-shell__brand">
          <Link className="app-shell__logo ac-focusable" href={webRoutes.orgPicker()}>
            <BrandLogo height={36} />
          </Link>
          <span className="app-shell__org" title="Organisation">
            {orgName}
          </span>
        </div>
        <nav aria-label="Primary" className="app-shell__nav">
          <ul>
            {nav.map((entry) => {
              if (isGroup(entry)) {
                return <NavDropdown key={entry.label} group={entry} pathname={pathname} />;
              }
              const current = isCurrentPath(pathname, entry.href);
              return (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    className="app-shell__nav-link ac-focusable"
                    aria-current={current ? 'page' : undefined}
                  >
                    {entry.label}
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
              aria-label={assistant.label}
              aria-expanded={assistantOpen}
              aria-controls="assistant-panel"
              aria-keyshortcuts="Control+J Meta+J"
              onClick={toggleAssistant}
            >
              <NovaIcon size={16} />
              <span className="app-shell__assistant-label">{assistant.label}</span>
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
        <p className="centred-shell__brand">
          <BrandLogo height={32} />
        </p>
        {children}
      </main>
    </div>
  );
}
