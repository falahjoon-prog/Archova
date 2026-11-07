import type { Metadata } from 'next';
import { TemplatesScreen } from '@/features/forms';

export const metadata: Metadata = { title: 'Form templates' };

export default function FormTemplatesPage() {
  return <TemplatesScreen />;
}
