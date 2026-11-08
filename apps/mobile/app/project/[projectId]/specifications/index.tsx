import { useLocalSearchParams } from 'expo-router';
import { SpecificationsScreen } from '../../../../features/specifications';

export default function SpecificationsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <SpecificationsScreen projectId={projectId} />;
}
