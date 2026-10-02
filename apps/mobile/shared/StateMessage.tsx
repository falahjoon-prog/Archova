import { ActivityIndicator, Text, View } from 'react-native';
import { Button, useTheme } from '@archova/ui-native';

/** Loading / error / empty states, announced to screen readers. */
export function StateMessage({
  loading,
  message,
  tone = 'neutral',
  onRetry,
}: {
  loading?: boolean;
  message: string;
  tone?: 'neutral' | 'danger';
  onRetry?: () => void;
}) {
  const t = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: t.space[3], paddingVertical: t.space[4] }}>
      {loading ? (
        <ActivityIndicator color={t.color.actionPrimary} accessibilityLabel={message} />
      ) : null}
      <Text
        style={{
          color: tone === 'danger' ? t.color.statusDanger : t.color.textSecondary,
          fontSize: t.font.size.md,
        }}
      >
        {message}
      </Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}
