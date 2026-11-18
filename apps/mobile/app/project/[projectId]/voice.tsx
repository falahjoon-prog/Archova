import { useLocalSearchParams } from 'expo-router';
import { VoiceScreen } from '../../../features/voice';

export default function VoiceRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <VoiceScreen projectId={projectId} />;
}
