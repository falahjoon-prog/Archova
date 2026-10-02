import { Tabs } from 'expo-router';
import { useTheme } from '@archova/ui-native';
import { AskNovaButton } from '../../features/assistant';

// Bottom tabs per design 03 §5 / mobile 01 §1.2: Home, Drawings, Capture (centre), Tools, Me.
const TABS = [
  { name: 'index', title: 'Home' },
  { name: 'drawings', title: 'Drawings' },
  { name: 'capture', title: 'Capture' },
  { name: 'tools', title: 'Tools' },
  { name: 'me', title: 'Me' },
] as const;

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.color.surface },
        headerTintColor: t.color.text,
        tabBarStyle: {
          backgroundColor: t.color.surface,
          borderTopColor: t.color.borderDivider,
          minHeight: t.touchTarget.siteMode,
        },
        tabBarActiveTintColor: t.color.actionPrimary,
        tabBarInactiveTintColor: t.color.textMuted,
        tabBarLabelStyle: { fontSize: t.font.size.sm },
        tabBarIconStyle: { display: 'none' },
        // Ask Nova is one tap away on every tab (X27).
        headerRight: () => <AskNovaButton />,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: `${tab.title} tab`,
            tabBarButtonTestID: `tab-${tab.title.toLowerCase()}`,
          }}
        />
      ))}
    </Tabs>
  );
}
