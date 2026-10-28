import Link from 'next/link';
import type { SiteSetting } from '../../payload-types';

const DEFAULT_LINKS = [
  { label: 'Pricing', href: '/pricing' },
  { label: 'Blog', href: '/blog' },
  { label: 'Help centre', href: '/help' },
  { label: 'Request a demo', href: '/demo' },
];

export function SiteFooter({ settings }: { settings: SiteSetting }) {
  const links = settings.footerLinks?.length ? settings.footerLinks : DEFAULT_LINKS;
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>{settings.tagline}</p>
        <nav aria-label="Footer">
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="muted">© {new Date().getFullYear()} Archova. Your data stays in Australia.</p>
      </div>
    </footer>
  );
}
