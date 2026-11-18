import { useLocalSearchParams } from 'expo-router';
import { DocumentScreen } from '../../../../features/documents';

export default function DocumentsDetailRoute() {
  const { projectId, documentId } = useLocalSearchParams<{
    projectId: string;
    documentId: string;
  }>();
  return <DocumentScreen projectId={projectId} documentId={documentId} />;
}
