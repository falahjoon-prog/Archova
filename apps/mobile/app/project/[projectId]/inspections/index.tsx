import { useLocalSearchParams } from 'expo-router';
import { InspectionListScreen } from '../../../../features/inspections';

export default function InspectionsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <InspectionListScreen projectId={projectId} />;
}
