// Run one inspection's checklist offline: answer items, then sign and submit.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { uuidv7, type ItemResult } from '@archova/domain';
import { Button, Screen, TextField, fontWeight, useTheme } from '@archova/ui-native';
import { StateMessage, useDeviceData, useLocalQuery } from '../../../shared';
import {
  getInspection,
  saveAnswer,
  statusLabel,
  submitInspection,
  type InspectionError,
  type LocalInspection,
  type LocalItem,
} from '../commands';

const errorText: Record<InspectionError, string> = {
  'inspection.not_editable': 'This inspection has been submitted and cannot be changed.',
  'inspection.invalid_answer': 'That answer does not fit this item.',
  'inspection.incomplete': 'Answer every required item before submitting.',
  'inspection.signer_required': 'Type your name to sign.',
  'inspection.item_not_found': 'That item is not on this checklist.',
};

const RESULTS: { result: ItemResult; label: string }[] = [
  { result: 'pass', label: 'Pass' },
  { result: 'fail', label: 'Fail' },
  { result: 'na', label: 'N/A' },
];

export function InspectionScreen({ inspectionId }: { inspectionId: string }) {
  const t = useTheme();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const state = useLocalQuery(data ? () => getInspection(data.store, inspectionId) : null, [
    data,
    inspectionId,
  ]);
  const [error, setError] = useState<string | null>(null);
  const [signer, setSigner] = useState('');
  const [typed, setTyped] = useState<Record<string, string>>({});

  if (!data || state.value === null) {
    return (
      <Screen title="Inspection">
        <StateMessage
          loading={device.status === 'opening' || (data !== null && state.value === null)}
          message="Loading inspection"
        />
      </Screen>
    );
  }
  const { inspection, version } = state.value;
  const editable = inspection.status === 'scheduled' || inspection.status === 'in_progress';
  const answerOf = (itemId: string) =>
    inspection.responses.find((r) => r.templateItemId === itemId);

  const answer = async (
    item: LocalItem,
    a: { value?: string | number | boolean; result?: ItemResult; note?: string },
  ) => {
    setError(null);
    const r = await saveAnswer(data.store, {
      inspection,
      version,
      itemId: item.id,
      answer: a,
      mutationId: uuidv7(),
      clientAt: new Date().toISOString(),
    });
    if (!r.ok) setError(r.message ?? errorText[r.code]);
    else {
      state.refresh();
      data.requestSync('local_write');
    }
  };

  const submit = async () => {
    setError(null);
    const r = await submitInspection(data.store, {
      inspection,
      version,
      signedByName: signer,
      mutationId: uuidv7(),
      clientAt: new Date().toISOString(),
    });
    if (!r.ok) setError(errorText[r.code]);
    else {
      state.refresh();
      data.requestSync('local_write');
    }
  };

  const sections = groupBySection(inspection);
  const muted = { color: t.color.textSecondary, fontSize: t.font.size.sm };
  const choice = (label: string, selected: boolean, onPress: () => void, key: string) => (
    <View key={key} style={{ flex: 1, minWidth: 88 }}>
      <Button
        label={label}
        variant={selected ? 'primary' : 'secondary'}
        disabled={!editable}
        onPress={onPress}
        accessibilityLabel={`${label}${selected ? ', selected' : ''}`}
        testID={`choice-${key}`}
      />
    </View>
  );

  return (
    <Screen title={`${inspection.numberLabel} · ${inspection.title}`}>
      <Text style={muted}>
        {[statusLabel[inspection.status], inspection.location].filter(Boolean).join(' · ')}
        {state.value.pending ? ' · Waiting to sync' : ''}
      </Text>
      {error ? <StateMessage tone="danger" message={error} /> : null}
      {sections.map(([section, items]) => (
        <View key={section || 'general'} style={{ gap: t.space[3] }}>
          {section ? (
            <Text
              accessibilityRole="header"
              style={{
                color: t.color.text,
                fontSize: t.font.size.lg,
                fontWeight: fontWeight(t.font.weight.semibold),
              }}
            >
              {section}
            </Text>
          ) : null}
          {items.map((item) => {
            const a = answerOf(item.id);
            return (
              <View key={item.id} style={{ gap: t.space[2] }} testID={`item-${item.id}`}>
                <Text style={{ color: t.color.text, fontSize: t.font.size.md }}>
                  {item.prompt}
                  {item.required ? ' *' : ''}
                </Text>
                {item.responseType === 'pass_fail_na' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] }}>
                    {RESULTS.map((o) =>
                      choice(
                        o.label,
                        a?.result === o.result,
                        () => void answer(item, { result: o.result }),
                        `${item.id}-${o.result}`,
                      ),
                    )}
                  </View>
                ) : item.responseType === 'yes_no' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] }}>
                    {[true, false].map((v) =>
                      choice(
                        v ? 'Yes' : 'No',
                        a?.value === v,
                        () => void answer(item, { value: v }),
                        `${item.id}-${v}`,
                      ),
                    )}
                  </View>
                ) : item.responseType === 'select' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] }}>
                    {item.options.map((o) =>
                      choice(
                        o,
                        a?.value === o,
                        () => void answer(item, { value: o }),
                        `${item.id}-${o}`,
                      ),
                    )}
                  </View>
                ) : item.responseType === 'photo' ? (
                  <Text style={muted}>
                    Photo items need a connection for now. Add the photo on the web.
                  </Text>
                ) : (
                  <TextField
                    label={
                      item.responseType === 'number'
                        ? 'Number'
                        : item.responseType === 'signature'
                          ? 'Typed name'
                          : 'Answer'
                    }
                    editable={editable}
                    keyboardType={item.responseType === 'number' ? 'numeric' : 'default'}
                    value={
                      typed[item.id] ??
                      (a?.value !== null && a?.value !== undefined ? String(a.value) : '')
                    }
                    onChangeText={(v) => setTyped({ ...typed, [item.id]: v })}
                    onEndEditing={() => {
                      const raw = typed[item.id];
                      if (raw === undefined) return;
                      void answer(item, {
                        value: item.responseType === 'number' ? Number(raw) : raw,
                      });
                    }}
                  />
                )}
                {a?.result === 'fail' || a?.note ? (
                  <TextField
                    label="Note"
                    editable={editable}
                    value={typed[`${item.id}:note`] ?? a?.note ?? ''}
                    onChangeText={(v) => setTyped({ ...typed, [`${item.id}:note`]: v })}
                    onEndEditing={() => {
                      const raw = typed[`${item.id}:note`];
                      if (raw !== undefined) void answer(item, { note: raw });
                    }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      {editable ? (
        <View style={{ gap: t.space[3] }}>
          <Text style={muted}>
            {inspection.missingRequiredItemIds.length > 0
              ? `${inspection.missingRequiredItemIds.length} required item${inspection.missingRequiredItemIds.length === 1 ? '' : 's'} still to answer`
              : 'All required items answered'}
          </Text>
          <TextField label="Sign with your name" value={signer} onChangeText={setSigner} />
          <Button
            label="Sign and submit"
            onPress={() => void submit()}
            disabled={inspection.missingRequiredItemIds.length > 0}
            testID="submit-inspection"
          />
        </View>
      ) : inspection.signedBy ? (
        <Text style={muted}>Signed by {inspection.signedBy.name}</Text>
      ) : null}
    </Screen>
  );
}

function groupBySection(i: LocalInspection): [string, LocalItem[]][] {
  const groups = new Map<string, LocalItem[]>();
  for (const item of [...i.items].sort((a, b) => a.sort - b.sort)) {
    const list = groups.get(item.section) ?? [];
    list.push(item);
    groups.set(item.section, list);
  }
  return [...groups];
}
