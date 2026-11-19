import { useLocalSearchParams } from 'expo-router';
import { PhotosScreen } from '../../../../features/photos';

export default function PhotosRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <PhotosScreen projectId={projectId} />;
}
