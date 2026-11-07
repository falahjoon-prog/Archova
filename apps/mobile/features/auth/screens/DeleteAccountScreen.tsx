import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { Button, Screen, TextField, useTheme } from '@archova/ui-native';
import { api, queries } from '../../../lib/api';
import { deleteOrgDatabase } from '../../../lib/db/open';
import { expoSqlDriver } from '../../../lib/db/expo-driver';
import { useSession } from '../../../shared';
import { deleteAccount, type DeleteAccountOutcome } from '../../../lib/auth/delete-account';

export function DeleteAccountScreen() {
  const t = useTheme();
  const router = useRouter();
  const { signIn, signOut } = useSession();
  const me = useQuery(queries.me());
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DeleteAccountOutcome | null>(null);
  const body = { color: t.color.textSecondary, fontSize: t.font.size.md };

  async function onDelete() {
    setBusy(true);
    setOutcome(null);
    const orgIds = me.data?.memberships.map((m) => m.orgId) ?? [];
    const result = await deleteAccount(() => api.DELETE('/v1/me', { body: { confirm: 'DELETE' } }));
    if (result.status === 'deleted') {
      // The account is gone: end the session, then remove every organisation's encrypted database from this phone.
      await signOut();
      await new Promise((resolve) => setTimeout(resolve, 250));
      for (const orgId of orgIds) {
        await deleteOrgDatabase(orgId, null, {
          driver: expoSqlDriver,
          keys: SecureStore,
          keyOptions: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
        }).catch(() => undefined);
      }
      return;
    }
    setOutcome(result);
    setBusy(false);
  }

  async function onSignInAgain() {
    setBusy(true);
    try {
      const result = await signIn({ fresh: true });
      setOutcome(result.status === 'error' ? { status: 'error', message: result.message } : null);
    } catch {
      setOutcome({ status: 'error', message: 'Could not reach Archova. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Delete account">
      <Text style={body}>
        This permanently deletes your Archova account and removes your access to every organisation
        and project. Work you recorded, such as diary entries, defects and sign-ins, stays on the
        project as the law requires and will show as "Deleted user". Everything saved on this phone
        is erased, including changes that have not been sent yet.
      </Text>
      <Text style={body}>
        You can sign up again later with the same email, but your old access is not restored.
      </Text>
      {outcome?.status === 'sole_owner' ? (
        <Text style={{ ...body, color: t.color.statusDanger }} testID="delete-blocked-owner">
          You are the only owner of {outcome.orgs.map((o) => o.name).join(', ')}. Make someone else
          an owner first, then come back.
        </Text>
      ) : null}
      {outcome?.status === 'org_on_hold' ? (
        <Text style={{ ...body, color: t.color.statusDanger }} testID="delete-blocked-hold">
          Your organisation can't be closed right now. Contact Archova support to finish deleting
          your account.
        </Text>
      ) : null}
      {outcome?.status === 'error' ? (
        <Text style={{ ...body, color: t.color.statusDanger }} testID="delete-error">
          {outcome.message}
        </Text>
      ) : null}
      {outcome?.status === 'needs_recent_sign_in' ? (
        <>
          <Text style={body} testID="delete-needs-sign-in">
            For your security, sign in again before deleting your account.
          </Text>
          <Button
            label="Sign in again"
            onPress={onSignInAgain}
            loading={busy}
            testID="delete-sign-in-again"
          />
        </>
      ) : (
        <>
          <TextField
            label="Type DELETE to confirm"
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            testID="delete-confirm-input"
          />
          <Button
            label="Delete my account"
            variant="danger"
            onPress={onDelete}
            loading={busy}
            disabled={typed.trim() !== 'DELETE'}
            testID="delete-account-button"
          />
        </>
      )}
      <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
