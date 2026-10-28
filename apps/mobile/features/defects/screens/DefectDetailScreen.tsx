// One defect: details, photos and the actions this user may take (DEF-US5, US6). Everything works offline;
// the server re-checks each action when it syncs.
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  availableDefectActions,
  defectLabel,
  uuidv7,
  type DefectAction,
  type DefectActor,
} from '@archova/domain';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { StateMessage, useDeviceData, useLocalQuery } from '../../../shared';
import {
  DEFECT_ENTITY,
  defectPhotos,
  transitionDefect,
  type CommandError,
  type LocalDefect,
} from '../commands';
import { actionLabel, stageLabel, statusLabel } from './labels';

const NEEDS_REASON: ReadonlySet<DefectAction> = new Set(['reject', 'dispute', 'void']);

const errorText: Partial<Record<CommandError, string>> = {
  'defect.reason_required': 'Add a reason. The other company will see it.',
  'defect.photo_required': 'Take an "after" photo of the fix first.',
  'defect.not_allowed': 'Your company cannot do that on this defect.',
  'defect.invalid_transition': 'This defect has changed. Pull to refresh and try again.',
};

export function DefectDetailScreen({
  projectId,
  defectId,
  myCompanyId,
}: {
  projectId: string;
  defectId: string;
  /** The user's company on this project, from the synced membership; decides builder or assignee actions. */
  myCompanyId: string | null;
}) {
  const t = useTheme();
  const router = useRouter();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const state = useLocalQuery(
    data
      ? async () => {
          const record = await data.store.get(DEFECT_ENTITY, defectId);
          if (!record) return null;
          const defect = record.data as LocalDefect;
          return { defect, record, photos: await defectPhotos(data.store, defect) };
        }
      : null,
    [data, defectId],
  );

  if (!data || state.value === null) {
    return (
      <Screen title="Defect">
        <StateMessage
          loading={device.status === 'opening' || (data !== null && state.value === null)}
          message="Loading defect"
        />
      </Screen>
    );
  }
  const { defect, record, photos } = state.value;
  const actor: DefectActor =
    myCompanyId !== null && myCompanyId === defect.assigneeCompanyId ? 'assignee' : 'builder';
  // Issuing and reassigning need a company, which is picked on the web or when raising the defect.
  const actions = availableDefectActions(defect.status, actor).filter(
    (a) => !((a === 'issue' || a === 'reassign') && defect.assigneeCompanyId === null),
  );

  const afterPhoto = defect.status === 'open' && actor === 'assignee';

  const run = async (action: DefectAction) => {
    setError(null);
    const evidence = photos
      .filter((p) => p.isNewEvidence && p.mutationId !== null)
      .map((p) => ({ photoId: p.photoId, mutationId: p.mutationId! }));
    const result = await transitionDefect(data.store, {
      defect,
      version: record.version,
      action,
      actor,
      mutationId: uuidv7(),
      reason: NEEDS_REASON.has(action) ? reason : null,
      photos: action === 'markReadyForReview' ? evidence : [],
      clientAt: new Date().toISOString(),
    });
    if (!result.ok) {
      setError(errorText[result.code] ?? 'That could not be saved.');
      return;
    }
    setReason('');
    state.refresh();
    data.requestSync('local_write');
  };

  return (
    <Screen title={`${defectLabel(defect.number)} · ${defect.title}`}>
      <ListItem
        title="Status"
        subtitle={`${statusLabel[defect.status]}${record.pending ? ' · Waiting to sync' : ''}`}
      />
      {defect.description ? <ListItem title="Description" subtitle={defect.description} /> : null}
      {defect.trade ? <ListItem title="Trade" subtitle={defect.trade} /> : null}
      <ListItem title="Stage" subtitle={stageLabel[defect.stage]} />
      {defect.dueDate ? <ListItem title="Due" subtitle={defect.dueDate} /> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] }}>
        {photos.map((p) =>
          p.thumbnailUri ? (
            <Image
              key={p.photoId}
              source={{ uri: p.thumbnailUri }}
              style={{ width: 88, height: 88, borderRadius: t.radius.md }}
              accessibilityLabel={p.purpose === 'after' ? 'After photo' : 'Defect photo'}
            />
          ) : null,
        )}
      </View>
      <Button
        variant="secondary"
        label={afterPhoto ? 'Take after photo' : 'Add photo'}
        onPress={() =>
          router.push(
            mobileRoutes.defectPhoto(projectId, defectId, afterPhoto ? 'after' : 'before'),
          )
        }
      />

      {actions.some((a) => NEEDS_REASON.has(a)) ? (
        <TextField
          label="Reason"
          value={reason}
          onChangeText={setReason}
          hint="Needed to reject, dispute or void"
          multiline
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: t.color.statusDanger }}>
          {error}
        </Text>
      ) : null}
      {actions.map((a) => (
        <Button
          key={a}
          label={actionLabel[a]}
          variant={a === 'void' || a === 'reject' ? 'danger' : 'primary'}
          onPress={() => void run(a)}
        />
      ))}
    </Screen>
  );
}
