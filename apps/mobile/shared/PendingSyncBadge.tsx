// Header chip on every tab: how many actions are saved on this phone waiting for a signal, and how many were refused.
import { Text, View } from 'react-native';
import { useTheme } from '@archova/ui-native';
import { syncBadgeText } from '../lib/actions/badge-text';
import { useDeviceData, useLocalQuery } from './device-data';

export function PendingSyncBadge() {
  const t = useTheme();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const counts = useLocalQuery(data ? () => data.actions.counts() : null, [data]);
  const text = counts.value ? syncBadgeText(counts.value) : null;
  if (!text || !counts.value) return null;
  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Sync: ${text}`}
      testID="pending-sync"
      style={{
        paddingHorizontal: t.space[2],
        paddingVertical: t.space[1],
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: counts.value.refused > 0 ? t.color.statusDanger : t.color.statusWarning,
      }}
    >
      <Text style={{ color: t.color.text, fontSize: t.font.size.sm }}>{text}</Text>
    </View>
  );
}
