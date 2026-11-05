import { useRouter, useLocalSearchParams } from 'expo-router';
import { attachIncidentPhoto, getIncident } from '../../../../../features/incidents';
import { CaptureScreen } from '../../../../../features/photos';
import { useDeviceData } from '../../../../../shared';

/** A photo of the scene: saved on the device, uploaded later, then added to the incident. */
export default function IncidentPhotoRoute() {
  const router = useRouter();
  const device = useDeviceData();
  const { projectId, incidentId } = useLocalSearchParams<{
    projectId: string;
    incidentId: string;
  }>();
  return (
    <CaptureScreen
      projectId={projectId}
      keep={async (shot) => {
        if (device.status !== 'ready') throw new Error('Device storage is not open');
        // Read the incident fresh, so a second photo sees the first.
        const held = await getIncident(device.data.store, incidentId);
        if (!held) throw new Error('Incident not found');
        await attachIncidentPhoto(device.data, {
          incident: held,
          photoId: shot.photoId,
          mutationId: shot.mutationId,
          capture: shot.capture,
          file: shot.file,
          clientAt: shot.clientAt,
        });
      }}
      onSaved={() => router.back()}
    />
  );
}
