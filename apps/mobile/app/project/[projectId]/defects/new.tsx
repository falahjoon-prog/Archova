import { useLocalSearchParams } from 'expo-router';
import { NewDefectScreen } from '../../../../features/defects';

export default function NewDefectRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <NewDefectScreen projectId={projectId} />;
}
