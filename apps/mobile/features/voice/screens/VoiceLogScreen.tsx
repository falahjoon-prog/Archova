// Voice log (mobile F14): speak the whole day, read what the phone heard, and let Nova split it into diary notes,
// delays, safety observations and tasks. Each proposed record can be edited or switched off before anything is saved.
// Recognition runs on the phone; only the text goes to Nova (online). Offline, or if Nova can't read it, the whole text
// is offered as one diary note.
import { useCallback, useRef, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Button, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg, useDeviceData } from '../../../shared';
import { diaryErrorText, diaryToday, useProjectTimeZone } from '../../diary';
import { applyVoiceLog, kindLabel, sortVoiceLog, wholeNote, type VoiceLogItem } from '../log';
import { deviceDictation, type DictationPort } from '../speech';

type Phase = 'idle' | 'listening' | 'edit' | 'sorting' | 'review' | 'saved' | 'denied';
interface Row extends VoiceLogItem {
  keep: boolean;
}

export function VoiceLogScreen({
  projectId,
  dictation = deviceDictation,
}: {
  projectId: string;
  dictation?: DictationPort;
}) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const device = useDeviceData();
  const { zone } = useProjectTimeZone(device.status === 'ready' ? device.data : null, projectId);
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!(await dictation.ensurePermission())) return setPhase('denied');
      setMessage(null);
      setPhase('listening');
      const final = await dictation.dictate(setText);
      setText(final || text);
      setPhase('edit');
    } finally {
      busy.current = false;
    }
  };

  const sort = useCallback(async () => {
    if (device.status !== 'ready') return;
    setPhase('sorting');
    setMessage(null);
    const today = diaryToday(new Date(), zone);
    try {
      if (!orgId) throw new Error('no org');
      const r = await sortVoiceLog(api, { orgId, projectId }, today, text);
      if (r.items.length === 0) {
        setRows(wholeNote(text).map((i) => ({ ...i, keep: true })));
        setMessage('Nova found nothing to split out, so the whole text is one diary note.');
      } else {
        setRows(r.items.map((i) => ({ ...i, keep: true })));
        if (r.dropped > 0)
          setMessage(
            `${r.dropped} suggestion${r.dropped === 1 ? '' : 's'} left out: not clearly in what you said.`,
          );
      }
    } catch {
      setRows(wholeNote(text).map((i) => ({ ...i, keep: true })));
      setMessage(
        'Nova could not be reached, so the whole text is one diary note. You can still save it.',
      );
    }
    setPhase('review');
  }, [device, orgId, projectId, text, zone]);

  const save = async () => {
    if (device.status !== 'ready') return;
    const r = await applyVoiceLog(device.data.store, {
      items: rows.filter((x) => x.keep),
      projectId,
      date: diaryToday(new Date(), zone),
      now: new Date(),
    });
    if (!r.ok) return setMessage(diaryErrorText[r.code]);
    device.data.requestSync('local_write');
    const n = r.saved;
    setMessage(
      `Saved: ${n.notes} note${n.notes === 1 ? '' : 's'}, ${n.delays} delay${n.delays === 1 ? '' : 's'}, ${n.observations} safety observation${n.observations === 1 ? '' : 's'}, ${n.tasks} task${n.tasks === 1 ? '' : 's'}.`,
    );
    setPhase('saved');
  };

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  if (device.status !== 'ready') {
    return (
      <Screen title="Voice log">
        <StateMessage loading message="Opening device storage" />
      </Screen>
    );
  }
  const input = {
    color: t.color.text,
    borderColor: t.color.borderControl,
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.space[2],
  };
  const kept = rows.filter((r) => r.keep).length;

  return (
    <Screen title="Voice log">
      <ScrollView contentContainerStyle={{ gap: t.space[4], paddingVertical: t.space[4] }}>
        {phase === 'idle' || phase === 'denied' || phase === 'listening' ? (
          <>
            <Text style={{ color: t.color.text, fontSize: t.font.size.lg }}>
              Tap and talk through your day: what was done, delays, safety issues and jobs to follow
              up.
            </Text>
            <Button
              label={phase === 'listening' ? 'Done talking' : 'Start talking'}
              onPress={phase === 'listening' ? () => dictation.stop() : start}
              testID="voicelog-record"
              accessibilityLabel={phase === 'listening' ? 'Stop recording' : 'Start recording'}
            />
            {phase === 'listening' ? (
              <Text accessibilityLiveRegion="polite" style={{ color: t.color.textMuted }}>
                {text || 'Listening…'}
              </Text>
            ) : null}
            {phase === 'denied' ? (
              <Text accessibilityLiveRegion="polite" style={{ color: t.color.statusDanger }}>
                Microphone or speech access is off. Turn it on for Archova in your phone settings.
              </Text>
            ) : null}
            {phase === 'idle' ? (
              <Button
                label="Type it instead"
                variant="secondary"
                onPress={() => setPhase('edit')}
                testID="voicelog-type"
              />
            ) : null}
          </>
        ) : null}

        {phase === 'edit' || phase === 'sorting' ? (
          <>
            <Text style={{ color: t.color.text }}>
              Check what was heard and fix anything wrong.
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              editable={phase === 'edit'}
              maxLength={12000}
              accessibilityLabel="What you said"
              style={{ ...input, minHeight: 160, textAlignVertical: 'top' }}
              testID="voicelog-text"
            />
            <Button
              label={phase === 'sorting' ? 'Nova is sorting…' : 'Sort it with Nova'}
              onPress={sort}
              disabled={phase === 'sorting' || text.trim().length < 15}
              testID="voicelog-sort"
            />
            <Button
              label="Talk more"
              variant="secondary"
              onPress={start}
              disabled={phase === 'sorting'}
            />
          </>
        ) : null}

        {phase === 'review' ? (
          <>
            <Text
              accessibilityRole="header"
              style={{ color: t.color.text, fontSize: t.font.size.lg }}
            >
              Review before saving
            </Text>
            {rows.map((r, i) => (
              <View
                key={i}
                style={{
                  gap: t.space[2],
                  borderWidth: 1,
                  borderColor: t.color.borderControl,
                  borderRadius: t.radius.md,
                  padding: t.space[3],
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: t.space[2],
                  }}
                >
                  <Text style={{ color: t.color.textMuted, flexShrink: 1 }}>
                    {kindLabel[r.kind]}
                    {r.kind === 'delay' && r.hours !== null ? ` · ${r.hours} h` : ''}
                    {r.kind === 'observation' && r.severity === 'serious' ? ' · serious' : ''}
                    {r.kind === 'task' && r.dueDate ? ` · by ${r.dueDate}` : ''}
                  </Text>
                  <Switch
                    value={r.keep}
                    onValueChange={(v) => patch(i, { keep: v })}
                    accessibilityLabel={`Keep ${kindLabel[r.kind]}`}
                    testID={`voicelog-keep-${i}`}
                  />
                </View>
                <TextInput
                  value={r.text}
                  onChangeText={(v) => patch(i, { text: v })}
                  multiline
                  editable={r.keep}
                  accessibilityLabel={`${kindLabel[r.kind]} text`}
                  style={{ ...input, opacity: r.keep ? 1 : 0.5 }}
                />
              </View>
            ))}
            <Button
              label={`Save ${kept} record${kept === 1 ? '' : 's'}`}
              onPress={save}
              disabled={kept === 0}
              testID="voicelog-save"
            />
            <Button label="Back" variant="secondary" onPress={() => setPhase('edit')} />
          </>
        ) : null}

        {phase === 'saved' ? (
          <Button
            label="Log more"
            variant="secondary"
            onPress={() => {
              setText('');
              setRows([]);
              setPhase('idle');
            }}
          />
        ) : null}

        {message ? (
          <Text accessibilityLiveRegion="polite" style={{ color: t.color.text }}>
            {message}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
