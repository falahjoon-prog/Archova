// The tender packages on one project that this person can see. A subcontractor sees the ones they were invited to.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { listProjectPackages } from '../commands';
import { packageSubtitle } from '../quoting';

export function ProjectPackagesScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const packages = useQuery({
    queryKey: ['tenders', orgId, projectId],
    queryFn: () => listProjectPackages(api, { orgId: orgId!, projectId }),
    enabled: orgId !== null,
  });

  if (!orgId) {
    return (
      <Screen title="Tenders">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (packages.isPending) {
    return (
      <Screen title="Tenders">
        <StateMessage loading message="Loading tender packages" />
      </Screen>
    );
  }
  if (packages.isError) {
    return (
      <Screen title="Tenders">
        <StateMessage
          tone="danger"
          message="Could not load tender packages. This needs a connection."
          onRetry={() => void packages.refetch()}
        />
      </Screen>
    );
  }
  return (
    <Screen title="Tenders">
      {packages.data.length === 0 ? (
        <StateMessage message="No tender packages for you on this project." />
      ) : null}
      {packages.data.map((p) => (
        <ListItem
          key={p.id}
          title={`${p.numberLabel}  ${p.name}`}
          subtitle={packageSubtitle(p)}
          accessibilityHint="Opens the package and your quote"
          onPress={() => router.push(mobileRoutes.tender(projectId, p.id))}
          testID={`tender-${p.id}`}
        />
      ))}
    </Screen>
  );
}
