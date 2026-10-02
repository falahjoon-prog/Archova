import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fontWeight, useTheme } from './theme';

export interface ScreenProps {
  title?: string;
  children?: ReactNode;
  /** Wrap content in a ScrollView. Turn off when the child is itself a list. */
  scroll?: boolean;
  testID?: string;
}

/** Page container with token background, padding and an optional header title. */
export function Screen({ title, children, scroll = true, testID }: ScreenProps) {
  const t = useTheme();
  const header = title ? (
    <Text
      accessibilityRole="header"
      style={{
        color: t.color.text,
        fontSize: t.font.size['2xl'],
        fontWeight: fontWeight(t.font.weight.bold),
        marginBottom: t.space[4],
      }}
    >
      {title}
    </Text>
  ) : null;
  const pad = { padding: t.space[4], gap: t.space[3] };

  return (
    <View testID={testID} style={[styles.fill, { backgroundColor: t.color.bg }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={pad}>
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, pad]}>
          {header}
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
