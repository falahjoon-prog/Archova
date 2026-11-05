// The person's own, unpublished markups on this sheet, with the three things they can still do to one: take off the
// last stroke, publish it to the project (one-way, so it asks first), or delete it. All of it works with no signal.
import { useState } from 'react';
import { Text, View } from 'react-native';
import type { Markup } from '@archova/contracts';
import { Button, useTheme } from '@archova/ui-native';

export function MyMarkups({
  markups,
  busy,
  onRemoveLastStroke,
  onPublish,
  onDelete,
}: {
  markups: readonly Markup[];
  busy: boolean;
  onRemoveLastStroke: (m: Markup) => void;
  onPublish: (m: Markup) => void;
  onDelete: (m: Markup) => void;
}) {
  const t = useTheme();
  const [confirming, setConfirming] = useState<string | null>(null);
  if (markups.length === 0) return null;
  return (
    <View style={{ gap: t.space[2] }}>
      <Text style={{ color: t.color.text }}>Your markups on this sheet</Text>
      {markups.map((m, i) => (
        <View key={m.id} style={{ gap: t.space[1] }}>
          <Text style={{ color: t.color.textSecondary }}>
            {`Markup ${i + 1}: ${m.shapes.length} ${m.shapes.length === 1 ? 'stroke' : 'strokes'}, ${
              m.visibility === 'private' ? 'only you can see it' : 'shared with your company'
            }`}
          </Text>
          {confirming === m.id ? (
            <>
              <Text style={{ color: t.color.text }}>
                Publish this markup to the project? Everyone on the project will see it and it can
                not be taken back.
              </Text>
              <Button
                label="Publish to the project"
                disabled={busy}
                onPress={() => {
                  setConfirming(null);
                  onPublish(m);
                }}
              />
              <Button label="Cancel" variant="secondary" onPress={() => setConfirming(null)} />
            </>
          ) : (
            <>
              {m.shapes.length > 1 ? (
                <Button
                  label="Remove last stroke"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => onRemoveLastStroke(m)}
                />
              ) : null}
              <Button
                label="Publish to the project"
                variant="secondary"
                disabled={busy}
                onPress={() => setConfirming(m.id)}
              />
              <Button
                label="Delete markup"
                variant="danger"
                disabled={busy}
                onPress={() => onDelete(m)}
              />
            </>
          )}
        </View>
      ))}
    </View>
  );
}
