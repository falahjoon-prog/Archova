'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { can, type EffectivePermissions } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { BookmarksCard } from '@/features/bookmarks';
import { ConversationsCard } from '@/features/conversations';
import { RecentsCard } from '@/features/recents';
import { KeyDatesCard } from '@/features/schedule';
import { Button, Card, Dialog, PageHeader } from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { Loading } from '@/shared/layout/Loading';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { DirectionsCard } from '../components/DirectionsCard';
import { PhotosCard } from '../components/PhotosCard';
import { MemberList } from '../components/MemberList';
import { NeedsAttentionCard, OpenItemsCard } from '../components/ProjectOverviewCards';
import { AddMemberForm } from '../forms/AddMemberForm';
import {
  useCompanies,
  usePermissionTemplates,
  useProject,
  useProjectMembers,
  useProjectPermissions,
} from '../hooks/useProjectQueries';
import { AU_STATE_NAMES, isAuState, statusLabel } from '../lib/labels';

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const org = useCurrentOrg();
  const [addingMember, setAddingMember] = useState(false);
  usePublishAssistantScope({ projectId });
  const project = useProject(org.orgId, projectId);
  const members = useProjectMembers(org.orgId, projectId);
  const permissions = useProjectPermissions(org.orgId, projectId);

  // UI gating only; the API enforces the same rule (frontend 02 §6). The contract types tool names as plain
  // strings, while `can()` takes the domain's narrower `Tool` union; unknown tools are simply never matched.
  const canManageMembers = permissions.data
    ? can(permissions.data as EffectivePermissions, 'platform.project_members.manage')
    : false;

  // Names for the member table. Only fetched when the caller manages members (they need the same reference data).
  const companies = useCompanies(org.orgId, canManageMembers);
  const templates = usePermissionTemplates(org.orgId, canManageMembers);
  const companyNames = useMemo(
    () => new Map((companies.data?.data ?? []).map((c) => [c.id, c.name] as const)),
    [companies.data],
  );
  const templateNames = useMemo(
    () => new Map((templates.data?.data ?? []).map((t) => [t.id, t.name] as const)),
    [templates.data],
  );

  if (project.isPending) return <Loading label="Loading project…" />;
  if (project.isError) {
    return (
      <div className="stack">
        <ErrorAlert error={project.error} title="We couldn't open this project" />
        <p>
          <Link className="link" href={webRoutes.projects(org.orgSlug)}>
            Back to projects
          </Link>
        </p>
      </div>
    );
  }

  const p = project.data;
  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link className="link" href={webRoutes.projects(org.orgSlug)}>
          Projects
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{p.name}</span>
      </nav>
      <PageHeader title={p.name} eyebrow={p.number ? `Project ${p.number}` : undefined} />
      <div className="project-overview">
        <div className="project-overview__col">
          <Card title="Project information">
            <dl className="details">
              <div>
                <dt>Status</dt>
                <dd>{statusLabel(p.status)}</dd>
              </div>
              <div>
                <dt>State or territory</dt>
                <dd>{p.state && isAuState(p.state) ? AU_STATE_NAMES[p.state] : 'Not set'}</dd>
              </div>
              <div>
                <dt>Project number</dt>
                <dd className="u-mono">{p.number ?? 'Not set'}</dd>
              </div>
              <div>
                <dt>Time zone</dt>
                <dd>{p.timezone}</dd>
              </div>
            </dl>
          </Card>
          <KeyDatesCard
            projectId={projectId}
            timeZone={p.timezone}
            permissions={permissions.data as EffectivePermissions | undefined}
          />
          <BookmarksCard projectId={projectId} />
          <ConversationsCard projectId={projectId} timeZone={p.timezone} />
        </div>
        <div className="project-overview__col">
          <OpenItemsCard orgSlug={org.orgSlug} projectId={projectId} timeZone={p.timezone} />
          <NeedsAttentionCard orgSlug={org.orgSlug} projectId={projectId} timeZone={p.timezone} />
          <DirectionsCard
            projectId={projectId}
            permissions={permissions.data as EffectivePermissions | undefined}
          />
          <RecentsCard projectId={projectId} />
          <PhotosCard projectId={projectId} timeZone={p.timezone} />
        </div>
      </div>
      <div className="stack-lg project-overview__below">
        <Card
          title="Members"
          actions={
            canManageMembers ? (
              <Button variant="secondary" onClick={() => setAddingMember(true)}>
                <Plus size={20} aria-hidden="true" /> Add member
              </Button>
            ) : undefined
          }
        >
          {members.isPending ? <Loading label="Loading members…" /> : null}
          <ErrorAlert error={members.error} title="We couldn't load members" />
          {members.data ? (
            <MemberList
              members={members.data.data}
              companyNames={companyNames}
              templateNames={templateNames}
            />
          ) : null}
        </Card>
        <ErrorAlert
          error={permissions.error}
          title="We couldn't check your permissions on this project"
        />
        <Dialog open={addingMember} onClose={() => setAddingMember(false)} title="Add member">
          <AddMemberForm orgId={org.orgId} projectId={projectId} />
        </Dialog>
      </div>
    </>
  );
}
