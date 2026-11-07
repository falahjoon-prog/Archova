import { useLocalSearchParams } from 'expo-router';
import { SafetyBadgeScreen } from '../../../features/attendance';

export default function SafetyBadgeRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <SafetyBadgeScreen projectId={projectId} />;
}
