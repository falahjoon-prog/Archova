// My digital Safety ID badge: photo, name, company, QR code, emergency contact and what I am cleared for here.
import { useMemo, useRef, useState } from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Rect } from 'react-native-svg';
import { ApiError } from '@archova/api-client';
import { nativeTheme } from '@archova/design-tokens';
import { uuidv7 } from '@archova/domain';
import { Button, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { createUploadApi } from '../../../lib/files/api';
import { backgroundFileTransfer } from '../../../lib/platform/file-transfer';
import { preparePhoto } from '../../../lib/platform/photo-files';
import { uploadCredentialPhoto } from '../../inductions/credential';
import { StateMessage, useCurrentOrg } from '../../../shared';
import {
  badgeKey,
  contactProblem,
  credentialLabel,
  expiryState,
  expiryText,
  fetchBadge,
  initials,
  qrMatrix,
  saveBadgePhoto,
  saveEmergencyContact,
} from '../badge';

const localToday = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status !== 0 && e.status < 500) return e.message;
  return 'Could not reach the server. Check your connection and try again.';
}

/** Always dark on light, whatever the app theme, so a scanner can read it. */
function Qr({ value, size }: { value: string; size: number }) {
  const light = nativeTheme('light').color;
  const matrix = useMemo(() => qrMatrix(value), [value]);
  const quiet = 2;
  const span = matrix.length + quiet * 2;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      accessibilityLabel="Badge QR code"
      testID="badge-qr"
    >
      <Rect width={span} height={span} fill={light.surface} />
      {matrix.flatMap((row, r) =>
        row.map((dark, c) =>
          dark ? (
            <Rect
              key={`${r}-${c}`}
              x={c + quiet}
              y={r + quiet}
              width={1}
              height={1}
              fill={light.text}
            />
          ) : null,
        ),
      )}
    </Svg>
  );
}

