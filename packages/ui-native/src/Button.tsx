import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { fontWeight, useTheme } from './theme';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  /** Defaults to `label`. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const t = useTheme();
  const inactive = disabled || loading;
  const bg =
    variant === 'primary'
      ? t.color.actionPrimary
      : variant === 'danger'
        ? t.color.statusDanger
        : t.color.surface;
  const fg = variant === 'secondary' ? t.color.text : t.color.actionPrimaryText;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ disabled: inactive, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: t.touchTarget.default,
          minWidth: t.touchTarget.default,
          paddingHorizontal: t.space[4],
          paddingVertical: t.space[2],
          borderRadius: t.radius.md,
          backgroundColor: bg,
          borderColor: variant === 'secondary' ? t.color.borderControl : bg,
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text
          style={{
            color: fg,
            fontSize: t.font.size.md,
            fontWeight: fontWeight(t.font.weight.semibold),
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
