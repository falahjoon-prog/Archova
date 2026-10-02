import { useLocalSearchParams } from 'expo-router';
import { AssistantScreen } from '../features/assistant';

export default function AssistantRoute() {
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  return <AssistantScreen projectId={projectId} />;
}
