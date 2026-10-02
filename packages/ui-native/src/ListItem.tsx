import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontWeight, useTheme } from './theme';

export interface ListItemProps {
  title: string;
  subtitle?: string | null;
  onPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/** Tappable row (44 px minimum). Without `onPress` it renders as plain text. */
export function ListItem({
  title,
  subtitle,
  onPress,
  selected = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ListItemProps) {
  const t = useTheme();
  const body = (
    <View style={styles.text}>
      <Text
        style={{
          color: t.color.text,
          fontSize: t.font.size.md,
          fontWeight: fontWeight(t.font.weight.medium),
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.sm }}>{subtitle}</Text>
      ) : null}
    </View>
  );
  const box = {
    minHeight: t.touchTarget.default,
    paddingHorizontal: t.space[4],
    paddingVertical: t.space[3],
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: selected ? t.color.actionPrimary : t.color.borderDivider,
    backgroundColor: t.color.surface,
  };
  const label = accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title);

  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={label} style={[styles.row, box]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.row, box, { opacity: pressed ? 0.85 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, gap: 2 },
});
