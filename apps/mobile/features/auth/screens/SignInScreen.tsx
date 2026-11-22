import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Screen, useTheme } from '@archova/ui-native';
import { useSession } from '../../../shared';

export function SignInScreen() {
  const t = useTheme();
  const { signIn, signInError } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignIn() {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn();
      if (result.status === 'error') setError(result.message);
    } catch {
      // The reason is kept by the session (signInError) so it survives this screen being remounted.
    } finally {
      setBusy(false);
    }
  }

  const shownError = error ?? signInError;

  return (
    <Screen title="Archova">
      <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.md }}>
        Sign in with your Archova account. You will finish signing in in your browser, then return
        here.
      </Text>
      {shownError ? (
        <Text
          accessibilityLiveRegion="assertive"
          style={{ color: t.color.statusDanger, fontSize: t.font.size.md }}
        >
          {shownError}
        </Text>
      ) : null}
      <Button
        label="Sign in"
        onPress={onSignIn}
        loading={busy}
        accessibilityHint="Opens the Archova sign-in page in your browser"
        testID="sign-in-button"
      />
    </Screen>
  );
}
