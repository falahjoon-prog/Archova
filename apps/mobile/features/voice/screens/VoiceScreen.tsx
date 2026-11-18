// Hands-free voice for site (mobile F14). One big button: tap, say "diary note ..." or "log delay rain two hours",
// hear it read back, say "yes" or tap Save. Nothing is saved until confirmed. RFI, incident and Ask Nova open
// their own screens. Works offline: recognition is on the phone and saves go through the diary's offline commands.
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { Button, Screen, useTheme } from '@archova/ui-native';
import { StateMessage, useDeviceData } from '../../../shared';
import { diaryToday, diaryErrorText, useProjectTimeZone } from '../../diary';
import { applyDiaryVoice } from '../apply';
import { parseVoice, readBack, type VoiceIntent } from '../parse';
import { deviceSpeech, type SpeechPort } from '../speech';

type Phase = 'idle' | 'listening' | 'confirm' | 'saved' | 'denied';

export function VoiceScreen({
  projectId,
  speech = deviceSpeech,
}: {
  projectId: string;
  speech?: SpeechPort;
}) {
  const t = useTheme();
  const router = useRouter();
  const device = useDeviceData();
  const { zone } = useProjectTimeZone(device.status === 'ready' ? device.data : null, projectId);
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [intent, setIntent] = useState<VoiceIntent | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  const say = useCallback(
    (text: string) => {
      setMessage(text);
      speech.speak(text);
    },
    [speech],
  );

  const open = useCallback(
    (i: VoiceIntent) => {
      if (i.kind === 'incident.report') router.push(mobileRoutes.incidents(projectId));
      else router.push({ pathname: '/assistant', params: { projectId } });
    },
    [projectId, router],
  );

  const save = useCallback(
    async (i: VoiceIntent) => {
      if (device.status !== 'ready') return;
      const r = await applyDiaryVoice(device.data.store, {
        intent: i,
        projectId,
        date: diaryToday(new Date(), zone),
        now: new Date(),
      });
      if (r.ok) {
        device.data.requestSync('local_write');
        setPhase('saved');
        say(r.saved === 'note' ? 'Saved to today’s diary.' : 'Delay logged.');
      } else {
        setPhase('idle');
        say(r.code === 'voice.not_diary' ? 'Nothing to save.' : diaryErrorText[r.code]);
      }
    },
    [device, projectId, say, zone],
  );

  const onPhrase = useCallback(
    async (text: string) => {
      setHeard(text);
      const parsed = parseVoice(text);
      if (phase === 'confirm' && intent) {
        if (parsed.kind === 'confirm') return save(intent);
        if (parsed.kind === 'cancel') {
          setIntent(null);
          setPhase('idle');
          return say('Cancelled.');
        }
      }
      if (parsed.kind === 'confirm' || parsed.kind === 'cancel') {
        setPhase('idle');
        return say('Nothing waiting. Say diary note, log delay, report incident, or ask Nova.');
      }
      setIntent(parsed);
      if (parsed.kind === 'unknown') {
        setPhase('idle');
        return say(readBack(parsed));
      }
      if (
        parsed.kind === 'nova.ask' ||
        parsed.kind === 'incident.report' ||
        parsed.kind === 'rfi.raise'
      ) {
        setPhase('idle');
        say(readBack(parsed));
        return open(parsed);
      }
      setPhase('confirm');
      say(readBack(parsed));
    },
    [intent, open, phase, save, say],
  );

  const listen = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      speech.stopSpeaking();
      if (!(await speech.ensurePermission())) {
        setPhase('denied');
        return;
      }
      setPhase('listening');
      const text = await speech.listen();
      if (!text.trim()) {
        setPhase(intent ? 'confirm' : 'idle');
        return say("I didn't hear anything. Tap and try again.");
      }
      await onPhrase(text);
    } finally {
      busy.current = false;
    }
  };

  if (device.status !== 'ready') {
    return (
      <Screen title="Hands-free voice">
        <StateMessage loading message="Opening device storage" />
      </Screen>
    );
  }

  return (
    <Screen title="Hands-free voice">
      <View style={{ gap: t.space[4], paddingVertical: t.space[4] }}>
        <Text accessibilityRole="header" style={{ color: t.color.text, fontSize: t.font.size.lg }}>
          Say: diary note, log delay, report incident, raise RFI, or ask Nova.
        </Text>
        <Button
          label={phase === 'listening' ? 'Listening…' : 'Tap and speak'}
          onPress={listen}
          disabled={phase === 'listening'}
          testID="voice-listen"
          accessibilityLabel="Tap and speak a command"
        />
        {phase === 'denied' ? (
          <Text accessibilityLiveRegion="polite" style={{ color: t.color.statusDanger }}>
            Microphone or speech access is off. Turn it on for Archova in your phone settings.
          </Text>
        ) : null}
        {heard ? <Text style={{ color: t.color.textMuted }}>Heard: {heard}</Text> : null}
        {message ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: t.color.text, fontSize: t.font.size.md }}
          >
            {message}
          </Text>
        ) : null}
        {phase === 'confirm' && intent ? (
          <View style={{ gap: t.space[3] }}>
            <Button label="Save" onPress={() => void save(intent)} testID="voice-save" />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setIntent(null);
                setPhase('idle');
                setMessage(null);
              }}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
