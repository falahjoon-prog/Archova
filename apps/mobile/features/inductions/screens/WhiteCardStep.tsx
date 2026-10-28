// The white card step of the induction: card number and a photo of the front (and back), taken now.
import { useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ApiError } from '@archova/api-client';
import { uuidv7 } from '@archova/domain';
import { Button, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { createUploadApi } from '../../../lib/files/api';
import { backgroundFileTransfer } from '../../../lib/platform/file-transfer';
import { preparePhoto } from '../../../lib/platform/photo-files';
import type { InductionTarget } from '../commands';
import {
  addWhiteCard,
  cardNumberProblem,
  uploadCredentialPhoto,
  type CredentialPhoto,
} from '../credential';

const MAX_PHOTOS = 2;

export function WhiteCardStep({
  target,
  completionId,
  onAdded,
  onSkip,
}: {
  target: InductionTarget;
  completionId: string;
  onAdded: () => void;
  onSkip: () => void;
}) {
  const t = useTheme();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [number, setNumber] = useState('');
  const [photos, setPhotos] = useState<CredentialPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = number === '' ? null : cardNumberProblem(number);

  const shoot = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 1, exif: false });
      const prepared = await preparePhoto(uuidv7(), shot.uri);
      setPhotos((p) => [...p, prepared].slice(0, MAX_PHOTOS));
    } catch {
      setError('Could not take the photo. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const bad = cardNumberProblem(number);
    if (bad) return setError(bad);
    if (photos.length === 0) return setError('Take a photo of the front of your card.');
    setBusy(true);
    setError(null);
    try {
      const uploads = createUploadApi(api, target.orgId);
      const fileIds: string[] = [];
      for (const photo of photos) {
        const file = await uploadCredentialPhoto(uploads, backgroundFileTransfer, {
          projectId: target.projectId,
          idempotencyKey: uuidv7(),
          photo,
        });
        fileIds.push(file.id);
      }
      await addWhiteCard(api, target, completionId, { number, fileIds });
      onAdded();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status < 500 && e.status !== 0
          ? e.message
          : 'Could not save your card. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={{ color: t.color.text, fontSize: 20, fontWeight: '700' }}>White card</Text>
      <TextField
        label="Card number"
        value={number}
        onChangeText={setNumber}
        autoCapitalize="characters"
      />
      {problem ? <Text style={{ color: t.color.statusDanger }}>{problem}</Text> : null}
      {permission?.granted ? (
        <View style={{ height: 240, overflow: 'hidden', borderRadius: t.radius.md }}>
          <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
        </View>
      ) : (
        <Button label="Allow camera" onPress={() => void requestPermission()} />
      )}
      <View style={{ flexDirection: 'row', gap: t.space[2] }}>
        {photos.map((p) => (
          <Image
            key={p.filename}
            source={{ uri: p.localUri }}
            style={{ width: 96, height: 64, borderRadius: t.radius.sm }}
            accessibilityLabel="Card photo"
          />
        ))}
      </View>
      {error ? <Text style={{ color: t.color.statusDanger }}>{error}</Text> : null}
      <Button
        label={photos.length === 0 ? 'Take photo of front' : 'Take photo of back'}
        variant="secondary"
        disabled={busy || !permission?.granted || photos.length >= MAX_PHOTOS}
        onPress={() => void shoot()}
      />
      <Button label="Save card" disabled={busy} onPress={() => void save()} />
      <Button label="Skip for now" variant="secondary" disabled={busy} onPress={onSkip} />
    </>
  );
}
