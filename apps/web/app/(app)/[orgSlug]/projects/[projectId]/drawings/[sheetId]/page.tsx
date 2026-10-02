import type { Metadata } from 'next';
import { DrawingViewerScreen } from '@/features/drawings';

export const metadata: Metadata = { title: 'Drawing' };

/** The route composes the viewer with the tools other features register (frontend 07 §2). */
export default async function DrawingPage({ params }: { params: Promise<{ sheetId: string }> }) {
  const { sheetId } = await params;
  return <DrawingViewerScreen sheetId={decodeURIComponent(sheetId)} />;
}
