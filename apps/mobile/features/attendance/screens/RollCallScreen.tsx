// Evacuation roll call for supervisors (ATT-AC5): start it from who is on site, tick people off, end it.
// Needs a connection. The roll call is held on this screen, so leaving it before ending loses the place.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { RollCall } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { Button, Screen, TextField, useTheme } from '@archova/ui-native';
import { api, queries } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { endRollCall, markRollCall, startRollCall } from '../commands';
import { groupByCompany, markLabel, progressLabel } from '../rollcall';

export function RollCallScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const companies = useQuery({ ...queries.companies(orgId ?? ''), enabled: orgId !== null });
  const [reason, setReason] = useState('Evacuation');
  const [rollCall, setRollCall] = useState<RollCall | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!orgId) {
    return (
      <Screen title="Roll call">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  const target = { orgId, projectId };

  const attempt = async (call: () => Promise<RollCall>) => {
    setBusy(true);
    setError(null);
    try {
      setRollCall(await call());
    } catch {
      setError('That did not go through. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!rollCall) {
    return (
      <Screen title="Roll call">
        <Text style={{ color: t.color.text }}>
          Lists everyone signed in to this project right now so you can account for them.
        </Text>
        <TextField label="Reason" value={reason} onChangeText={setReason} />
        {error ? <StateMessage tone="danger" message={error} /> : null}
        <Button
          label="Start roll call"
          variant="danger"
          disabled={busy || reason.trim() === ''}
          onPress={() =>
            void attempt(() =>
              startRollCall(api, target, { reason: reason.trim(), idempotencyKey: uuidv7() }),
            )
          }
        />
      </Screen>
    );
  }

  const nameOf = (id: string) => companies.data?.data.find((c) => c.id === id)?.name;
  const groups = groupByCompany(rollCall.people, nameOf);
  const ended = rollCall.endedAt !== null;
  return (
    <Screen title="Roll call">
      <Text accessibilityLiveRegion="polite" style={[styles.progress, { color: t.color.text }]}>
        {progressLabel(rollCall.counts)}
      </Text>
      {error ? <StateMessage tone="danger" message={error} /> : null}
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
                    onPress={() =>
                      void attempt(() =>
                        markRollCall(api, target, rollCall.id, {
                          workerId: p.workerId,
                          status: 'accounted_for',
                        }),
                      )
                    }
                  />
                  <Button
                    label="Missing"
                    variant="secondary"
                    disabled={busy || p.status === 'missing'}
                    onPress={() =>
                      void attempt(() =>
                        markRollCall(api, target, rollCall.id, {
                          workerId: p.workerId,
                          status: 'missing',
                        }),
                      )
                    }
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
          onPress={() => void attempt(() => endRollCall(api, target, rollCall.id))}
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
