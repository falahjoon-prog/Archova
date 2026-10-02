// Project defects from the device store (product 06, DEF-US4). Works offline; unsent ones say so.
import { useRouter } from 'expo-router';
import { defectLabel } from '@archova/domain';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen } from '@archova/ui-native';
import { StateMessage, useDeviceData, useLocalQuery } from '../../../shared';
import { listDefects } from '../commands';
import { statusLabel } from './labels';

export function DefectListScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const defects = useLocalQuery(data ? () => listDefects(data.store, projectId) : null, [
    data,
    projectId,
  ]);

  if (!data) {
    return (
      <Screen title="Defects">
        <StateMessage loading={device.status === 'opening'} message="Opening device storage" />
      </Screen>
    );
  }
  const items = defects.value ?? [];
  return (
    <Screen title="Defects">
      <Button label="Raise defect" onPress={() => router.push(mobileRoutes.newDefect(projectId))} />
      {defects.value !== null && items.length === 0 ? (
        <StateMessage message="No defects on this project yet." />
      ) : null}
      {items.map((d) => (
        <ListItem
          key={d.id}
          title={`${defectLabel(d.number)} · ${d.title}`}
          subtitle={[statusLabel[d.status], d.trade, d.pending ? 'Waiting to sync' : null]
            .filter(Boolean)
            .join(' · ')}
          onPress={() => router.push(mobileRoutes.defect(projectId, d.id))}
        />
      ))}
    </Screen>
  );
}
