import type { Metadata } from 'next';
import { MeetingScreen } from '@/features/meetings';

export const metadata: Metadata = { title: 'Minutes' };

export default async function MeetingPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  return <MeetingScreen meetingId={decodeURIComponent(meetingId)} />;
}
