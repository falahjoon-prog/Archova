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
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <ThemeStyle />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
