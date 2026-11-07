import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { Button, Screen, fontWeight, useTheme } from '@archova/ui-native';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { gridColumns, TOOLS } from '../../../lib/tools';
import { ToolIcon } from './ToolIcon';

/** Every project tool as a labelled tile, for the project chosen on Home. */
export function ToolsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { projectId } = useCurrentOrg();
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  const gap = t.space[3];
  const tile = Math.floor((width - t.space[4] * 2 - gap * (columns - 1)) / columns);

  if (!projectId) {
    return (
      <Screen title="Tools">
        <StateMessage message="Open a project from Home to see its tools." />
        <Button
          label="Go to Home"
          variant="secondary"
          onPress={() => router.navigate(mobileRoutes.home())}
        />
      </Screen>
    );
  }
  return (
    <Screen title="Tools">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }} testID="tools-grid">
        {TOOLS.map((tool) => (
          <Pressable
            key={tool.id}
            accessibilityRole="button"
            accessibilityLabel={tool.label}
            testID={`tool-${tool.id}`}
            onPress={() => router.push(tool.route(projectId))}
            style={({ pressed }) => ({
              width: tile,
              minHeight: tile,
              alignItems: 'center',
              justifyContent: 'center',
              gap: t.space[2],
              padding: t.space[2],
              borderRadius: t.radius.md,
              borderWidth: 1,
              borderColor: t.color.borderDivider,
              backgroundColor: t.color.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <ToolIcon paths={tool.icon} size={36} color={t.color.actionPrimary} />
            <Text
              style={{
                color: t.color.text,
                fontSize: t.font.size.sm,
                fontWeight: fontWeight(t.font.weight.medium),
                textAlign: 'center',
              }}
            >
              {tool.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
