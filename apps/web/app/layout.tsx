import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ThemeStyle } from '@archova/ui';
import { Providers } from '@/shared/providers/Providers';
import '@archova/ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Archova', template: '%s · Archova' },
  description: 'Construction project management for Australian builders.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: { url: '/brand/app-icon-180.png', sizes: '180x180' },
  },
};

export const viewport: Viewport = {
  colorScheme: 'light',
};

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
