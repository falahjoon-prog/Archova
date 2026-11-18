import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ThemeStyle } from '@archova/ui';
import '@archova/ui/styles.css';
import './site.css';
import { SiteFooter } from '../../src/components/SiteFooter';
import { SiteHeader } from '../../src/components/SiteHeader';
import { getSettings, SITE_ORIGIN } from '../../src/lib/cms';

export const dynamic = 'force-dynamic';

export const viewport: Viewport = { colorScheme: 'light' };

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: { default: 'Archova', template: '%s · Archova' },
    description: s.defaultSeoDescription ?? s.tagline,
    icons: { icon: '/favicon.svg' },
  };
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const settings = await getSettings();
  return (
    <html lang="en-AU" data-theme="light">
      <head>
        <ThemeStyle />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteHeader settings={settings} />
        <main id="main" className="container">
          {children}
        </main>
        <SiteFooter settings={settings} />
      </body>
    </html>
  );
}
