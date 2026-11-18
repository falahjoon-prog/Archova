import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ThemeStyle } from '@archova/ui';
import { Providers } from '@/shared/Providers';
import '@archova/ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Archova owner console', template: '%s · Archova owner console' },
  description: 'Customers, plans and prices for Archova staff.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: { url: '/brand/app-icon-180.png', sizes: '180x180' },
  },
};

export const viewport: Viewport = { colorScheme: 'light' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU" data-theme="light">
      <head>
        <ThemeStyle />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
