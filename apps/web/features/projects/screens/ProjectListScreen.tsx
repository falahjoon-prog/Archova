'use client';

import { Card, PageHeader } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { Loading } from '@/shared/layout/Loading';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { ProjectTable } from '../components/ProjectTable';
import { NewProjectForm } from '../forms/NewProjectForm';
import { useProjects } from '../hooks/useProjectQueries';

export function ProjectListScreen() {
  const org = useCurrentOrg();
  const projects = useProjects(org.orgId);
  return (
    <>
      <PageHeader title="Projects" description={`Projects you can see in ${org.orgName}.`} />
      <div className="stack-lg">
        <Card title="All projects">
          {projects.isPending ? <Loading label="Loading projects…" /> : null}
          <ErrorAlert error={projects.error} title="We couldn't load projects" />
          {projects.data && projects.data.data.length === 0 ? (
            <p className="u-muted">No projects yet. Create your first project below.</p>
          ) : null}
          {projects.data && projects.data.data.length > 0 ? (
            <ProjectTable orgSlug={org.orgSlug} projects={projects.data.data} />
          ) : null}
        </Card>
        <Card title="New project">
          <NewProjectForm orgId={org.orgId} />
        </Card>
      </div>
    </>
  );
}
