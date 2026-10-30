// Raise a defect (DEF-US1, DEF-AC1, DEF-AC3). Saves to the device at once, with no signal; photos are taken
// on the defect straight after.
import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { DEFECT_PRIORITIES, DEFECT_STAGES, uuidv7 } from '@archova/domain';
import { mobileRoutes } from '@archova/routes';
import { isLocalDate } from '@archova/time';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { StateMessage, useDeviceData, useLocalQuery } from '../../../shared';
import type { SheetPlacement } from '../placement';
import { createDefect, type CommandError } from '../commands';
import { stageLabel } from './labels';

interface Option {
  id: string;
  name: string;
}

const errorText: Partial<Record<CommandError, string>> = {
  'defect.title_required': 'Add a short title.',
  'defect.location_required': 'Pick a location, or drop a pin on a drawing.',
};

export function NewDefectScreen({
  projectId,
  placement = null,
}: {
  projectId: string;
  /** Set when raised from the drawing viewer: the defect is pinned there. */
  placement?: SheetPlacement | null;
}) {
  const t = useTheme();
  const router = useRouter();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [trade, setTrade] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [priority, setPriority] = useState<(typeof DEFECT_PRIORITIES)[number]>('medium');
  const [stage, setStage] = useState<(typeof DEFECT_STAGES)[number]>('pre_pc');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Locations and companies arrive with the project's sync (platform.project_locations, project companies).
  const locations = useLocalQuery(
    data
      ? async () =>
          (await data.store.listRecords<Option>('project_location', projectId)).map((r) => r.data)
      : null,
    [data, projectId],
  );
  const companies = useLocalQuery(
    data
      ? async () =>
          (await data.store.listRecords<Option>('project_company', projectId)).map((r) => r.data)
      : null,
    [data, projectId],
  );

  if (!data) {
    return (
      <Screen title="Raise defect">
        <StateMessage loading={device.status === 'opening'} message="Opening device storage" />
      </Screen>
    );
  }

  const save = async () => {
    if (dueDate && !isLocalDate(dueDate)) {
      setError('Enter the due date as YYYY-MM-DD.');
      return;
    }
    setSaving(true);
    const clientAt = new Date().toISOString();
    const result = await createDefect(data.store, {
      defectId: uuidv7(),
      mutationId: uuidv7(),
      projectId,
      title,
      description,
      trade: trade.trim() || null,
      priority,
      stage,
      assigneeCompanyId: companyId,
      dueDate: dueDate || null,
      locationId,
      sheetId: placement?.sheetId ?? null,
      drawingRevisionId: placement?.drawingRevisionId ?? null,
      pinX: placement?.pinX ?? null,
      pinY: placement?.pinY ?? null,
      clientAt,
    });
    setSaving(false);
    if (!result.ok) {
      setError(errorText[result.code] ?? 'The defect could not be saved.');
      return;
    }
    data.requestSync('local_write');
    router.replace(mobileRoutes.defect(projectId, result.value.defect.id));
  };

  return (
    <Screen title="Raise defect">
      {placement ? (
        <Text style={{ color: t.color.textSecondary }}>
          Pinned on the drawing you were viewing.
        </Text>
      ) : null}
      <TextField label="Title" value={title} onChangeText={setTitle} autoFocus />
      <TextField label="Description" value={description} onChangeText={setDescription} multiline />
      <TextField label="Trade" value={trade} onChangeText={setTrade} />
      <TextField
        label="Due date"
        value={dueDate}
        onChangeText={setDueDate}
        hint="YYYY-MM-DD, in the project's time zone"
        keyboardType="numbers-and-punctuation"
      />

      <Text style={{ color: t.color.text, fontSize: t.font.size.sm }}>Location</Text>
      {(locations.value ?? []).length === 0 ? (
        <StateMessage message="Locations appear here once this project has synced to the device." />
      ) : (
        (locations.value ?? []).map((l) => (
          <ListItem
            key={l.id}
            title={l.name}
            selected={locationId === l.id}
            onPress={() => setLocationId(l.id)}
          />
        ))
      )}

      <Text style={{ color: t.color.text, fontSize: t.font.size.sm }}>Responsible company</Text>
      {(companies.value ?? []).map((c) => (
        <ListItem
          key={c.id}
          title={c.name}
          selected={companyId === c.id}
          onPress={() => setCompanyId(companyId === c.id ? null : c.id)}
        />
      ))}

      <Text style={{ color: t.color.text, fontSize: t.font.size.sm }}>Priority</Text>
      {DEFECT_PRIORITIES.map((p) => (
        <ListItem
          key={p}
          title={p[0]!.toUpperCase() + p.slice(1)}
          selected={priority === p}
          onPress={() => setPriority(p)}
        />
      ))}

      <Text style={{ color: t.color.text, fontSize: t.font.size.sm }}>Stage</Text>
      {DEFECT_STAGES.map((s) => (
        <ListItem
          key={s}
          title={stageLabel[s]}
          selected={stage === s}
          onPress={() => setStage(s)}
        />
      ))}

      {error ? (
        <Text accessibilityRole="alert" style={{ color: t.color.statusDanger }}>
          {error}
        </Text>
      ) : null}
      <Button label="Save defect" onPress={() => void save()} loading={saving} />
    </Screen>
  );
}
