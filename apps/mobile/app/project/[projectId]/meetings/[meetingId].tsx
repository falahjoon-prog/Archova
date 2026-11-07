import { useLocalSearchParams } from 'expo-router';
import { MeetingMinutesScreen } from '../../../../features/meetings';

export default function MeetingRoute() {
  const { projectId, meetingId } = useLocalSearchParams<{ projectId: string; meetingId: string }>();
  return <MeetingMinutesScreen projectId={projectId} meetingId={meetingId} />;
}
