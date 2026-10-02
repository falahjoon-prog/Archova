import type { Metadata } from 'next';
import { NewOrgScreen } from '@/features/orgs';

export const metadata: Metadata = { title: 'New organisation' };

export default function NewOrgPage() {
  return <NewOrgScreen />;
}
