import { useLocalSearchParams } from 'expo-router';
import { PretaskNewScreen } from '../../../../features/pretask';

export default function PretaskNewRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <PretaskNewScreen projectId={projectId} />;
}
