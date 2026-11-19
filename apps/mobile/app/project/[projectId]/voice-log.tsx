import { useLocalSearchParams } from 'expo-router';
import { VoiceLogScreen } from '../../../features/voice';

export default function VoiceLogRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <VoiceLogScreen projectId={projectId} />;
}
