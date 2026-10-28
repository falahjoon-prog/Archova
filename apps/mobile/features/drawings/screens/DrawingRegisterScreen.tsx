// The drawing register, online only for now (DOC-AC5). The viewer opens from a row once tiles are served.
import { useQuery } from '@tanstack/react-query';
import { ListItem, Screen } from '@archova/ui-native';
import { queries } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { registerRows } from '../register';

export function DrawingRegisterScreen({ projectId }: { projectId: string }) {
  const { orgId } = useCurrentOrg();
  const drawings = useQuery({
    ...queries.drawings(orgId ?? '', projectId),
    enabled: orgId !== null,
  });

  if (!orgId) {
    return (
      <Screen title="Drawings">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (drawings.isPending) {
    return (
      <Screen title="Drawings">
        <StateMessage loading message="Loading drawings" />
      </Screen>
    );
  }
  if (drawings.isError) {
    return (
      <Screen title="Drawings">
        <StateMessage
          tone="danger"
          message="Could not load drawings. Check your connection."
          onRetry={() => void drawings.refetch()}
        />
      </Screen>
    );
  }
  const rows = registerRows(drawings.data.data);
  return (
    <Screen title="Drawings">
      {rows.length === 0 ? <StateMessage message="No drawings on this project yet." /> : null}
      {rows.map((r) => (
        <ListItem key={r.id} title={r.title} subtitle={r.subtitle} />
      ))}
    </Screen>
  );
}
