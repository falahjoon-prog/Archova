'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { atLeast, type EffectivePermissions, type Tool } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
import {
  AttendanceIcon,
  ObservationsIcon,
  InspectionsIcon,
  SwmsIcon,
  IncidentsIcon,
  LateSubmissionsIcon,
  OwnerPortalIcon,
  FolderLinksIcon,
  ImportsIcon,
  DefectsIcon,
  MeetingsIcon,
  ProgrammeIcon,
  ContractsIcon,
  BudgetIcon,
  DelaysIcon,
  DiaryIcon,
  DocumentsIcon,
  TransmittalsIcon,
  DrawingsIcon,
  EstimatingIcon,
  HomeIcon,
  InductionsIcon,
  RfisIcon,
  SubmittalsIcon,
  CoordinationIcon,
  CorrespondenceIcon,
  AdminIcon,
  type LucideIcon,
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
  const canAdmin = (tool: Tool) =>
    !perms ||
    perms.orgRole === 'owner' ||
    perms.orgRole === 'admin' ||
    atLeast(perms.toolLevels[tool], 'admin');
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
    canRead('documents') && {
      href: webRoutes.specifications(orgSlug, projectId),
      label: 'Specifications',
      icon: DocumentsIcon,
    },
    canRead('documents') && {
      href: webRoutes.transmittals(orgSlug, projectId),
      label: 'Transmittals',
      icon: TransmittalsIcon,
    },
    canRead('rfis') && { href: webRoutes.rfis(orgSlug, projectId), label: 'RFIs', icon: RfisIcon },
    canRead('submittals') && {
      href: webRoutes.submittals(orgSlug, projectId),
      label: 'Submittals',
      icon: SubmittalsIcon,
    },
    canRead('correspondence') && {
      href: webRoutes.correspondence(orgSlug, projectId),
      label: 'Correspondence',
      icon: CorrespondenceIcon,
    },
    canRead('coordination') && {
      href: webRoutes.coordination(orgSlug, projectId),
      label: 'Coordination',
      icon: CoordinationIcon,
    },
    canRead('diary') && {
      href: webRoutes.diary(orgSlug, projectId),
      label: 'Site diary',
      icon: DiaryIcon,
    },
    canRead('diary') && {
      href: webRoutes.delays(orgSlug, projectId),
      label: 'Delay register',
      icon: DelaysIcon,
    },
    canRead('schedule') && {
      href: webRoutes.programme(orgSlug, projectId),
      label: 'Programme',
      icon: ProgrammeIcon,
    },
    canRead('defects') && {
      href: webRoutes.defects(orgSlug, projectId),
      label: 'Defects',
      icon: DefectsIcon,
    },
    canRead('meetings') && {
      href: webRoutes.meetings(orgSlug, projectId),
      label: 'Meetings',
      icon: MeetingsIcon,
    },
    canRead('workforce') && {
      href: webRoutes.inductions(orgSlug, projectId),
      label: 'Inductions',
      icon: InductionsIcon,
    },
    canRead('payment_claims') && {
      href: webRoutes.contracts(orgSlug, projectId),
      label: 'Contracts',
      icon: ContractsIcon,
    },
    canRead('payment_claims') && {
      href: webRoutes.paymentClaims(orgSlug, projectId),
      label: 'Payment claims',
      icon: ContractsIcon,
    },
    canRead('budget') && {
      href: webRoutes.budget(orgSlug, projectId),
      label: 'Budget',
      icon: BudgetIcon,
    },
    canRead('workforce') && {
      href: webRoutes.attendance(orgSlug, projectId),
      label: 'Attendance',
      icon: AttendanceIcon,
    },
    canRead('inspections') && {
      href: webRoutes.inspections(orgSlug, projectId),
      label: 'Inspections',
      icon: InspectionsIcon,
    },
    canRead('inspections') && {
      href: webRoutes.observations(orgSlug, projectId),
      label: 'Observations',
      icon: ObservationsIcon,
    },
    canRead('inspections') && {
      href: webRoutes.swms(orgSlug, projectId),
      label: 'SWMS',
      icon: SwmsIcon,
    },
    canRead('inspections') && {
      href: webRoutes.incidents(orgSlug, projectId),
      label: 'Incidents',
      icon: IncidentsIcon,
    },
    canAdmin('inspections') && {
      href: webRoutes.safetySignals(orgSlug, projectId),
      label: 'Safety signals',
      icon: IncidentsIcon,
    },
    canRead('owner_portal') && {
      href: webRoutes.ownerPortal(orgSlug, projectId),
      label: 'Owner portal',
      icon: OwnerPortalIcon,
    },
    canAdmin('project_admin') && {
      href: webRoutes.lateSubmissions(orgSlug, projectId),
      label: 'Late submissions',
      icon: LateSubmissionsIcon,
    },
    canAdmin('project_admin') && {
      href: webRoutes.imports(orgSlug, projectId),
      label: 'Imports',
      icon: ImportsIcon,
    },
    canAdmin('project_admin') && {
      href: webRoutes.folderLinks(orgSlug, projectId),
      label: 'SharePoint and Drive',
      icon: FolderLinksIcon,
    },
  ];
  const estimating: ProjectNavItem[] = [
    {
      href: webRoutes.tenderPackages(orgSlug, projectId),
      label: 'Tender packages',
      icon: EstimatingIcon,
    },
    { href: webRoutes.estimates(orgSlug, projectId), label: 'Estimates', icon: EstimatingIcon },
    {
      href: webRoutes.costLibrary(orgSlug, projectId),
      label: 'Cost library',
      icon: EstimatingIcon,
    },
  ];
  const byLabel = new Map<string, ProjectNavItem>();
  for (const item of [...core, ...estimating]) if (item) byLabel.set(item.label, item);
  const categorised = TOOL_CATEGORIES.map(({ id, label, icon, tools }) => ({
    id,
    label,
    icon,
    items: tools.flatMap((t) => byLabel.get(t) ?? []),
  })).filter((g) => g.items.length > 0);
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
    ...categorised,
  ];
}

/** Categories for the sidebar and the project page tool grid; a tool the caller cannot read just drops out. */
const TOOL_CATEGORIES: ReadonlyArray<{
  id: string;
  label: string;
  icon: LucideIcon;
  tools: readonly string[];
}> = [
  {
    id: 'documents',
    label: 'Documents',
    icon: DocumentsIcon,
    tools: ['Documents', 'Drawings', 'Specifications', 'Coordination'],
  },
  {
    id: 'communication',
    label: 'Communication',
    icon: CorrespondenceIcon,
    tools: ['Transmittals', 'RFIs', 'Submittals', 'Correspondence', 'Meetings'],
  },
  {
    id: 'site',
    label: 'Site & programme',
    icon: ProgrammeIcon,
    tools: ['Site diary', 'Delay register', 'Programme', 'Attendance'],
  },
  {
    id: 'quality-safety',
    label: 'Quality & safety',
    icon: InductionsIcon,
    tools: [
      'Defects',
      'Inspections',
      'Observations',
      'SWMS',
      'Incidents',
      'Safety signals',
      'Inductions',
    ],
  },
  {
    id: 'commercial',
    label: 'Commercial',
    icon: ContractsIcon,
    tools: ['Contracts', 'Payment claims', 'Budget', 'Owner portal'],
  },
  {
    id: 'estimating',
    label: 'Estimating',
    icon: EstimatingIcon,
    tools: ['Tender packages', 'Estimates', 'Cost library'],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: AdminIcon,
    tools: ['Late submissions', 'Imports', 'SharePoint and Drive'],
  },
];
