import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen } from '@archova/ui-native';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { useProject } from '../hooks';

/** Project overview. `orgId` comes from the selected org, or from `?orgId=` on a deep link. */
export function ProjectScreen({
  projectId,
  orgId: orgIdParam,
}: {
  projectId: string;
  orgId?: string | undefined;
}) {
  const router = useRouter();
  const { orgId: currentOrgId, setProjectId } = useCurrentOrg();
  const orgId = orgIdParam ?? currentOrgId;
  const project = useProject(orgId, projectId);
  const loaded = project.isSuccess;

  // Opening a project makes it the current one for capture.
  useEffect(() => {
    if (loaded) setProjectId(projectId);
  }, [loaded, projectId, setProjectId]);

  if (!orgId) {
    return (
      <Screen title="Project">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (project.isPending) {
    return (
      <Screen title="Project">
        <StateMessage loading message="Loading project" />
      </Screen>
    );
  }
  if (project.isError) {
    return (
      <Screen title="Project">
        <StateMessage
          tone="danger"
          message="Could not load this project."
          onRetry={() => void project.refetch()}
        />
      </Screen>
    );
  }
  const p = project.data;
  const address = p.address
    ? [p.address.line1, p.address.suburb, p.address.state].filter(Boolean).join(', ')
    : null;

  return (
    <Screen title={p.name}>
      {p.number ? <ListItem title="Number" subtitle={p.number} /> : null}
      <ListItem title="Status" subtitle={p.status} />
      {address ? <ListItem title="Address" subtitle={address} /> : null}
      <ListItem title="Time zone" subtitle={p.timezone} />
      <ListItem
        title="Defects"
        subtitle="Raise, fix and close defects, offline"
        onPress={() => router.push(mobileRoutes.defects(projectId))}
      />
    </Screen>
  );
}
