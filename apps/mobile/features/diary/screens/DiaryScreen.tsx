// Site diary for one day (product 05 DIA-US1–US8). Opens on today in the project's time zone (DIA-AC1), works
// with no signal, and after submit every change is an amendment with a reason (DIA-AC8).
import { useState, type ReactNode } from 'react';
import { Alert, Image, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  DELAY_TYPES,
  PLANT_STATUSES,
  uuidv7,
  type DelayType,
  type PlantStatus,
} from '@archova/domain';
import { mobileRoutes } from '@archova/routes';
import { addDays, type LocalDate } from '@archova/time';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { deviceTimeZone } from '../../../lib/capture/capture';
import { StateMessage, useCurrentOrg, useDeviceData, useLocalQuery } from '../../../shared';
import type { DeviceData } from '../../../shared';
import { useProject } from '../../platform';
import {
  addDiaryLine,
  diaryToday,
  getDiaryDay,
  labourTotals,
  listDiaryLines,
  newDelay,
  newLineId,
  removeDiaryLine,
  setDiaryNotes,
  submitDiaryDay,
  yesterdaysCompanies,
  type DiaryResult,
  type LineInput,
  type LineKind,
} from '../commands';
import { delayTypeLabel, diaryErrorText, diaryStatusLabel, plantStatusLabel } from './labels';

interface Option {
  id: string;
  name: string;
}

/** The project's zone: from the API while online, else the synced project record. */
export function useProjectTimeZone(data: DeviceData | null, projectId: string) {
  const { orgId } = useCurrentOrg();
  const project = useProject(orgId, projectId);
  const local = useLocalQuery(data ? () => data.store.get('project', projectId) : null, [
    data,
    projectId,
  ]);
  const synced = (local.value?.data as { timezone?: string } | undefined)?.timezone;
  const zone = project.data?.timezone ?? synced ?? null;
  return zone ? { zone, fallback: false } : { zone: deviceTimeZone() ?? 'UTC', fallback: true };
}

const toNumber = (text: string) => (text.trim() === '' ? NaN : Number(text));

