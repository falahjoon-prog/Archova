// The drawing register from the device store (DOC-AC5), so it opens with no signal. A row opens the viewer.
import { useRouter } from 'expo-router';
import type { DrawingSheet } from '@archova/contracts';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen } from '@archova/ui-native';
import { StateMessage, useDeviceData, useLocalQuery } from '../../../shared';
import { registerRows } from '../register';

export function DrawingRegisterScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const sheets = useLocalQuery(
    data
      ? async () => ({
          sheets: (await data.store.listRecords<DrawingSheet>('drawing_sheet', projectId)).map(
            (r) => r.data,
          ),
          saved: await data.sheets.savedRevisionIds(projectId),
        })
      : null,
    [data, projectId],
  );

  if (!data || sheets.value === null) {
    return (
      <Screen title="Drawings">
        <StateMessage
          loading={device.status === 'opening' || (data !== null && sheets.value === null)}
          message="Opening drawings"
        />
      </Screen>
    );
  }
  const rows = registerRows(sheets.value.sheets, sheets.value.saved);
  return (
    <Screen title="Drawings">
      {rows.length === 0 ? (
        <StateMessage message="No drawings on this device yet. Connect and sync to get this project's sheets." />
      ) : null}
      {rows.map((r) => (
        <ListItem
          key={r.id}
          title={r.title}
          subtitle={r.subtitle}
          onPress={
            r.revisionId
              ? () => router.push(mobileRoutes.drawingSheet(projectId, r.revisionId as string))
              : undefined
          }
        />
      ))}
    </Screen>
  );
}
