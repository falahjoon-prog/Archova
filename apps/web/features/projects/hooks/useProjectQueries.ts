'use client';

import { useQuery } from '@tanstack/react-query';
import { queries } from '@/shared/lib/api';

// Thin hooks over the shared query options in @archova/query (frontend 02 §2). Keys are tenant-scoped.

export function useProjects(orgId: string) {
  return useQuery(queries.projects(orgId));
}

export function useProject(orgId: string, projectId: string) {
  return useQuery({ ...queries.project(orgId, projectId), staleTime: 60_000 });
}

export function useProjectMembers(orgId: string, projectId: string) {
  return useQuery(queries.projectMembers(orgId, projectId));
}

/** The caller's effective permissions on this project; used only to hide UI (the API enforces). */
export function useProjectPermissions(orgId: string, projectId: string) {
  return useQuery({ ...queries.projectPermissions(orgId, projectId), staleTime: 60_000 });
}

/** Reference data: long-lived, explicitly invalidated when it changes. */
export function useCompanies(orgId: string, enabled = true) {
  return useQuery({ ...queries.companies(orgId), staleTime: Infinity, enabled });
}

export function usePermissionTemplates(orgId: string, enabled = true) {
  return useQuery({ ...queries.permissionTemplates(orgId), staleTime: Infinity, enabled });
}
