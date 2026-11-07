// What this device keeps offline, and the changes the server could not apply (mobile 02 §2.4, §2.8).
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, ListItem, Screen, fontWeight, useTheme } from '@archova/ui-native';
import { StateMessage, useCurrentOrg, useDeviceData, useLocalQuery } from '../../../shared';
import { uuidv7 } from '@archova/domain';
import {
  attentionReason,
  canReapply,
  commandLabel,
  formatBytes,
  reapplyEntries,
} from '../../../lib/sync/attention';
import { useProjects } from '../hooks';

export function OfflineScreen() {
  const t = useTheme();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const { orgId } = useCurrentOrg();
  const projects = useProjects(orgId);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useLocalQuery(
    data
      ? async () => {
          const excluded = await data.offline.excludedIds();
          const ids = new Set([...(await data.offline.knownProjectIds())]);
          for (const p of projects.data?.data ?? []) ids.add(p.id);
          return Promise.all(
            [...ids].map(async (id) => ({
              id,
              kept: !excluded.has(id),
              unsynced: await data.offline.unsyncedCount(id),
              records: await data.offline.recordCount(id),
              bytes: await data.offline.storageBytes(id),
            })),
          );
        }
      : null,
    [data, projects.data],
  );
  const attention = useLocalQuery(
    data ? () => data.store.listOutbox({ status: 'needs_attention' }) : null,
    [data],
  );

  if (!data) {
    return (
      <Screen title="Offline data">
        <StateMessage loading={device.status === 'opening'} message="Opening device storage" />
      </Screen>
    );
  }
  const nameOf = (id: string) =>
    projects.data?.data.find((p) => p.id === id)?.name ?? `Project ${id.slice(0, 8)}`;
  const heading = (text: string) => (
    <Text
      accessibilityRole="header"
      style={{
        color: t.color.text,
        fontSize: t.font.size.lg,
        fontWeight: fontWeight(t.font.weight.semibold),
      }}
    >
      {text}
    </Text>
  );

  async function toggle(id: string, kept: boolean) {
    if (!data) return;
    if (kept) {
      const result = await data.offline.remove(id);
      setNotice(
        result.ok
          ? null
          : `${nameOf(id)} has ${result.unsynced} change${result.unsynced === 1 ? '' : 's'} waiting to sync. Connect and sync before removing it.`,
      );
    } else {
      await data.offline.keep(id);
      setNotice(null);
      data.requestSync('manual');
    }
    rows.refresh();
  }

  return (
    <Screen title="Offline data">
      {notice ? <StateMessage tone="danger" message={notice} /> : null}
      {heading('Needs attention')}
      {attention.value !== null && attention.value.length === 0 ? (
        <StateMessage message="Everything you changed has been accepted." />
      ) : null}
      {(attention.value ?? []).map((e) => (
        <ListItem
          key={e.mutationId}
          title={commandLabel(e.command)}
          subtitle={attentionReason(e)}
          testID={`attention-${e.mutationId}`}
        />
      ))}
      {(attention.value ?? []).some(canReapply) ? (
        <Button
          label="Try these changes again"
          onPress={async () => {
            await reapplyEntries(data.store, attention.value ?? [], uuidv7);
            attention.refresh();
            data.requestSync('manual');
          }}
          testID="reapply-attention"
        />
      ) : null}
      {(attention.value ?? []).length > 0 ? (
        <Button
          label="Discard these changes"
          variant="secondary"
          onPress={async () => {
            await data.store.removeEntries((attention.value ?? []).map((e) => e.mutationId));
            attention.refresh();
          }}
          testID="discard-attention"
        />
      ) : null}
      {heading('Projects on this device')}
      {rows.value !== null && rows.value.length === 0 ? (
        <StateMessage message="No projects yet." />
      ) : null}
      {(rows.value ?? []).map((r) => (
        <ListItem
          key={r.id}
          title={nameOf(r.id)}
          subtitle={
            r.kept
              ? [
                  `${r.records} record${r.records === 1 ? '' : 's'} · ${formatBytes(r.bytes)}`,
                  r.unsynced > 0 ? `${r.unsynced} waiting to sync` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Not kept offline'
          }
          accessibilityHint={r.kept ? 'Remove from this device' : 'Keep on this device'}
          onPress={() => void toggle(r.id, r.kept)}
          testID={`offline-${r.id}`}
        />
      ))}
    </Screen>
  );
}
