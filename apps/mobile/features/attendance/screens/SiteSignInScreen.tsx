// Scan the gate's QR to sign in, or sign out (workforce ATT-US1). Needs a connection for now.
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ApiError } from '@archova/api-client';
import { uuidv7 } from '@archova/domain';
import { Button, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { signInAtGate, signOutOfSite } from '../commands';
import { parseGateCode, signInMessage, type SignInMessage } from '../gate';

type Attempt =
  | { kind: 'scan' }
  | { kind: 'working' }
  | { kind: 'done'; message: SignInMessage }
  | { kind: 'failed'; message: string; retry: () => void };

function failureText(e: unknown): string {
  if (e instanceof ApiError && e.status !== 0 && e.status < 500) return e.message;
  return 'Could not reach the server. Check your connection and try again.';
}

export function SiteSignInScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const [permission, requestPermission] = useCameraPermissions();
  const [attempt, setAttempt] = useState<Attempt>({ kind: 'scan' });
  // The camera reports the same code many times a second; only the first starts a sign-in.
  const scanning = useRef(true);

  if (!orgId) {
    return (
      <Screen title="Site sign-in">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  const target = { orgId, projectId };

  const run = (call: (idempotencyKey: string, clientAt: string) => Promise<SignInMessage>) => {
    const key = uuidv7();
    const clientAt = new Date().toISOString();
    const go = () => {
      setAttempt({ kind: 'working' });
      call(key, clientAt).then(
        (message) => setAttempt({ kind: 'done', message }),
        (e: unknown) => setAttempt({ kind: 'failed', message: failureText(e), retry: go }),
      );
    };
    go();
  };

  const scanAgain = () => {
    scanning.current = true;
    setAttempt({ kind: 'scan' });
  };

  const onScanned = (data: string) => {
    if (!scanning.current) return;
    const gateCode = parseGateCode(data);
    scanning.current = false;
    if (!gateCode) {
      setAttempt({
        kind: 'failed',
        message: 'That is not a site sign-in code.',
        retry: scanAgain,
      });
      return;
    }
    run(async (idempotencyKey, clientAt) =>
      signInMessage(await signInAtGate(api, target, { gateCode, idempotencyKey, clientAt })),
    );
  };

  const signOut = () =>
    run(async (idempotencyKey, clientAt) => {
      await signOutOfSite(api, target, { idempotencyKey, clientAt });
      return { tone: 'success', title: 'Signed out', detail: null };
    });

  if (attempt.kind === 'working') {
    return (
      <Screen title="Site sign-in">
        <StateMessage loading message="Signing in" />
      </Screen>
    );
  }
  if (attempt.kind === 'failed') {
    return (
      <Screen title="Site sign-in">
        <StateMessage tone="danger" message={attempt.message} onRetry={attempt.retry} />
      </Screen>
    );
  }
  if (attempt.kind === 'done') {
    const m = attempt.message;
    const color =
      m.tone === 'success'
        ? t.color.statusSuccess
        : m.tone === 'warning'
          ? t.color.statusWarning
          : t.color.statusDanger;
    return (
      <Screen title="Site sign-in">
        <Text style={[styles.title, { color }]}>{m.title}</Text>
        {m.detail ? <Text style={{ color: t.color.text }}>{m.detail}</Text> : null}
        <Button label="Done" onPress={scanAgain} />
      </Screen>
    );
  }
  if (!permission) {
    return (
      <Screen title="Site sign-in">
        <StateMessage loading message="Checking camera access" />
      </Screen>
    );
  }
  if (!permission.granted) {
    return (
      <Screen title="Site sign-in">
        <StateMessage message="Archova needs the camera to scan the sign-in code at the gate." />
        <Button label="Allow camera" onPress={() => void requestPermission()} />
        <Button label="Sign out of site" variant="secondary" onPress={signOut} />
      </Screen>
    );
  }
  return (
    <Screen title="Site sign-in">
      <Text style={{ color: t.color.text }}>Point the camera at the code on the site gate.</Text>
      <View style={styles.camera}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => onScanned(data)}
        />
      </View>
      <Button label="Sign out of site" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700' },
  camera: { height: 320, borderRadius: 12, overflow: 'hidden' },
});
