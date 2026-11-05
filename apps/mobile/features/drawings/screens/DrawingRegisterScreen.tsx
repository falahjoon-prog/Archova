// The drawing register from the device store (DOC-AC5), so it opens with no signal. A row opens the viewer.
import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { DrawingSheet } from '@archova/contracts';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { queries } from '../../../lib/api';
import { saveAllSheets, type SheetTiles } from '../../../lib/files/sheet-cache';
import { StateMessage, useCurrentOrg, useDeviceData, useLocalQuery } from '../../../shared';
import { registerRows, saveAllSummary } from '../register';

export function DrawingRegisterScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();
  const { orgId } = useCurrentOrg();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const cancelled = useRef(false);
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
  const toSave = rows.filter((r) => r.revisionId);
  const unsaved = toSave.filter((r) => !sheets.value?.saved.has(r.revisionId as string));

  const saveAll = async () => {
    if (!orgId) return;
    cancelled.current = false;
    setSummary(null);
    setProgress({ done: 0, total: toSave.length });
    try {
      const result = await saveAllSheets(
        data.sheets,
        toSave.map((r) => ({ projectId, revisionId: r.revisionId as string })),
        async (revisionId) => {
          const d = await queryClient.fetchQuery(
            queries.drawingTiles(orgId, projectId, revisionId),
          );
          if (!d.width || !d.height || !d.levels || !d.tileUrlTemplate) return null;
          const tiles: SheetTiles & { ready: boolean } = {
            ready: d.status === 'ready',
            width: d.width,
            height: d.height,
            tileSize: d.tileSize ?? 256,
            levels: d.levels,
            overviewUrl: d.overviewUrl,
            tileUrlTemplate: d.tileUrlTemplate,
          };
          return tiles;
        },
        { isCancelled: () => cancelled.current, onProgress: setProgress },
      );
      setSummary(saveAllSummary(result));
    } catch {
      setSummary('Could not save the sheets. Check your signal and try again.');
    }
    setProgress(null);
    sheets.refresh();
  };
  return (
    <Screen title="Drawings">
      {toSave.length > 0 ? (
        <>
          {progress ? (
            <>
              <Text style={{ color: t.color.text }}>
                {`Saving sheet ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`}
              </Text>
              <Button
                label="Stop"
                variant="secondary"
                onPress={() => {
                  cancelled.current = true;
                }}
              />
            </>
          ) : (
            <Button
              label={
                unsaved.length === 0
                  ? 'All sheets are on this device'
                  : `Save all sheets for offline (${unsaved.length} to go)`
              }
              variant="secondary"
              disabled={unsaved.length === 0 || orgId === null}
              onPress={() => void saveAll()}
            />
          )}
          {summary ? <Text style={{ color: t.color.textSecondary }}>{summary}</Text> : null}
        </>
      ) : null}
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
