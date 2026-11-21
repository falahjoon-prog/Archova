import { useLocalSearchParams } from 'expo-router';
import { PretaskScreen } from '../../../../features/pretask';

export default function PretaskRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <PretaskScreen projectId={projectId} />;
}
