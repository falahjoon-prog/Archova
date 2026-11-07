import type { Metadata } from 'next';
import { FormDetailScreen } from '@/features/forms';

export const metadata: Metadata = { title: 'Form' };

export default async function FormPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  return <FormDetailScreen formId={decodeURIComponent(formId)} />;
}
