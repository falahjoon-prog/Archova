// Report an incident from site, and see the reports made on this device. Works offline; unsent reports say so.
import { useState } from 'react';
import { Image, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { uuidv7 } from '@archova/domain';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { StateMessage, useDeviceData, useLocalQuery } from '../../../shared';
import {
  INCIDENT_TYPES,
  incidentTypeLabel,
  listIncidents,
  reportIncident,
  type IncidentPerson,
  type IncidentType,
  type PersonRole,
} from '../commands';

const roleLabel: Record<PersonRole, string> = {
  injured: 'Injured',
  witness: 'Witness',
  involved: 'Involved',
};

const problem = {
  'incident.title_required': 'Say briefly what happened.',
  'incident.time_invalid': 'That time is not valid.',
  'incident.in_future': 'The incident cannot be in the future.',
} as const;

export function IncidentReportScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
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
  const [people, setPeople] = useState<IncidentPerson[]>([]);
  const [personName, setPersonName] = useState('');
  const [role, setRole] = useState<PersonRole>('injured');
  const [nature, setNature] = useState('');
  const [bodyPart, setBodyPart] = useState('');
  const [treatment, setTreatment] = useState('');
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
  const addPerson = () => {
    if (!personName.trim()) return;
    setPeople([
      ...people,
      {
        personName: personName.trim(),
        role,
        ...(role === 'injured' ? { injury: { nature, bodyPart, treatment } } : {}),
      },
    ]);
    setPersonName('');
    setNature('');
    setBodyPart('');
    setTreatment('');
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
      people,
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
        setPeople([]);
        setMessage(
          'Reported. It will reach the site team as soon as this device is online. Add photos below.',
        );
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
      <Text style={{ color: t.color.text, fontWeight: '600' }}>People involved</Text>
      <Text style={{ color: t.color.textSecondary }}>
        Injury details are health information. Only people allowed to see it can read them.
      </Text>
      {people.map((p, n) => (
        <ListItem
          key={`${p.personName}-${n}`}
          title={`${p.personName} · ${roleLabel[p.role]}`}
          subtitle={
            [p.injury?.nature, p.injury?.bodyPart, p.injury?.treatment]
              .filter(Boolean)
              .join(' · ') || undefined
          }
          onPress={() => setPeople(people.filter((_, i) => i !== n))}
          accessibilityHint="Removes this person"
          testID={`person-${n}`}
        />
      ))}
      {(Object.keys(roleLabel) as PersonRole[]).map((r) => (
        <Button
          key={r}
          label={roleLabel[r]}
          variant={r === role ? 'primary' : 'secondary'}
          onPress={() => setRole(r)}
          testID={`role-${r}`}
        />
      ))}
      <TextInput
        value={personName}
        onChangeText={setPersonName}
        placeholder="Name"
        placeholderTextColor={t.color.textSecondary}
        maxLength={200}
        accessibilityLabel="Person's name"
        style={input}
      />
      {role === 'injured' ? (
        <>
          <TextInput
            value={nature}
            onChangeText={setNature}
            placeholder="What the injury is (optional)"
            placeholderTextColor={t.color.textSecondary}
            maxLength={500}
            accessibilityLabel="Nature of the injury"
            style={input}
          />
          <TextInput
            value={bodyPart}
            onChangeText={setBodyPart}
            placeholder="Part of the body (optional)"
            placeholderTextColor={t.color.textSecondary}
            maxLength={500}
            accessibilityLabel="Part of the body"
            style={input}
          />
          <TextInput
            value={treatment}
            onChangeText={setTreatment}
            placeholder="Treatment given (optional)"
            placeholderTextColor={t.color.textSecondary}
            maxLength={500}
            accessibilityLabel="Treatment given"
            style={input}
          />
        </>
      ) : null}
      <Button
        label="Add person"
        variant="secondary"
        disabled={!personName.trim()}
        onPress={addPerson}
        testID="add-person"
      />
      <Button label="Report incident" disabled={saving} onPress={submit} testID="report-incident" />
      {message ? <Text style={{ color: t.color.text }}>{message}</Text> : null}
      {rows.value !== null && items.length === 0 ? (
        <StateMessage message="You have not reported any incidents from this device." />
      ) : null}
      {items.map((i) => {
        const photos = (i.photoCount ?? 0) + (i.localPhotos?.length ?? 0);
        return (
          <View key={i.id} style={{ gap: t.space[2] }}>
            <ListItem
              title={i.numberLabel ? `${i.numberLabel} · ${i.title}` : i.title}
              subtitle={[
                incidentTypeLabel[i.type],
                new Date(i.occurredAt).toLocaleString(),
                i.location,
                i.numberLabel ? null : 'Number given once sent',
                photos > 0 ? `${photos} ${photos === 1 ? 'photo' : 'photos'}` : null,
                i.pending ? 'Waiting to sync' : 'Sent',
              ]
                .filter(Boolean)
                .join(' · ')}
              testID={`incident-${i.id}`}
            />
            {(i.localPhotos ?? []).length > 0 ? (
              <View style={{ flexDirection: 'row', gap: t.space[2] }}>
                {(i.localPhotos ?? []).map((p) => (
                  <Image
                    key={p.photoId}
                    source={{ uri: p.thumbnailUri }}
                    style={{ width: 56, height: 56, borderRadius: t.radius.md }}
                    accessibilityLabel="Photo waiting to send"
                  />
                ))}
              </View>
            ) : null}
            <Button
              label="Add photo"
              variant="secondary"
              onPress={() => router.push(mobileRoutes.incidentPhoto(projectId, i.id))}
              testID={`photo-${i.id}`}
            />
          </View>
        );
      })}
    </Screen>
  );
}
