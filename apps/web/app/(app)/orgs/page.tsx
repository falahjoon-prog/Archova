import type { Metadata } from 'next';
import { OrgPickerScreen } from '@/features/orgs';

export const metadata: Metadata = { title: 'Your organisations' };

export default function OrgsPage() {
  return <OrgPickerScreen />;
}
