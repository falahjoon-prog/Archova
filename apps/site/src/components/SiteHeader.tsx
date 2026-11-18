import Link from 'next/link';
import { buttonClassName } from '@archova/ui';
import type { SiteSetting } from '../../payload-types';

const DEFAULT_LINKS = [
  { label: 'Pricing', href: '/pricing' },
  { label: 'Blog', href: '/blog' },
  { label: 'Help', href: '/help' },
];

const APP_URL = process.env.SITE_APP_URL ?? 'https://app.archova.com.au';

export function SiteHeader({ settings }: { settings: SiteSetting }) {
  const links = settings.headerLinks?.length ? settings.headerLinks : DEFAULT_LINKS;
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-header__logo" aria-label="Archova home">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
          <img src="/brand/archova-logo.svg" alt="" height={32} className="logo-light" />
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
          <img src="/brand/archova-logo-reversed.svg" alt="" height={32} className="logo-dark" />
        </Link>
        {/* No script needed: details/summary is the mobile menu. */}
        <details className="site-nav">
          <summary className="site-nav__toggle">Menu</summary>
          <nav aria-label="Main" className="site-nav__list">
            {links.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
            <a href={`${APP_URL}/login`}>Log in</a>
            <Link href="/demo" className={buttonClassName('primary')}>
              Request a demo
            </Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
