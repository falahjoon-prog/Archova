import { useLocalSearchParams } from 'expo-router';
import { DocumentsScreen } from '../../../../features/documents';

export default function DocumentsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <DocumentsScreen projectId={projectId} />;
}