export function SafetyBadgeScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  if (!orgId) {
    return (
      <Screen title="Safety ID">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  return <Badge target={{ orgId, projectId }} t={t} />;
}

function Badge({
  target,
  t,
}: {
  target: { orgId: string; projectId: string };
  t: ReturnType<typeof useTheme>;
}) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: badgeKey(target), queryFn: () => fetchBadge(api, target) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', relationship: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const today = localToday();

  const update = (b: unknown) => qc.setQueryData(badgeKey(target), b);

  const saveContact = useMutation({
    mutationFn: (clear: boolean) =>
      saveEmergencyContact(
        api,
        target,
        clear
          ? null
          : {
              name: draft.name,
              phone: draft.phone,
              ...(draft.relationship.trim() ? { relationship: draft.relationship } : {}),
            },
      ),
    onSuccess: (b) => {
      update(b);
      setEditing(false);
      setError(null);
    },
    onError: (e) => setError(errorText(e)),
  });

  const savePhoto = useMutation({
    mutationFn: async () => {
      if (!camera.current) throw new Error('no camera');
      const shot = await camera.current.takePictureAsync({ quality: 1, exif: false });
      const photo = await preparePhoto(uuidv7(), shot.uri);
      const file = await uploadCredentialPhoto(
        createUploadApi(api, target.orgId),
        backgroundFileTransfer,
        { projectId: target.projectId, idempotencyKey: uuidv7(), photo },
      );
      return saveBadgePhoto(api, target, file.id);
    },
    onSuccess: (b) => {
      update(b);
      setShooting(false);
      setError(null);
    },
    onError: (e) => setError(errorText(e)),
  });

  if (query.isPending)
    return (
      <Screen title="Safety ID">
        <StateMessage loading message="Loading your badge" />
      </Screen>
    );
  if (query.isError)
    return (
      <Screen title="Safety ID">
        <StateMessage
          tone="danger"
          message="Could not load your badge. It needs a connection."
          onRetry={() => void query.refetch()}
        />
      </Screen>
    );

  const b = query.data;
  const startEdit = () => {
    setDraft({
      name: b.emergencyContact?.name ?? '',
      relationship: b.emergencyContact?.relationship ?? '',
      phone: b.emergencyContact?.phone ?? '',
    });
    setError(null);
    setEditing(true);
  };
  const submit = () => {
    const bad = contactProblem(draft);
    if (bad) return setError(bad);
    saveContact.mutate(false);
  };

  const card = {
    backgroundColor: t.color.surface,
    borderColor: t.color.borderDivider,
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.space[4],
    gap: t.space[2],
  };
  const h = { color: t.color.text, fontSize: t.font.size.md, fontWeight: '700' as const };
  const small = { color: t.color.textSecondary, fontSize: t.font.size.sm };

  return (
    <Screen title="Safety ID">
      <View style={[card, { alignItems: 'center' }]} testID="badge-card">
        {b.photoUrl ? (
          <Image
            source={{ uri: b.photoUrl }}
            accessibilityLabel="Your photo"
            style={{ width: 120, height: 120, borderRadius: 60 }}
          />
        ) : (
          <View
            style={[styles.avatar, { backgroundColor: t.color.actionPrimary }]}
            accessibilityLabel="No photo yet"
          >
            <Text style={{ color: t.color.actionPrimaryText, fontSize: 40, fontWeight: '700' }}>
              {initials(b.fullName)}
            </Text>
          </View>
        )}
        <Text style={{ color: t.color.text, fontSize: t.font.size.xl, fontWeight: '700' }}>
          {b.fullName}
        </Text>
        {b.companyName ? <Text style={small}>{b.companyName}</Text> : null}
        {b.status === 'inactive' ? (
          <Text style={{ color: t.color.statusDanger, fontWeight: '700' }}>Not active</Text>
        ) : null}
        <Qr value={b.qrValue} size={200} />
        <Text style={small}>Show this at the gate or to your supervisor.</Text>
      </View>

      {shooting ? (
        <View style={card}>
          <View style={{ height: 280, overflow: 'hidden', borderRadius: t.radius.md }}>
            <CameraView ref={camera} style={{ flex: 1 }} facing="front" />
          </View>
          <Button
            label="Take photo"
            onPress={() => savePhoto.mutate()}
            loading={savePhoto.isPending}
            testID="badge-take-photo"
          />
          <Button label="Cancel" variant="secondary" onPress={() => setShooting(false)} />
        </View>
      ) : (
        <Button
          label={b.photoUrl ? 'Change photo' : 'Add a photo'}
          variant="secondary"
          onPress={async () => {
            setError(null);
            if (permission?.granted || (await requestPermission()).granted) setShooting(true);
            else setError('Allow camera access in Settings to take your photo.');
          }}
          testID="badge-photo-button"
        />
      )}

      <View style={card} testID="badge-emergency">
        <Text style={h}>Emergency contact</Text>
        {editing ? (
          <>
            <TextField
              label="Name"
              value={draft.name}
              onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
              autoComplete="name"
            />
            <TextField
              label="Relationship (optional)"
              value={draft.relationship}
              onChangeText={(relationship) => setDraft((d) => ({ ...d, relationship }))}
            />
            <TextField
              label="Phone"
              value={draft.phone}
              onChangeText={(phone) => setDraft((d) => ({ ...d, phone }))}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <Button
              label="Save"
              onPress={submit}
              loading={saveContact.isPending}
              testID="badge-contact-save"
            />
            <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
          </>
        ) : b.emergencyContact ? (
          <>
            <Text style={{ color: t.color.text, fontSize: t.font.size.md }}>
              {b.emergencyContact.name}
              {b.emergencyContact.relationship ? ` (${b.emergencyContact.relationship})` : ''}
            </Text>
            <Text style={small}>{b.emergencyContact.phone}</Text>
            <Button label="Edit" variant="secondary" onPress={startEdit} />
            <Button
              label="Remove"
              variant="secondary"
              onPress={() => saveContact.mutate(true)}
              loading={saveContact.isPending}
            />
          </>
        ) : (
          <>
            <Text style={small}>
              Add someone site staff can call if you are hurt. Only you and the people you show this
              screen to can see it.
            </Text>
            <Button label="Add emergency contact" onPress={startEdit} testID="badge-contact-add" />
          </>
        )}
      </View>

      <View style={card}>
        <Text style={h}>Cards and licences</Text>
        {b.credentials.length === 0 ? (
          <Text style={small}>
            None recorded yet. Your white card is added during the site induction.
          </Text>
        ) : (
          b.credentials.map((c) => {
            const s = expiryState(c.expiresOn, today);
            return (
              <View key={`${c.kind}-${c.numberLast4}`} style={{ gap: 2 }}>
                <Text style={{ color: t.color.text, fontSize: t.font.size.md }}>
                  {credentialLabel(c.kind)} ending {c.numberLast4}
                </Text>
                <Text
                  style={{
                    fontSize: t.font.size.sm,
                    color:
                      s === 'expired'
                        ? t.color.statusDanger
                        : s === 'soon'
                          ? t.color.statusWarning
                          : t.color.textSecondary,
                  }}
                >
                  {expiryText(c.expiresOn, today)}
                  {c.status === 'sighted' ? ' · Sighted by site staff' : ' · Recorded, not checked'}
                </Text>
              </View>
            );
          })
        )}
      </View>

      <View style={card}>
        <Text style={h}>Site inductions</Text>
        {b.inductions.length === 0 ? (
          <Text style={small}>No induction completed on this project yet.</Text>
        ) : (
          b.inductions.map((i) => {
            const s = expiryState(i.expiresOn, today);
            return (
              <View key={`${i.title}-${i.completedAt}`} style={{ gap: 2 }}>
                <Text style={{ color: t.color.text, fontSize: t.font.size.md }}>{i.title}</Text>
                <Text
                  style={{
                    fontSize: t.font.size.sm,
                    color: s === 'expired' ? t.color.statusDanger : t.color.textSecondary,
                  }}
                >
                  Completed {i.completedAt.slice(0, 10)} · {expiryText(i.expiresOn, today)}
                </Text>
              </View>
            );
          })
        )}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={{ color: t.color.statusDanger }}>
          {error}
        </Text>
      ) : null}
      {permission && !permission.granted && !permission.canAskAgain ? (
        <Button
          label="Open Settings"
          variant="secondary"
          onPress={() => void Linking.openSettings()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
