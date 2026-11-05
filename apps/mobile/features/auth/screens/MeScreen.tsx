import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen } from '@archova/ui-native';
import { queries } from '../../../lib/api';
import { StateMessage, useSession } from '../../../shared';

export function MeScreen() {
  const router = useRouter();
  const { signOut } = useSession();
  const me = useQuery(queries.me());
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Screen title="Me">
      {me.isPending ? (
        <StateMessage loading message="Loading your profile" />
      ) : me.isError ? (
        <StateMessage
          tone="danger"
          message="Could not load your profile."
          onRetry={() => void me.refetch()}
        />
      ) : (
        <ListItem title={me.data.user.name} subtitle={me.data.user.email} testID="me-profile" />
      )}
      <ListItem
        title="Offline data"
        subtitle="Projects on this device and changes needing attention"
        onPress={() => router.push(mobileRoutes.offline())}
        testID="offline-data-link"
      />
      <Button
        label="Sign out"
        variant="danger"
        onPress={onSignOut}
        loading={signingOut}
        testID="sign-out-button"
      />
    </Screen>
  );
}
