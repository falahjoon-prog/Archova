import type { Metadata } from 'next';
import { DocumentRegisterScreen } from '@/features/transmittals';

export const metadata: Metadata = { title: 'Document register' };

export default function DocumentRegisterPage() {
  return <DocumentRegisterScreen />;
}
