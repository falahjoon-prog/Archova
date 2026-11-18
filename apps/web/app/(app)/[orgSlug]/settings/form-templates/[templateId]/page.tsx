import type { Metadata } from 'next';
import { TemplateEditScreen } from '@/features/forms';

export const metadata: Metadata = { title: 'Edit form template' };

export default async function FormTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return <TemplateEditScreen templateId={decodeURIComponent(templateId)} />;
}