export function DiaryScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const { zone, fallback } = useProjectTimeZone(data, projectId);
  const today = diaryToday(new Date(), zone);
  const [picked, setPicked] = useState<LocalDate | null>(null);
  const date = picked ?? today;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const read = data
    ? async () => {
        const [day, labour, plant, delivery, delay] = await Promise.all([
          getDiaryDay(data.store, projectId, date),
          listDiaryLines(data.store, 'labour', projectId, date),
          listDiaryLines(data.store, 'plant', projectId, date),
          listDiaryLines(data.store, 'delivery', projectId, date),
          listDiaryLines(data.store, 'delay', projectId, date),
        ]);
        return { day, labour, plant, delivery, delay };
      }
    : null;
  const diary = useLocalQuery(read, [data, projectId, date]);
  const companies = useLocalQuery(
    data
      ? async () =>
          (await data.store.listRecords<Option>('project_company', projectId)).map((r) => r.data)
      : null,
    [data, projectId],
  );

  if (!data || !diary.value) {
    return (
      <Screen title="Site diary">
        <StateMessage loading={device.status === 'opening'} message="Opening device storage" />
      </Screen>
    );
  }
  const { day, labour, plant, delivery, delay } = diary.value;
  const submitted = day.entry.status !== 'draft';
  const amendmentReason = submitted ? reason : null;
  const clientAt = () => new Date().toISOString();

  /** Run a change, show its problem if any, then refresh and queue a sync. */
  const run = async (change: () => Promise<DiaryResult<unknown>>) => {
    const result = await change();
    if (!result.ok) {
      setError(diaryErrorText[result.code]);
      return false;
    }
    setError(null);
    diary.refresh();
    data.requestSync('local_write');
    return true;
  };

  const add = <K extends LineKind>(kind: K, line: LineInput<K>['line']) =>
    run(() =>
      addDiaryLine(data.store, {
        kind,
        projectId,
        date,
        lineId: newLineId(kind),
        mutationId: uuidv7(),
        line,
        amendmentReason,
        clientAt: clientAt(),
      }),
    );

  const removeNow = (kind: LineKind, lineId: string) =>
    run(() =>
      removeDiaryLine(data.store, {
        kind,
        projectId,
        date,
        lineId,
        mutationId: uuidv7(),
        amendmentReason,
        clientAt: clientAt(),
      }),
    );
  const remove = (kind: LineKind, lineId: string) =>
    Alert.alert('Remove this line?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeNow(kind, lineId) },
    ]);

  const totals = labourTotals(labour);

  return (
    <Screen title="Site diary">
      <View style={{ flexDirection: 'row', gap: t.space[2] }}>
        <Button
          label="Previous day"
          variant="secondary"
          onPress={() => setPicked(addDays(date, -1))}
        />
        {date !== today ? (
          <Button label="Today" variant="secondary" onPress={() => setPicked(null)} />
        ) : null}
        {date < today ? (
          <Button
            label="Next day"
            variant="secondary"
            onPress={() => setPicked(addDays(date, 1))}
          />
        ) : null}
      </View>
      <ListItem
        title={date === today ? `Today, ${date}` : date}
        subtitle={`${diaryStatusLabel[day.entry.status]}${day.pending ? ' · waiting to sync' : ''}`}
      />
      {fallback ? (
        <StateMessage message="Using this phone's time zone until the project syncs to the device." />
      ) : null}

      {submitted ? (
        <TextField
          label="Reason for amendment"
          value={reason}
          onChangeText={setReason}
          hint="Required for any change to a submitted day"
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: t.color.statusDanger }}>
          {error}
        </Text>
      ) : null}

      <Section title={`Labour · ${totals.headcount} people, ${totals.personHours} person-hours`}>
        {labour.map((l) => (
          <ListItem
            key={l.id}
            title={`${l.companyName}${l.trade ? ` · ${l.trade}` : ''}`}
            subtitle={`${l.headcount} × ${l.hours} h${l.pending ? ' · waiting to sync' : ''}`}
            accessibilityHint="Double tap to remove"
            onPress={() => remove('labour', l.id)}
          />
        ))}
        <LabourForm
          companies={companies.value ?? []}
          onYesterday={() => yesterdaysCompanies(data.store, projectId, addDays(date, -1))}
          onAdd={(line) => add('labour', line)}
        />
      </Section>

      <Section title="Plant">
        {plant.map((p) => (
          <ListItem
            key={p.id}
            title={p.description}
            subtitle={`${p.quantity} × ${p.hours} h · ${plantStatusLabel[p.status]}`}
            accessibilityHint="Double tap to remove"
            onPress={() => remove('plant', p.id)}
          />
        ))}
        <PlantForm onAdd={(line) => add('plant', line)} />
      </Section>

      <Section title="Deliveries">
        {delivery.map((d) => (
          <ListItem
            key={d.id}
            title={d.description}
            subtitle={[d.supplierName, d.docketNumber && `Docket ${d.docketNumber}`]
              .filter(Boolean)
              .join(' · ')}
            accessibilityHint="Double tap to remove"
            onPress={() => remove('delivery', d.id)}
          />
        ))}
        <DeliveryForm onAdd={(line) => add('delivery', { ...line, receivedAt: clientAt() })} />
      </Section>

      <Section title="Delays">
        {delay.map((d) => (
          <ListItem
            key={d.id}
            title={`${delayTypeLabel[d.type]} · ${d.hours} h`}
            subtitle={`${d.description}${d.isEotCandidate ? ' · possible EOT' : ''}`}
            accessibilityHint="Double tap to remove"
            onPress={() => remove('delay', d.id)}
          />
        ))}
        <DelayForm onAdd={(line) => add('delay', line)} />
      </Section>

      <Section title="Photos">
        <Text style={{ color: t.color.textSecondary }}>
          {(day.entry.fileIds?.length ?? 0) + (day.entry.localPhotos?.length ?? 0)} on this day
          {(day.entry.localPhotos?.length ?? 0) > 0 ? ' (some waiting to upload)' : ''}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[1] }}>
          {(day.entry.localPhotos ?? []).map((p) => (
            <Image
              key={p.photoId}
              source={{ uri: p.thumbnailUri }}
              style={{ width: 56, height: 56, borderRadius: t.radius.md }}
              accessibilityLabel="Photo waiting to upload"
            />
          ))}
        </View>
        <Button
          label="Take photo"
          variant="secondary"
          onPress={() => {
            if (submitted && reason.trim() === '') {
              setError(diaryErrorText['diary.amendment_reason_required']);
              return;
            }
            router.push(mobileRoutes.diaryPhoto(projectId, date, submitted ? reason : undefined));
          }}
        />
      </Section>

      <NotesForm
        key={`${date}:${day.entry.notesText}`}
        initial={day.entry.notesText}
        onSave={(notesText) =>
          run(() =>
            setDiaryNotes(data.store, {
              projectId,
              date,
              notesText,
              mutationId: uuidv7(),
              amendmentReason,
              clientAt: clientAt(),
            }),
          )
        }
      />

      {!submitted ? (
        <Button
          label="Submit day"
          accessibilityHint="Locks the day. Later changes need a reason."
          onPress={() =>
            void run(() =>
              submitDiaryDay(data.store, {
                projectId,
                date,
                mutationId: uuidv7(),
                clientAt: clientAt(),
              }),
            )
          }
        />
      ) : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space[2], marginTop: t.space[3] }}>
      <Text accessibilityRole="header" style={{ color: t.color.text, fontSize: t.font.size.lg }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function LabourForm({
  companies,
  onYesterday,
  onAdd,
}: {
  companies: Option[];
  onYesterday: () => Promise<{ companyId: string; companyName: string; trade: string | null }[]>;
  onAdd: (line: {
    companyId: string;
    companyName: string;
    trade: string | null;
    headcount: number;
    hours: number;
    notes: string | null;
  }) => Promise<boolean>;
}) {
  const [company, setCompany] = useState<Option | null>(null);
  const [trade, setTrade] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [hours, setHours] = useState('8');
  const [suggested, setSuggested] = useState<
    { companyId: string; companyName: string; trade: string | null }[]
  >([]);

  return (
    <>
      <Button
        label="Start from yesterday's companies"
        variant="secondary"
        onPress={() => void onYesterday().then(setSuggested)}
      />
      {suggested.map((s) => (
        <ListItem
          key={`${s.companyId}|${s.trade ?? ''}`}
          title={s.companyName}
          subtitle={s.trade}
          selected={company?.id === s.companyId && (s.trade ?? '') === trade}
          onPress={() => {
            setCompany({ id: s.companyId, name: s.companyName });
            setTrade(s.trade ?? '');
          }}
        />
      ))}
      {companies.length === 0 && suggested.length === 0 ? (
        <StateMessage message="Companies appear here once this project has synced to the device." />
      ) : null}
      {companies.map((c) => (
        <ListItem
          key={c.id}
          title={c.name}
          selected={company?.id === c.id}
          onPress={() => setCompany(c)}
        />
      ))}
      <TextField label="Trade" value={trade} onChangeText={setTrade} />
      <TextField
        label="Headcount"
        value={headcount}
        onChangeText={setHeadcount}
        keyboardType="number-pad"
      />
      <TextField
        label="Hours each"
        value={hours}
        onChangeText={setHours}
        keyboardType="decimal-pad"
      />
      <Button
        label="Add labour"
        variant="secondary"
        disabled={!company}
        onPress={() =>
          void onAdd({
            companyId: company!.id,
            companyName: company!.name,
            trade: trade.trim() || null,
            headcount: toNumber(headcount),
            hours: toNumber(hours),
            notes: null,
          }).then((ok) => ok && setHeadcount(''))
        }
      />
    </>
  );
}

function PlantForm({
  onAdd,
}: {
  onAdd: (line: {
    description: string;
    companyId: string | null;
    quantity: number;
    hours: number;
    status: PlantStatus;
  }) => Promise<boolean>;
}) {
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('');
  const [status, setStatus] = useState<PlantStatus>('working');
  return (
    <>
      <TextField label="Plant" value={description} onChangeText={setDescription} />
      <TextField label="Hours" value={hours} onChangeText={setHours} keyboardType="decimal-pad" />
      {PLANT_STATUSES.map((s) => (
        <ListItem
          key={s}
          title={plantStatusLabel[s]}
          selected={status === s}
          onPress={() => setStatus(s)}
        />
      ))}
      <Button
        label="Add plant"
        variant="secondary"
        onPress={() =>
          void onAdd({
            description,
            companyId: null,
            quantity: 1,
            hours: toNumber(hours),
            status,
          }).then((ok) => ok && (setDescription(''), setHours('')))
        }
      />
    </>
  );
}

function DeliveryForm({
  onAdd,
}: {
  onAdd: (line: {
    description: string;
    supplierName: string | null;
    docketNumber: string | null;
  }) => Promise<boolean>;
}) {
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [docket, setDocket] = useState('');
  return (
    <>
      <TextField label="Delivered" value={description} onChangeText={setDescription} />
      <TextField label="Supplier" value={supplier} onChangeText={setSupplier} />
      <TextField label="Docket number" value={docket} onChangeText={setDocket} />
      <Button
        label="Add delivery"
        variant="secondary"
        onPress={() =>
          void onAdd({
            description,
            supplierName: supplier.trim() || null,
            docketNumber: docket.trim() || null,
          }).then((ok) => ok && (setDescription(''), setSupplier(''), setDocket('')))
        }
      />
    </>
  );
}

function DelayForm({ onAdd }: { onAdd: (line: ReturnType<typeof newDelay>) => Promise<boolean> }) {
  const [type, setType] = useState<DelayType>('weather');
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('');
  const [eot, setEot] = useState<boolean | null>(null);
  const line = newDelay(type, description, toNumber(hours));
  const isEot = eot ?? line.isEotCandidate;
  return (
    <>
      {DELAY_TYPES.map((d) => (
        <ListItem
          key={d}
          title={delayTypeLabel[d]}
          selected={type === d}
          onPress={() => {
            setType(d);
            setEot(null);
          }}
        />
      ))}
      <TextField label="What happened" value={description} onChangeText={setDescription} />
      <TextField
        label="Hours lost"
        value={hours}
        onChangeText={setHours}
        keyboardType="decimal-pad"
      />
      <ListItem
        title="Possible extension of time"
        subtitle={isEot ? 'Yes' : 'No'}
        selected={isEot}
        onPress={() => setEot(!isEot)}
      />
      <Button
        label="Add delay"
        variant="secondary"
        onPress={() =>
          void onAdd({ ...line, isEotCandidate: isEot }).then(
            (ok) => ok && (setDescription(''), setHours(''), setEot(null)),
          )
        }
      />
    </>
  );
}

function NotesForm({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (notes: string) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState(initial);
  return (
    <>
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
      <Button
        label="Save notes"
        variant="secondary"
        disabled={notes === initial}
        onPress={() => void onSave(notes)}
      />
    </>
  );
}
