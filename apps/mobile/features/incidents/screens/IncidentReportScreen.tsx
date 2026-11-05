// Report an incident from site, and see the reports made on this device. Works offline; unsent reports say so.
import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { uuidv7 } from '@archova/domain';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { StateMessage, useDeviceData, useLocalQuery } from '../../../shared';
import {
  INCIDENT_TYPES,
  incidentTypeLabel,
  listIncidents,
  reportIncident,
  type IncidentType,
} from '../commands';

const problem = {
  'incident.title_required': 'Say briefly what happened.',
  'incident.time_invalid': 'That time is not valid.',
  'incident.in_future': 'The incident cannot be in the future.',
} as const;

export function IncidentReportScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const rows = useLocalQuery(data ? () => listIncidents(data.store, projectId) : null, [
    data,
    projectId,
  ]);
  const [type, setType] = useState<IncidentType>('near_miss');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [immediate, setImmediate] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!data) {
    return (
      <Screen title="Report an incident">
        <StateMessage loading={device.status === 'opening'} message="Opening device storage" />
      </Screen>
    );
  }
  const input = {
    color: t.color.text,
    borderColor: t.color.textSecondary,
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.space[2],
  };
  const submit = () => {
    setSaving(true);
    setMessage(null);
    const now = new Date().toISOString();
    reportIncident(data.store, {
      projectId,
      title,
      type,
      occurredAt: now,
      location,
      description,
      immediateActions: immediate,
      mutationId: uuidv7(),
      clientAt: now,
    })
      .then((r) => {
        if (!r.ok) {
          setMessage(problem[r.code]);
          return;
        }
        setTitle('');
        setLocation('');
        setDescription('');
        setImmediate('');
        setMessage('Reported. It will reach the site team as soon as this device is online.');
        data.requestSync('local_write');
      })
      .catch(() => setMessage('Could not save the report on this device. Try again.'))
      .finally(() => setSaving(false));
  };
  const items = rows.value ?? [];
  return (
    <Screen title="Report an incident">
      <Text style={{ color: t.color.text }}>
        For an emergency, call 000 first. Report it here once everyone is safe.
      </Text>
      {INCIDENT_TYPES.map((k) => (
        <Button
          key={k}
          label={incidentTypeLabel[k]}
          variant={k === type ? 'primary' : 'secondary'}
          onPress={() => setType(k)}
          testID={`type-${k}`}
        />
      ))}
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="What happened?"
        placeholderTextColor={t.color.textSecondary}
        maxLength={200}
        accessibilityLabel="What happened"
        style={input}
      />
      <TextInput
        value={location}
        onChangeText={setLocation}
        placeholder="Where (optional)"
        placeholderTextColor={t.color.textSecondary}
        maxLength={200}
        accessibilityLabel="Where it happened"
        style={input}
      />
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Details (optional)"
        placeholderTextColor={t.color.textSecondary}
        multiline
        accessibilityLabel="Details"
        style={input}
      />
      <TextInput
        value={immediate}
        onChangeText={setImmediate}
        placeholder="What was done straight away (optional)"
        placeholderTextColor={t.color.textSecondary}
        multiline
        accessibilityLabel="What was done straight away"
        style={input}
      />
      <Button label="Report incident" disabled={saving} onPress={submit} testID="report-incident" />
      {message ? <Text style={{ color: t.color.text }}>{message}</Text> : null}
      {rows.value !== null && items.length === 0 ? (
        <StateMessage message="You have not reported any incidents from this device." />
      ) : null}
      {items.map((i) => (
        <ListItem
          key={i.id}
          title={i.title}
          subtitle={[
            incidentTypeLabel[i.type],
            new Date(i.occurredAt).toLocaleString(),
            i.location,
            i.pending ? 'Waiting to sync' : 'Sent',
          ]
            .filter(Boolean)
            .join(' · ')}
          testID={`incident-${i.id}`}
        />
      ))}
    </Screen>
  );
}
