// What is waiting to be sent from this phone for one submittal or timesheet, and anything the server refused.
import { Text, View } from 'react-native';
import { Button, useTheme } from '@archova/ui-native';
import { ACTION_TEXT } from '../lib/actions/attempt';
import { useDeviceData, useLocalQuery } from './device-data';

export function PendingActions({ targetId }: { targetId: string }) {
  const t = useTheme();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const rows = useLocalQuery(data ? () => data.actions.forTarget(targetId) : null, [
    data,
    targetId,
  ]);
  const items = rows.value ?? [];
  if (!data || items.length === 0) return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: t.space[2] }}>
      {items.map((a) => (
        <View
          key={a.id}
          style={{
            gap: t.space[1],
            padding: t.space[3],
            borderRadius: t.radius.md,
            borderWidth: 1,
            borderColor: a.state === 'refused' ? t.color.statusDanger : t.color.statusWarning,
          }}
        >
          <Text style={{ color: t.color.text, fontWeight: '600' }}>
            {ACTION_TEXT[a.kind]}
            {a.state === 'pending'
              ? ': saved on this phone, will send when online'
              : ': not accepted'}
          </Text>
          {a.state === 'refused' ? (
            <>
              <Text style={{ color: t.color.textSecondary }}>
                The server refused it, so it was not applied. {a.lastError ?? ''}
              </Text>
              <Button
                label="Dismiss"
                variant="secondary"
                onPress={() => void data.actions.discard(a.id).then(rows.refresh)}
              />
            </>
          ) : (
            <Button
              label="Cancel this"
              variant="secondary"
              onPress={() => void data.actions.discard(a.id).then(rows.refresh)}
            />
          )}
        </View>
      ))}
    </View>
  );
}
