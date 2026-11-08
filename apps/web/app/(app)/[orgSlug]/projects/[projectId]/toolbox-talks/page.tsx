import type { Metadata } from 'next';
import { ToolboxScreen } from '@/features/toolbox';

export const metadata: Metadata = { title: 'Toolbox talks' };

export default function ToolboxTalksPage() {
  return <ToolboxScreen />;
}
