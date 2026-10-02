import { useRouter, useLocalSearchParams } from 'expo-router';
import { pendingCreateMutation } from '../../../../../features/defects';
import { CaptureScreen } from '../../../../../features/photos';
import { useDeviceData } from '../../../../../shared';

export default function DefectPhotoRoute() {
  const router = useRouter();
  const device = useDeviceData();
  const { projectId, defectId, purpose } = useLocalSearchParams<{
    projectId: string;
    defectId: string;
    purpose?: string;
  }>();
  return (
    <CaptureScreen
      projectId={projectId}
      defectId={defectId}
      purpose={purpose === 'after' ? 'after' : 'before'}
      dependsOn={async () =>
        device.status === 'ready' ? pendingCreateMutation(device.data.store, defectId) : []
      }
      onSaved={() => router.back()}
    />
  );
}
