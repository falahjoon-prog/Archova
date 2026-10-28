import { useLocalSearchParams } from 'expo-router';
import { DefectListScreen } from '../../../../features/defects';

export default function DefectsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <DefectListScreen projectId={projectId} />;
}
