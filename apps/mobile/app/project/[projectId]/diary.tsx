import { useLocalSearchParams } from 'expo-router';
import { DiaryScreen } from '../../../features/diary';

export default function DiaryRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <DiaryScreen projectId={projectId} />;
}
