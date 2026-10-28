import { useLocalSearchParams } from 'expo-router';
import { RollCallScreen } from '../../../../features/attendance';

export default function RollCallRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <RollCallScreen projectId={projectId} />;
}
