'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError } from '@archova/api-client';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createTasksApi, type TaskPriority } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createTasksApi(orgId), [orgId]);
}

/** Outside users (subcontractors, owners) are refused by the API; the screen then says so plainly. */
export const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;

export function useMyTasks(status: 'open' | 'done') {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.myTasks(orgId, status),
    queryFn: () => source.mine(status),
    retry: (count, error) => !isForbidden(error) && count < 2,
  });
}

function useRefresh() {
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.myTasks(orgId) });
}

/** Adds a task for the caller on a project. Waits for the server, then refreshes the list. */
export function useAddTask() {
  const source = useApi();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: {
      projectId: string;
      title: string;
      assigneeId: string;
      dueDate?: string;
      priority: TaskPriority;
    }) => {
      const { projectId, ...body } = v;
      return source.create(projectId, body);
    },
    onSuccess: refresh,
  });
}

export function useSetTaskStatus() {
  const source = useApi();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { projectId: string; taskId: string; status: 'open' | 'done' }) =>
      source.setStatus(v.projectId, v.taskId, v.status),
    onSuccess: refresh,
  });
}
