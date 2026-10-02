import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen, fontWeight, useTheme } from '@archova/ui-native';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { useMe, useProjects } from '../hooks';

export function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const { orgId, setOrgId } = useCurrentOrg();
  const me = useMe();
  const projects = useProjects(orgId);

  const sectionTitle = (text: string) => (
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

  return (
    <Screen title="Home">
      {sectionTitle('Organisations')}
      {me.isPending ? (
        <StateMessage loading message="Loading your organisations" />
      ) : me.isError ? (
        <StateMessage
          tone="danger"
          message="Could not load your organisations."
          onRetry={() => void me.refetch()}
        />
      ) : me.data.memberships.length === 0 ? (
        <StateMessage message="You are not a member of any organisation yet." />
      ) : (
        me.data.memberships.map((m) => (
          <ListItem
            key={m.orgId}
            title={m.orgName}
            subtitle={m.kind === 'external' ? 'External collaborator' : (m.role ?? null)}
            selected={m.orgId === orgId}
            accessibilityHint="Shows this organisation's projects"
            onPress={() => setOrgId(m.orgId)}
            testID={`org-${m.orgId}`}
          />
        ))
      )}

      {orgId ? (
        <>
          {sectionTitle('Projects')}
          {projects.isPending ? (
            <StateMessage loading message="Loading projects" />
          ) : projects.isError ? (
            <StateMessage
              tone="danger"
              message="Could not load projects."
              onRetry={() => void projects.refetch()}
            />
          ) : projects.data.data.length === 0 ? (
            <StateMessage message="No projects in this organisation yet." />
          ) : (
            projects.data.data.map((p) => (
              <ListItem
                key={p.id}
                title={p.name}
                subtitle={p.number}
                accessibilityHint="Opens the project"
                onPress={() => router.push(mobileRoutes.project(p.id))}
                testID={`project-${p.id}`}
              />
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}
