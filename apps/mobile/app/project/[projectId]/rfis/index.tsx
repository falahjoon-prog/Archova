import { useLocalSearchParams } from 'expo-router';
import { RfisScreen } from '../../../../features/rfis';

export default function RfisRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <RfisScreen projectId={projectId} />;
}
