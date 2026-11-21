// Evacuation roll call for supervisors (ATT-AC5): start it from who is on site, tick people off, end it.
// Starting needs a connection once. After that the list is kept on the phone, so ticking people off, "All accounted
// for" and ending still work with no signal; taps are saved with the time they were made and sent when the
// connection returns. An evacuation still in progress is picked up again when the screen opens.
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@archova/api-client';
import type { RollCall } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { Button, Screen, TextField, useTheme } from '@archova/ui-native';
import { api, queries } from '../../../lib/api';
import type { ActionKind } from '../../../lib/actions/action-queue';
import {
  StateMessage,
  useAttempt,
  useCurrentOrg,
  useDeviceData,
  useLocalQuery,
} from '../../../shared';
import {
  allClearRollCall,
  endRollCall,
  findOpenRollCall,
  getRollCall,
  markRollCall,
  startRollCall,
} from '../commands';
import { applyQueued, groupByCompany, markLabel, progressLabel } from '../rollcall';

const REFRESH_MS = 10_000;

export function RollCallScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const attempt = useAttempt();
  const companies = useQuery({ ...queries.companies(orgId ?? ''), enabled: orgId !== null });
  const [reason, setReason] = useState('Evacuation');
  // The last copy from the server (or the phone's saved copy); taps still waiting to be sent are laid on top.
  const [base, setBase] = useState<RollCall | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = base?.id ?? null;
  const baseRef = useRef<RollCall | null>(null);
  baseRef.current = base;

  const pending = useLocalQuery(data && baseId ? () => data.actions.forTarget(baseId) : null, [
    data,
    baseId,
  ]);
  const queued = (pending.value ?? []).filter((a) => a.kind.startsWith('rollcall.'));
  const waiting = queued.filter((a) => a.state === 'pending').length;
  const refused = queued.filter((a) => a.state === 'refused');

  const adopt = useCallback(
    (rc: RollCall) => {
      setBase(rc);
      if (data) void data.rollCalls.put(projectId, rc).catch(() => undefined);
    },
    [data, projectId],
  );

  // On open: show the saved copy straight away, then ask the server for the real one.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    const target = { orgId, projectId };
    void (async () => {
      const saved = data ? await data.rollCalls.get(projectId).catch(() => null) : null;
      if (cancelled) return;
      if (saved) setBase((current) => current ?? saved);
      try {
        const fresh = saved
          ? await getRollCall(api, target, saved.id)
          : await findOpenRollCall(api, target);
        if (cancelled) return;
        if (fresh) adopt(fresh);
        else if (data) void data.rollCalls.clear(projectId).catch(() => undefined);
      } catch {
        // No signal: the saved copy (if any) stays on screen and starting a new one says why it cannot.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, projectId, data, adopt]);

  // While a roll call is open, keep pulling the server's copy so other supervisors' ticks show up and our own
  // queued taps are replaced by the saved ones once they have been sent.
  useEffect(() => {
    if (!orgId || !baseId) return;
    const id = setInterval(() => {
      const current = baseRef.current;
      if (!current) return;
      getRollCall(api, { orgId, projectId }, current.id).then(adopt, () => undefined);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [orgId, projectId, baseId, adopt]);

  if (!orgId) {
    return (
      <Screen title="Roll call">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  const target = { orgId, projectId };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      adopt(await startRollCall(api, target, { reason: reason.trim(), idempotencyKey: uuidv7() }));
    } catch {
      setError(
        'Starting a roll call needs a connection, to list who is on site. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  /** Does the tap now if there is signal; otherwise keeps it on the phone with the time it was made. */
  const act = async (
    kind: ActionKind,
    payload: Record<string, unknown>,
    online: (at: string) => Promise<RollCall>,
  ) => {
    if (!base) return;
    const at = new Date().toISOString();
    setBusy(true);
    setError(null);
    try {
      let fresh: RollCall | null = null;
      await attempt(
        { projectId, kind, targetId: base.id, payload: { ...payload, at } },
        async () => {
          fresh = await online(at);
        },
      );
      if (fresh) adopt(fresh);
      pending.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status !== 0 && e.status < 500
          ? e.message
          : 'That did not go through. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!base) {
    return (
      <Screen title="Roll call">
        <Text style={{ color: t.color.text }}>
          Lists everyone signed in to this project right now so you can account for them. Once it is
          started, it keeps working with no signal.
        </Text>
        <TextField label="Reason" value={reason} onChangeText={setReason} />
        {error ? <StateMessage tone="danger" message={error} /> : null}
        <Button
          label="Start roll call"
          variant="danger"
          disabled={busy || reason.trim() === ''}
          onPress={() => void start()}
        />
      </Screen>
    );
  }

  const rollCall = applyQueued(base, pending.value ?? []);
  const nameOf = (id: string) => companies.data?.data.find((c) => c.id === id)?.name;
  const groups = groupByCompany(rollCall.people, nameOf);
  const ended = rollCall.endedAt !== null;
  const mark = (workerId: string, status: 'accounted_for' | 'missing') =>
    void act('rollcall.mark', { workerId, status }, (at) =>
      markRollCall(api, target, base.id, { workerId, status, clientAt: at }),
    );
  return (
    <Screen title="Roll call">
      <Text accessibilityLiveRegion="polite" style={[styles.progress, { color: t.color.text }]}>
        {progressLabel(rollCall.counts)}
      </Text>
      {waiting > 0 ? (
        <StateMessage
          message={`${waiting} ${waiting === 1 ? 'tap is' : 'taps are'} saved on this phone and will send when you are back online.`}
        />
      ) : null}
      {refused.length > 0 ? (
        <>
          <StateMessage
            tone="danger"
            message={`${refused.length} ${refused.length === 1 ? 'tap was' : 'taps were'} not accepted by the server. Check the list below.`}
          />
          <Button
            label="Dismiss"
            variant="secondary"
            onPress={() =>
              void Promise.all(refused.map((a) => data?.actions.discard(a.id))).then(
                pending.refresh,
              )
            }
          />
        </>
      ) : null}
      {error ? <StateMessage tone="danger" message={error} /> : null}
      {!ended && rollCall.counts.missing === 0 ? (
        <Button
          label="All accounted for"
          disabled={busy}
          onPress={() =>
            void act('rollcall.allClear', {}, (at) =>
              allClearRollCall(api, target, base.id, { clientAt: at }),
            )
          }
        />
      ) : null}
      {groups.map((g) => (
        <View key={g.company} style={{ gap: t.space[2] }}>
          <Text style={[styles.company, { color: t.color.textSecondary }]}>{g.company}</Text>
          {g.people.map((p) => (
            <View key={p.workerId} style={{ gap: t.space[2], paddingVertical: t.space[2] }}>
              <Text style={{ color: t.color.text }}>
                {p.fullName}
                {p.phone ? ` · ${p.phone}` : ''}
              </Text>
              <Text
                style={{
                  color: p.status === 'missing' ? t.color.statusDanger : t.color.textSecondary,
                }}
              >
                {markLabel[p.status]}
              </Text>
              {ended ? null : (
                <View style={styles.row}>
                  <Button
                    label="Accounted for"
                    disabled={busy || p.status === 'accounted_for'}
                    onPress={() => mark(p.workerId, 'accounted_for')}
                  />
                  <Button
                    label="Missing"
                    variant="secondary"
                    disabled={busy || p.status === 'missing'}
                    onPress={() => mark(p.workerId, 'missing')}
                  />
                </View>
              )}
            </View>
          ))}
        </View>
      ))}
      {ended ? (
        <StateMessage message="Roll call ended. It is kept as the record of the event." />
      ) : (
        <Button
          label="End roll call"
          variant="secondary"
          disabled={busy}
          onPress={() => void act('rollcall.end', {}, () => endRollCall(api, target, base.id))}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { fontSize: 20, fontWeight: '700' },
  company: { fontSize: 14, fontWeight: '600', textTransform: 'uppercase' },
  row: { flexDirection: 'row', gap: 8 },
});
