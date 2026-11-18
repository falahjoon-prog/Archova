import { useLocalSearchParams } from 'expo-router';
import { ToolboxScreen } from '../../../../features/toolbox';

export default function ToolboxRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <ToolboxScreen projectId={projectId} />;
}
