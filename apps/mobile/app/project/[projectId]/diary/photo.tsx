import { useRouter, useLocalSearchParams } from 'expo-router';
import { isLocalDate } from '@archova/time';
import { attachDayPhoto } from '../../../../features/diary';
import { CaptureScreen } from '../../../../features/photos';
import { useDeviceData } from '../../../../shared';

/** A photo for the diary day: saved on the device, uploaded later, then added to the day's photos. */
export default function DiaryPhotoRoute() {
  const router = useRouter();
  const device = useDeviceData();
  const { projectId, date, reason } = useLocalSearchParams<{
    projectId: string;
    date: string;
    reason?: string;
  }>();
  return (
    <CaptureScreen
      projectId={projectId}
      keep={async (shot) => {
        if (device.status !== 'ready') throw new Error('Device storage is not open');
        if (!isLocalDate(date)) throw new Error('That date is not valid.');
        const r = await attachDayPhoto(device.data, {
          projectId,
          date,
          amendmentReason: reason ?? null,
          photoId: shot.photoId,
          mutationId: shot.mutationId,
          capture: shot.capture,
          file: shot.file,
          clientAt: shot.clientAt,
        });
        if (!r.ok) throw new Error(r.code);
      }}
      onSaved={() => router.back()}
    />
  );
}
