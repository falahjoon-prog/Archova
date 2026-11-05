import { useLocalSearchParams } from 'expo-router';
import { MeetingsScreen } from '../../../../features/meetings';

export default function MeetingsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <MeetingsScreen projectId={projectId} />;
}
