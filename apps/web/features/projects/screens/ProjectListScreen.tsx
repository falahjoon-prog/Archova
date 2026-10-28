'use client';

import { useState } from 'react';
import { Button, Dialog, EmptyState, PageHeader, SkeletonRows } from '@archova/ui';
import { FolderOpen, Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { ProjectCards } from '../components/ProjectCards';
import { NewProjectForm } from '../forms/NewProjectForm';
import { useProjects } from '../hooks/useProjectQueries';

export function ProjectListScreen() {
  const org = useCurrentOrg();
  const projects = useProjects(org.orgId);
  const [creating, setCreating] = useState(false);
  const newProject = (
    <Button onClick={() => setCreating(true)}>
      <Plus size={20} aria-hidden="true" /> New project
    </Button>
  );
  return (
    <>
      <PageHeader
        title="Projects"
        description={`Projects you can see in ${org.orgName}.`}
        actions={newProject}
      />
      {projects.isPending ? <SkeletonRows rows={3} label="Loading projects…" /> : null}
      <ErrorAlert error={projects.error} title="We couldn't load projects" />
      {projects.data && projects.data.data.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="Create your first project to start adding drawings, RFIs and the site diary."
          action={newProject}
        />
      ) : null}
      {projects.data && projects.data.data.length > 0 ? (
        <ProjectCards orgSlug={org.orgSlug} projects={projects.data.data} />
      ) : null}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New project">
        <NewProjectForm orgId={org.orgId} onCreated={() => setCreating(false)} />
      </Dialog>
    </>
  );
}
