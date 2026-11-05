import { useRouter, useLocalSearchParams } from 'expo-router';
import { attachItemPhoto, getInspection } from '../../../../../features/inspections';
import { CaptureScreen } from '../../../../../features/photos';
import { useDeviceData } from '../../../../../shared';

/** A photo for one checklist item: saved on the device, uploaded later, then added to the item's answer. */
export default function InspectionItemPhotoRoute() {
  const router = useRouter();
  const device = useDeviceData();
  const { projectId, inspectionId, itemId } = useLocalSearchParams<{
    projectId: string;
    inspectionId: string;
    itemId: string;
  }>();
  return (
    <CaptureScreen
      projectId={projectId}
      keep={async (shot) => {
        if (device.status !== 'ready') throw new Error('Device storage is not open');
        // Read the inspection fresh, so a second photo sees the first.
        const held = await getInspection(device.data.store, inspectionId);
        if (!held) throw new Error('Inspection not found');
        const r = await attachItemPhoto(device.data, {
          inspection: held.inspection,
          itemId,
          photoId: shot.photoId,
          mutationId: shot.mutationId,
          capture: shot.capture,
          file: shot.file,
          clientAt: shot.clientAt,
        });
        if (!r.ok) throw new Error(r.message ?? r.code);
      }}
      onSaved={() => router.back()}
    />
  );
}
