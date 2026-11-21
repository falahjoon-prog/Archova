// Fill in and sign a pre-task plan before work starts. Everything here works with no signal: the plan, its hazards
// and each person's drawn signature are saved on the phone and sent when a connection returns. Nova flags hazards the
// task usually brings that are not listed yet; with a connection it also uses what keeps coming up on this project.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { uuidv7 } from '@archova/domain';
import { mobileRoutes } from '@archova/routes';
import { localDateOf } from '@archova/time';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { deviceTimeZone } from '../../../lib/capture/capture';
import type { PretaskLast } from '../../../lib/actions/pretask-cache';
import { StateMessage, useCurrentOrg, useDeviceData, useLocalQuery } from '../../../shared';
import { useMe } from '../../platform';
import { StrokePad, hasInk, type UnitPoint } from '../../toolbox';
import { listSwmsOptions, suggestHazards } from '../commands';
import {
  RISK_LABELS,
  RISK_LEVELS,
  closeBlockers,
  draftFromLast,
  emptyDraft,
  emptyHazard,
  hazardWarnings,
  lastFromDraft,
  lastPlanLabel,
  saveProblems,
  toPayload,
  type PretaskDraft,
  type RiskLevel,
} from '../draft';
import { mergeSuggestions, missingHazards, type HazardSuggestion } from '../nova';

function RiskPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: RiskLevel;
  onChange: (v: RiskLevel) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space[1] }}>
      <Text style={{ color: t.color.text, fontSize: t.font.size.sm }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] }}>
        {RISK_LEVELS.map((r) => (
          <Button
            key={r}
            label={RISK_LABELS[r]}
            accessibilityLabel={`${label}: ${RISK_LABELS[r]}`}
            variant={value === r ? 'primary' : 'secondary'}
            onPress={() => onChange(r)}
          />
        ))}
      </View>
    </View>
  );
}

