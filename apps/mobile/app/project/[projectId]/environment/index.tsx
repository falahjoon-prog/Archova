import { useLocalSearchParams } from 'expo-router';
import { EnvironmentScreen } from '../../../../features/environment';

export default function EnvironmentRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <EnvironmentScreen projectId={projectId} />;
}
