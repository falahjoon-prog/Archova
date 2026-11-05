// Project inspections from the device store. Works offline; unsent answers say so.
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen } from '@archova/ui-native';
import { StateMessage, useDeviceData, useLocalQuery } from '../../../shared';
import { listInspections, statusLabel } from '../commands';

export function InspectionListScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const rows = useLocalQuery(data ? () => listInspections(data.store, projectId) : null, [
    data,
    projectId,
  ]);

  if (!data) {
    return (
      <Screen title="Inspections">
        <StateMessage loading={device.status === 'opening'} message="Opening device storage" />
      </Screen>
    );
  }
  const items = rows.value ?? [];
  return (
    <Screen title="Inspections">
      {rows.value !== null && items.length === 0 ? (
        <StateMessage message="No inspections on this device yet. Start one on the web, then sync." />
      ) : null}
      {items.map((i) => (
        <ListItem
          key={i.id}
          title={`${i.numberLabel} · ${i.title}`}
          subtitle={[
            statusLabel[i.status],
            i.location,
            i.missingRequiredItemIds.length > 0 && i.status !== 'submitted' && i.status !== 'closed'
              ? `${i.missingRequiredItemIds.length} to answer`
              : null,
            i.pending ? 'Waiting to sync' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          onPress={() => router.push(mobileRoutes.inspection(projectId, i.id))}
          testID={`inspection-${i.id}`}
        />
      ))}
    </Screen>
  );
}
