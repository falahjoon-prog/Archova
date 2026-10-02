import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from './theme';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  error?: string | null;
  hint?: string;
}

/** Labelled text input. The visible label doubles as the accessibility label. */
export function TextField({ label, error, hint, ...input }: TextFieldProps) {
  const t = useTheme();
  return (
    <View style={[styles.wrap, { gap: t.space[1] }]}>
      <Text style={{ color: t.color.text, fontSize: t.font.size.sm }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...(hint ? { accessibilityHint: hint } : {})}
        placeholderTextColor={t.color.textMuted}
        {...input}
        style={{
          minHeight: t.touchTarget.default,
          paddingHorizontal: t.space[3],
          borderWidth: 1,
          borderRadius: t.radius.md,
          borderColor: error ? t.color.statusDanger : t.color.borderControl,
          backgroundColor: t.color.surface,
          color: t.color.text,
          fontSize: t.font.size.md,
        }}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: t.color.statusDanger, fontSize: t.font.size.sm }}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.sm }}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { alignSelf: 'stretch' } });
