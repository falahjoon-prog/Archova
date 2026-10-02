'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import { allPages, previewDataOnly } from '@/shared/lib/data-mode';
import { projectMembers } from '@/shared/lib/people';
import { MOCK_COMPANIES, MOCK_PEOPLE } from '@/shared/mocks/directory';
import { useCurrentOrg } from './CurrentOrgProvider';
import { useCurrentProject } from './CurrentProjectProvider';

export interface DirectoryCompany {
  id: string;
  name: string;
  /** The organisation that runs the project. */
  isBuilder: boolean;
}

export interface DirectoryPerson {
  id: string;
  name: string;
  companyId: string | null;
}

export interface ProjectDirectory {
  companies: readonly DirectoryCompany[];
  people: readonly DirectoryPerson[];
  personName(id: string | null | undefined): string;
  companyName(id: string | null | undefined): string;
  personCompanyId(id: string | null | undefined): string | null;
}

function directory(companies: DirectoryCompany[], people: DirectoryPerson[]): ProjectDirectory {
  return {
    companies,
    people,
    personName: (id) => people.find((p) => p.id === id)?.name ?? 'Project member',
    companyName: (id) => companies.find((c) => c.id === id)?.name ?? 'Unknown company',
    personCompanyId: (id) => people.find((p) => p.id === id)?.companyId ?? null,
  };
}

const PREVIEW = directory(
  MOCK_COMPANIES.map((c) => ({ id: c.id, name: c.name, isBuilder: c.role === 'builder' })),
  [...MOCK_PEOPLE],
);

/**
 * The companies and people on the current project, for pickers and for naming the ids records carry. Preview data
 * uses the shared synthetic directory; otherwise the org's companies and the project's members.
 */
export function useProjectDirectory(): ProjectDirectory {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const members = useQuery({
    queryKey: ['directory', orgId, projectId, 'members'],
    queryFn: () => projectMembers(orgId, projectId),
    enabled: !previewDataOnly,
    staleTime: 5 * 60_000,
  });
  const companies = useQuery({
    queryKey: ['directory', orgId, 'companies'],
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/v1/orgs/{orgId}/companies', {
            params: { path: { orgId }, query: { limit: 200, cursor } },
          }),
        ),
      ),
    enabled: !previewDataOnly,
    staleTime: 5 * 60_000,
  });
  return useMemo(
    () =>
      previewDataOnly
        ? PREVIEW
        : directory(
            (companies.data ?? []).map((c) => ({
              id: c.id,
              name: c.name,
              isBuilder: c.isOwnCompany,
            })),
            members.data ?? [],
          ),
    [companies.data, members.data],
  );
}
