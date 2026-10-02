import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Guest pages opened from a link (X45): no app shell, never indexed, and the link isn't sent on as a referrer.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function GuestLayout({ children }: { children: ReactNode }) {
  return children;
}
