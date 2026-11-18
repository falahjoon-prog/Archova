import { useLocalSearchParams } from 'expo-router';
import { ToolboxTalkScreen } from '../../../../features/toolbox';

export default function ToolboxTalkRoute() {
  const { projectId, talkId } = useLocalSearchParams<{ projectId: string; talkId: string }>();
  return <ToolboxTalkScreen projectId={projectId} talkId={talkId} />;
}
