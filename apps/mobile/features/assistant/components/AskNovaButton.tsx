import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@archova/ui-native';

/** Header button that opens Ask Nova with the screen's context. */
export function AskNovaButton({ projectId }: { projectId?: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask Nova"
      testID="ask-nova"
      hitSlop={12}
      onPress={() =>
        router.push({ pathname: '/assistant', params: projectId ? { projectId } : {} })
      }
      style={{
        paddingHorizontal: t.space[4],
        minHeight: t.touchTarget.default,
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: t.color.actionPrimary, fontSize: t.font.size.md }}>Ask Nova</Text>
    </Pressable>
  );
}
