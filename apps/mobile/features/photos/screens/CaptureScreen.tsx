// Capture tab: one tap from the tab bar to the shutter (mobile 03 §3.1, design 04 F3). The photo is saved
// to the device at once with its time, zone and GPS fix, and uploads in the background.
import { useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { uuidv7 } from '@archova/domain';
import { Button, Screen, useTheme } from '@archova/ui-native';
import { StateMessage, useCurrentOrg, useDeviceData, useLocalQuery } from '../../../shared';
import { buildCapture, deviceTimeZone, type DevicePosition } from '../../../lib/capture/capture';
import { preparePhoto } from '../../../lib/platform/photo-files';
import { capturePhoto, type LocalPhoto } from '../commands';

const FIX_TIMEOUT_MS = 4_000;

/** A fresh fix if one comes quickly, else the last known one; never blocks the shutter for long. */
async function currentPosition(): Promise<DevicePosition | null> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS));
  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(
    () => null,
  );
  return (await Promise.race([fresh, timeout])) ?? (await Location.getLastKnownPositionAsync());
}

async function compassHeading(): Promise<number | null> {
  try {
    const heading = await Location.getHeadingAsync();
    return heading.trueHeading >= 0 ? heading.trueHeading : null;
  } catch {
    return null;
  }
}

export function CaptureScreen() {
  const t = useTheme();
  const { projectId } = useCurrentOrg();
  const device = useDeviceData();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = device.status === 'ready' ? device.data : null;
  const waiting = useLocalQuery(data ? () => data.uploads.waitingCount() : null, [data]);
  const [last, setLast] = useState<LocalPhoto | null>(null);

  if (device.status === 'error') {
    return (
      <Screen title="Capture">
        <StateMessage tone="danger" message={device.message} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen title="Capture">
        <StateMessage
          loading={device.status === 'opening'}
          message="Choose an organisation on the Home tab first."
        />
      </Screen>
    );
  }
  if (!projectId) {
    return (
      <Screen title="Capture">
        <StateMessage message="Open a project first. Photos are filed against the current project." />
      </Screen>
    );
  }
  if (!permission?.granted) {
    return (
      <Screen title="Capture">
        <StateMessage message="Archova needs the camera to take site photos. Photos stay in the app, not your camera roll." />
        <Button label="Allow camera" onPress={() => void requestPermission()} />
      </Screen>
    );
  }

  const takePhoto = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const takenAt = new Date();
      // Ask for location once; a refusal just leaves the fix out.
      void Location.requestForegroundPermissionsAsync();
      const [shot, position, heading] = await Promise.all([
        camera.current.takePictureAsync({ quality: 1, exif: false }),
        currentPosition(),
        compassHeading(),
      ]);
      const photoId = uuidv7();
      const capture = buildCapture({
        takenAt,
        timeZone: deviceTimeZone(),
        position,
        compassHeading: heading,
      });
      const file = await preparePhoto(photoId, shot.uri);
      const photo = await capturePhoto(data, {
        photoId,
        mutationId: uuidv7(),
        projectId,
        capture,
        clientAt: takenAt.toISOString(),
        file,
      });
      setLast(photo);
      waiting.refresh();
      data.requestSync('local_write');
    } catch {
      setError('The photo could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const count = waiting.value ?? 0;
  return (
    <View style={[styles.fill, { backgroundColor: t.color.bg }]}>
      <CameraView ref={camera} style={styles.fill} facing="back" />
      <View style={[styles.controls, { padding: t.space[4], gap: t.space[3] }]}>
        <Text accessibilityLiveRegion="polite" style={{ color: t.color.text }}>
          {count === 0
            ? 'All photos sent'
            : `${count} ${count === 1 ? 'photo' : 'photos'} waiting to sync`}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: t.color.statusDanger }}>
            {error}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space[3] }}>
          {last ? (
            <Image
              source={{ uri: last.thumbnailUri }}
              style={styles.thumb}
              accessibilityLabel="Last photo taken"
            />
          ) : null}
          <View style={styles.fill}>
            <Button
              label="Take photo"
              onPress={() => void takePhoto()}
              loading={busy}
              accessibilityHint="Saves the photo to this project with the time and location"
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  thumb: { width: 56, height: 56, borderRadius: 8 },
});
