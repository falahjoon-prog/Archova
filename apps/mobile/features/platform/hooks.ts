// Online-only reads for orgs and projects (phase 0; the local store via sync-core replaces these for field data).
import { useQuery } from '@tanstack/react-query';
import { queries } from '../../lib/api';

export const useMe = () => useQuery(queries.me());

export const useProjects = (orgId: string | null) =>
  useQuery({ ...queries.projects(orgId ?? ''), enabled: orgId !== null });

export const useProject = (orgId: string | null, projectId: string) =>
  useQuery({ ...queries.project(orgId ?? '', projectId), enabled: orgId !== null });
