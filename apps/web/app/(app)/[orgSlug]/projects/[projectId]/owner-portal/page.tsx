import type { Metadata } from 'next';
import { OwnerPortalScreen } from '@/features/owner-portal';

export const metadata: Metadata = { title: 'Owner portal' };

export default function OwnerPortalPage() {
  return <OwnerPortalScreen />;
}
