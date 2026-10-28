'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { atLeast, type EffectivePermissions, type Tool } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
import {
  DefectsIcon,
  DiaryIcon,
  DocumentsIcon,
  DrawingsIcon,
  EstimatingIcon,
  HomeIcon,
  InductionsIcon,
  RfisIcon,
} from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { Loading } from '@/shared/layout/Loading';
import { ProjectNav, type ProjectNavGroup, type ProjectNavItem } from '@/shared/layout/ProjectNav';
import { CurrentProjectProvider } from '@/shared/providers/CurrentProjectProvider';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useProject, useProjectPermissions } from '../hooks/useProjectQueries';

/**
 * The project layout (frontend 03 §2): loads the project and the caller's permissions, provides the project to
 * every tool screen, and shows only the tools the caller can at least read (design 03 §3). UI gating only; the
 * API enforces the same rules.
 */
export function ProjectShell({ projectId, children }: { projectId: string; children: ReactNode }) {
  const org = useCurrentOrg();
  const project = useProject(org.orgId, projectId);
  const permissions = useProjectPermissions(org.orgId, projectId);

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
  const perms = permissions.data as EffectivePermissions | undefined;
  const groups = projectToolGroups(org.orgSlug, projectId, perms);

  return (
    <CurrentProjectProvider
      project={{
        projectId,
        name: p.name,
        number: p.number ?? null,
        timezone: p.timezone,
        state: p.state ?? null,
        companyId: perms?.companyId ?? null,
      }}
    >
      <div className="project-shell">
        <ProjectNav projectName={p.name} groups={groups} />
        <div className="project-shell__content">{children}</div>
      </div>
    </CurrentProjectProvider>
  );
}

/**
 * Tool groups for the sidebar. While permissions load, tools are shown (the API still enforces); once loaded, a
 * tool needs at least Read. Estimating has no permission tool yet (X30 added the module after Sam's tool list), so
 * it is shown to every project member until the `estimating` tool key lands in `@archova/domain`.
 */
export function projectToolGroups(
  orgSlug: string,
  projectId: string,
  perms: Pick<EffectivePermissions, 'toolLevels' | 'orgRole'> | undefined,
): ProjectNavGroup[] {
  const canRead = (tool: Tool) =>
    !perms ||
    perms.orgRole === 'owner' ||
    perms.orgRole === 'admin' ||
    atLeast(perms.toolLevels[tool], 'read');
  const core: Array<ProjectNavItem | false> = [
    canRead('documents') && {
      href: webRoutes.documents(orgSlug, projectId),
      label: 'Documents',
      icon: DocumentsIcon,
    },
    canRead('documents') && {
      href: webRoutes.drawings(orgSlug, projectId),
      label: 'Drawings',
      icon: DrawingsIcon,
    },
    canRead('rfis') && { href: webRoutes.rfis(orgSlug, projectId), label: 'RFIs', icon: RfisIcon },
    canRead('diary') && {
      href: webRoutes.diary(orgSlug, projectId),
      label: 'Site diary',
      icon: DiaryIcon,
    },
    canRead('defects') && {
      href: webRoutes.defects(orgSlug, projectId),
      label: 'Defects',
      icon: DefectsIcon,
    },
    canRead('workforce') && {
      href: webRoutes.inductions(orgSlug, projectId),
      label: 'Inductions',
      icon: InductionsIcon,
    },
  ];
  return [
    {
      items: [
        {
          href: webRoutes.project(orgSlug, projectId),
          label: 'Project home',
          icon: HomeIcon,
          exact: true,
        },
      ],
    },
    { label: 'Core', items: core.filter((x): x is ProjectNavItem => Boolean(x)) },
    {
      label: 'Estimating',
      items: [
        {
          href: webRoutes.tenderPackages(orgSlug, projectId),
          label: 'Tender packages',
          icon: EstimatingIcon,
        },
      ],
    },
  ];
}
