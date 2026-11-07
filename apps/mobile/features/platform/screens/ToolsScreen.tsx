import { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { mobileRoutes } from '@archova/routes';
import { Button, Screen, fontWeight, useTheme } from '@archova/ui-native';
import { StateMessage, useCurrentOrg } from '../../../shared';
import {
  defaultLayout,
  loadLayout,
  moveTool,
  saveLayout,
  setHidden,
  visibleTools,
  type ToolLayout,
} from '../../../lib/tool-layout';
import { gridColumns, TOOLS } from '../../../lib/tools';
import { useMe } from '../hooks';
import { ToolIcon } from './ToolIcon';

const backend = {
  getItemAsync: (key: string) => SecureStore.getItemAsync(key),
  setItemAsync: (key: string, value: string) => SecureStore.setItemAsync(key, value),
};

/** Every project tool as a labelled tile, for the project chosen on Home. */
export function ToolsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { projectId } = useCurrentOrg();
  const { width } = useWindowDimensions();
  const userId = useMe().data?.user.id ?? null;
  const [layout, setLayout] = useState<ToolLayout>(() => defaultLayout(TOOLS));
  const [editing, setEditing] = useState(false);

  // The person's own arrangement, kept on this phone.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadLayout(backend, userId, TOOLS).then((saved) => alive && setLayout(saved));
    return () => {
      alive = false;
    };
  }, [userId]);

  function change(next: ToolLayout) {
    setLayout(next);
    if (userId) void saveLayout(backend, userId, next);
  }

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
  if (editing) {
    const byId = new Map(TOOLS.map((tool) => [tool.id, tool]));
    return (
      <Screen title="Reorder tool list">
        <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.md }}>
          Move tools up or down, or hide the ones you don't use. Only you see this arrangement.
        </Text>
        {layout.order.map((id, index) => {
          const tool = byId.get(id);
          if (!tool) return null;
          const hidden = layout.hidden.includes(id);
          return (
            <View
              key={id}
              testID={`reorder-${id}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space[2],
                padding: t.space[2],
                borderRadius: t.radius.md,
                borderWidth: 1,
                borderColor: t.color.borderDivider,
                backgroundColor: t.color.surface,
                opacity: hidden ? 0.6 : 1,
              }}
            >
              <ToolIcon paths={tool.icon} size={28} color={t.color.actionPrimary} />
              <Text style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}>
                {tool.label}
              </Text>
              <Button
                label="Up"
                variant="secondary"
                disabled={index === 0}
                onPress={() => change(moveTool(layout, id, -1))}
                testID={`up-${id}`}
              />
              <Button
                label="Down"
                variant="secondary"
                disabled={index === layout.order.length - 1}
                onPress={() => change(moveTool(layout, id, 1))}
                testID={`down-${id}`}
              />
              <Button
                label={hidden ? 'Show' : 'Hide'}
                variant="secondary"
                onPress={() => change(setHidden(layout, id, !hidden))}
                testID={`hide-${id}`}
              />
            </View>
          );
        })}
        <Button label="Done" onPress={() => setEditing(false)} testID="reorder-done" />
      </Screen>
    );
  }
  return (
    <Screen title="Tools">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }} testID="tools-grid">
        {visibleTools(TOOLS, layout).map((tool) => (
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
      <Button
        label="Reorder tool list"
        variant="secondary"
        onPress={() => setEditing(true)}
        testID="reorder-tools"
      />
    </Screen>
  );
}