export function PretaskNewScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const me = useMe().data?.user;
  const zone = deviceTimeZone() ?? 'UTC';
  const today = localDateOf(new Date(), zone);
  const target = { orgId: orgId ?? '', projectId };
  const actionId = useRef(uuidv7());

  const [draft, setDraft] = useState<PretaskDraft>(() => emptyDraft(today, ''));
  const [crewName, setCrewName] = useState('');
  const [signing, setSigning] = useState<number | null>(null);
  const [strokes, setStrokes] = useState<UnitPoint[][]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const last = useLocalQuery<PretaskLast | null>(data ? () => data.pretask.get(projectId) : null, [
    data,
    projectId,
  ]);
  const edit = (patch: Partial<PretaskDraft>) => {
    setTouched(true);
    setDraft((d) => ({ ...d, ...patch }));
  };
  // The supervisor defaults to the person filling this in, once we know who they are.
  useEffect(() => {
    if (me && !touched) setDraft((d) => (d.supervisorName ? d : { ...d, supervisorName: me.name }));
  }, [me, touched]);

  const swms = useQuery({
    queryKey: ['pretask', orgId, projectId, 'swms'],
    queryFn: () => listSwmsOptions(api, target),
    enabled: orgId !== null,
    retry: false,
  });
  const server = useQuery({
    queryKey: ['pretask', orgId, projectId, 'suggest', draft.swmsId ?? null],
    queryFn: () => suggestHazards(api, target, draft.swmsId),
    enabled: orgId !== null,
    retry: false,
  });
  const suggestions: HazardSuggestion[] = useMemo(
    () =>
      mergeSuggestions(
        server.data ?? [],
        missingHazards(draft.taskTitle, draft.hazards),
        draft.hazards,
      ),
    [server.data, draft.taskTitle, draft.hazards],
  );

  const setHazard = (i: number, patch: Partial<PretaskDraft['hazards'][number]>) =>
    edit({ hazards: draft.hazards.map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  const addCrew = (personName: string, userId?: string) => {
    const name = personName.trim();
    if (!name || draft.crew.some((c) => c.personName === name)) return;
    edit({ crew: [...draft.crew, { personName: name, ...(userId ? { userId } : {}) }] });
  };

  if (!orgId) {
    return (
      <Screen title="New pre-task plan">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen title="New pre-task plan">
        <StateMessage loading message="Opening storage on this phone" />
      </Screen>
    );
  }

  const person = signing !== null ? draft.crew[signing] : undefined;
  if (person && signing !== null) {
    return (
      <Screen title={`Sign: ${person.personName}`}>
        <Text style={{ color: t.color.textSecondary }}>
          {draft.taskTitle}. By signing you confirm you have read the hazards and controls and will
          follow them. Sign with your finger inside the box.
        </Text>
        <StrokePad onChange={setStrokes} />
        <Button
          label="Save signature"
          disabled={!hasInk(strokes)}
          onPress={() => {
            edit({
              crew: draft.crew.map((c, j) => (j === signing ? { ...c, strokes } : c)),
            });
            setSigning(null);
            setStrokes([]);
          }}
        />
        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => {
            setSigning(null);
            setStrokes([]);
          }}
        />
      </Screen>
    );
  }

  const problems = saveProblems(draft);
  const blockers = closeBlockers(draft);
  const warnings = hazardWarnings(draft);
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  const pristine = !touched && draft.taskTitle === '';

  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      await data.actions.enqueue({
        id: actionId.current,
        projectId,
        kind: 'pretask.submit',
        targetId: actionId.current,
        payload: { ...toPayload(draft, blockers.length === 0) },
      });
      await data.pretask.put(projectId, lastFromDraft(draft));
      data.requestSync('connectivity');
      router.replace(mobileRoutes.pretaskPlans(projectId));
    } catch {
      setFailed('Could not save this plan on the phone. Try again.');
      setSaving(false);
    }
  };

  return (
    <Screen title="New pre-task plan">
      {pristine && last.value ? (
        <Button
          label={`Start from ${lastPlanLabel(last.value, today)}`}
          variant="secondary"
          onPress={() => {
            setTouched(true);
            setDraft(draftFromLast(last.value!, today, me?.name ?? ''));
          }}
        />
      ) : null}
      <Text accessibilityRole="header" style={heading}>
        The task
      </Text>
      <TextField
        label="What is the task?"
        value={draft.taskTitle}
        onChangeText={(v) => edit({ taskTitle: v })}
      />
      <TextField
        label="Where on site (optional)"
        value={draft.location}
        onChangeText={(v) => edit({ location: v })}
      />
      <TextField
        label="Supervisor"
        value={draft.supervisorName}
        onChangeText={(v) => edit({ supervisorName: v })}
      />
      {swms.data && swms.data.length > 0 ? (
        <View style={{ gap: t.space[2] }}>
          <Text style={{ color: t.color.text, fontSize: t.font.size.sm }}>SWMS (optional)</Text>
          {swms.data.slice(0, 6).map((s) => (
            <Button
              key={s.id}
              label={s.label}
              variant={draft.swmsId === s.id ? 'primary' : 'secondary'}
              onPress={() => {
                setTouched(true);
                setDraft((d) => {
                  const { swmsId: _drop, ...rest } = d;
                  return d.swmsId === s.id ? rest : { ...rest, swmsId: s.id };
                });
              }}
            />
          ))}
        </View>
      ) : null}

      <Text accessibilityRole="header" style={heading}>
        Hazards and controls
      </Text>
      {draft.hazards.length === 0 ? (
        <StateMessage message="No hazards yet. Add what could hurt someone doing this task." />
      ) : null}
      {draft.hazards.map((h, i) => (
        <View
          key={i}
          style={{
            gap: t.space[2],
            padding: t.space[3],
            borderRadius: t.radius.md,
            borderWidth: 1,
            borderColor: t.color.borderControl,
          }}
        >
          <TextField
            label={`Hazard ${i + 1}`}
            value={h.hazard}
            onChangeText={(v) => setHazard(i, { hazard: v })}
          />
          <RiskPicker
            label="Risk before controls"
            value={h.riskBefore}
            onChange={(v) => setHazard(i, { riskBefore: v })}
          />
          <TextField
            label="How will it be controlled?"
            value={h.controls}
            multiline
            onChangeText={(v) => setHazard(i, { controls: v })}
          />
          <RiskPicker
            label="Risk after controls"
            value={h.riskAfter}
            onChange={(v) => setHazard(i, { riskAfter: v })}
          />
          <Button
            label="Remove hazard"
            variant="secondary"
            onPress={() => edit({ hazards: draft.hazards.filter((_, j) => j !== i) })}
          />
        </View>
      ))}
      <Button
        label="Add a hazard"
        variant="secondary"
        onPress={() => edit({ hazards: [...draft.hazards, emptyHazard()] })}
      />
      {suggestions.length > 0 ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            gap: t.space[2],
            padding: t.space[3],
            borderRadius: t.radius.md,
            borderWidth: 1,
            borderColor: t.color.statusWarning,
          }}
        >
          <Text style={{ color: t.color.text, fontWeight: '600' }}>Nova: did you think about</Text>
          {suggestions.slice(0, 5).map((s) => (
            <View key={s.hazard} style={{ gap: t.space[1] }}>
              <ListItem title={s.hazard} subtitle={`${s.because}. ${s.controls}`} />
              <Button
                label={`Add ${s.hazard}`}
                variant="secondary"
                onPress={() =>
                  edit({
                    hazards: [
                      ...draft.hazards,
                      {
                        hazard: s.hazard,
                        riskBefore: s.riskBefore,
                        controls: s.controls,
                        riskAfter: 'low',
                      },
                    ],
                  })
                }
              />
            </View>
          ))}
        </View>
      ) : null}
      {warnings.map((w) => (
        <Text key={w} style={{ color: t.color.statusWarning }}>
          {w}
        </Text>
      ))}

      <Text accessibilityRole="header" style={heading}>
        Crew
      </Text>
      {draft.crew.map((c, i) => (
        <View key={c.personName} style={{ gap: t.space[1] }}>
          <ListItem title={c.personName} subtitle={c.strokes ? 'Signed' : 'Not signed yet'} />
          <View style={{ flexDirection: 'row', gap: t.space[2] }}>
            <Button
              label={c.strokes ? 'Sign again' : 'Sign'}
              accessibilityLabel={`Sign for ${c.personName}`}
              onPress={() => setSigning(i)}
            />
            <Button
              label="Remove"
              accessibilityLabel={`Remove ${c.personName}`}
              variant="secondary"
              onPress={() => edit({ crew: draft.crew.filter((_, j) => j !== i) })}
            />
          </View>
        </View>
      ))}
      <TextField label="Add a person" value={crewName} onChangeText={setCrewName} />
      <Button
        label="Add to crew"
        variant="secondary"
        disabled={crewName.trim() === ''}
        onPress={() => {
          addCrew(crewName);
          setCrewName('');
        }}
      />
      {me && !draft.crew.some((c) => c.userId === me.id) ? (
        <Button label="Add me" variant="secondary" onPress={() => addCrew(me.name, me.id)} />
      ) : null}

      {problems.map((p) => (
        <Text key={p} style={{ color: t.color.statusDanger }}>
          {p}
        </Text>
      ))}
      {problems.length === 0 && blockers.length > 0 ? (
        <View style={{ gap: t.space[1] }}>
          <Text style={{ color: t.color.textSecondary }}>
            It can be saved now, but it cannot be closed yet:
          </Text>
          {blockers.map((b) => (
            <Text key={b} style={{ color: t.color.textSecondary }}>
              {b}
            </Text>
          ))}
        </View>
      ) : null}
      {failed ? <StateMessage tone="danger" message={failed} /> : null}
      <Button
        label={blockers.length === 0 ? 'Save and close plan' : 'Save plan'}
        loading={saving}
        disabled={problems.length > 0}
        onPress={() => void save()}
      />
    </Screen>
  );
}
