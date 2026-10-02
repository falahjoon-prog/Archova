import { Text } from 'react-native';
import { Screen, useTheme } from '@archova/ui-native';

/** Stand-in for tabs that arrive in later phases (docs/mobile/README.md, Phasing). */
export function Placeholder({ title, description }: { title: string; description: string }) {
  const t = useTheme();
  return (
    <Screen title={title}>
      <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.md }}>{description}</Text>
    </Screen>
  );
}
