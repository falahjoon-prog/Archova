// Project inspections from the device store. Works offline; unsent answers say so.
import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { uuidv7 } from '@archova/domain';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { StateMessage, useDeviceData, useLocalQuery } from '../../../shared';
import { listInspections, listTemplates, startInspection, statusLabel } from '../commands';

export function InspectionListScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const t = useTheme();
  const [location, setLocation] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const rows = useLocalQuery(data ? () => listInspections(data.store, projectId) : null, [
    data,
    projectId,
  ]);
  const templates = useLocalQuery(data ? () => listTemplates(data.store, projectId) : null, [
    data,
    projectId,
  ]);

  if (!data) {
    return (
      <Screen title="Inspections">
        <StateMessage loading={device.status === 'opening'} message="Opening device storage" />
      </Screen>
    );
  }
  const items = rows.value ?? [];
  const start = (template: NonNullable<typeof templates.value>[number]) => {
    setStarting(true);
    setError(false);
    startInspection(data.store, {
      template,
      location,
      mutationId: uuidv7(),
      clientAt: new Date().toISOString(),
    })
      .then((r) => {
        if (!r.ok) {
          setError(true);
          return;
        }
        data.requestSync('local_write');
        router.push(mobileRoutes.inspection(projectId, r.value.id));
      })
      .catch(() => setError(true))
      .finally(() => setStarting(false));
  };
  return (
    <Screen title="Inspections">
      {(templates.value ?? []).length > 0 ? (
        <>
          <Text style={{ color: t.color.text }}>Start an inspection</Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="Where (optional)"
            placeholderTextColor={t.color.textSecondary}
            maxLength={200}
            accessibilityLabel="Where the inspection is"
            style={{
              color: t.color.text,
              borderColor: t.color.textSecondary,
              borderWidth: 1,
              borderRadius: t.radius.md,
              padding: t.space[2],
            }}
          />
          {(templates.value ?? []).map((tpl) => (
            <Button
              key={tpl.id}
              label={`Start: ${tpl.name}`}
              variant="secondary"
              disabled={starting}
              onPress={() => start(tpl)}
              testID={`start-${tpl.id}`}
            />
          ))}
          {error ? (
            <Text style={{ color: t.color.statusDanger }}>
              Could not start the inspection on this device. Try again.
            </Text>
          ) : null}
        </>
      ) : null}
      {rows.value !== null && items.length === 0 ? (
        <StateMessage message="No inspections on this device yet. Start one above once the checklists have synced." />
      ) : null}
      {items.map((i) => (
        <ListItem
          key={i.id}
          title={`${i.numberLabel} · ${i.title}`}
          subtitle={[
            statusLabel[i.status],
            i.location,
            i.missingRequiredItemIds.length > 0 && i.status !== 'submitted' && i.status !== 'closed'
              ? `${i.missingRequiredItemIds.length} to answer`
              : null,
            i.pending ? 'Waiting to sync' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          onPress={() => router.push(mobileRoutes.inspection(projectId, i.id))}
          testID={`inspection-${i.id}`}
        />
      ))}
    </Screen>
  );
}
