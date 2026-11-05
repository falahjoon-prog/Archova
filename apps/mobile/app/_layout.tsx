import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '@archova/ui-native';
import { AppProviders, useSession } from '../shared';

function RootNavigator() {
  const t = useTheme();
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.color.bg,
        }}
      >
        <ActivityIndicator color={t.color.actionPrimary} accessibilityLabel="Loading" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: t.color.surface },
        headerTintColor: t.color.text,
        contentStyle: { backgroundColor: t.color.bg },
      }}
    >
      <Stack.Protected guard={status === 'signed_in'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="project/[projectId]/index"
          options={{ headerShown: true, title: 'Project' }}
        />
        <Stack.Screen name="offline" options={{ headerShown: true, title: 'Offline data' }} />
        <Stack.Screen
          name="project/[projectId]/diary"
          options={{ headerShown: true, title: 'Site diary' }}
        />
        <Stack.Screen
          name="project/[projectId]/sign-in/index"
          options={{ headerShown: true, title: 'Site sign-in' }}
        />
        <Stack.Screen
          name="project/[projectId]/induction/index"
          options={{ headerShown: true, title: 'Site induction' }}
        />
        <Stack.Screen
          name="project/[projectId]/roll-call/index"
          options={{ headerShown: true, title: 'Roll call' }}
        />
        <Stack.Screen
          name="project/[projectId]/drawings/index"
          options={{ headerShown: true, title: 'Drawings' }}
        />
        <Stack.Screen
          name="project/[projectId]/drawings/[revisionId]/index"
          options={{ headerShown: true, title: 'Drawing' }}
        />
        <Stack.Screen
          name="project/[projectId]/defects/index"
          options={{ headerShown: true, title: 'Defects' }}
        />
        <Stack.Screen
          name="project/[projectId]/defects/new"
          options={{ headerShown: true, title: 'Raise defect' }}
        />
        <Stack.Screen
          name="project/[projectId]/defects/[defectId]/index"
          options={{ headerShown: true, title: 'Defect' }}
        />
        <Stack.Screen
          name="project/[projectId]/defects/[defectId]/photo"
          options={{ headerShown: true, title: 'Photo' }}
        />
        <Stack.Screen
          name="assistant"
          options={{ presentation: 'modal', headerShown: true, title: 'Ask Nova' }}
        />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signed_out'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Screen name="oauth/callback" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="auto" />
      <RootNavigator />
    </AppProviders>
  );
}
