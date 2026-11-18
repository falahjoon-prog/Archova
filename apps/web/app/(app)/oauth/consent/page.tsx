import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConsentScreen } from '@/features/partner-apps';

export const metadata: Metadata = { title: 'Approve an app' };

export default function ConsentPage() {
  return (
    <Suspense>
      <ConsentScreen />
    </Suspense>
  );
}
