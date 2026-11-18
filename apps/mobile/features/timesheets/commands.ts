// Timesheets on the phone: the day sheets for a date range, submit, and approve or reject (ATT-US9). The server limits
// what each person sees (a subcontractor sees only their own workers) and who may approve.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface TimesheetTarget {
  orgId: string;
  projectId: string;
}

const path = (t: TimesheetTarget) => ({ orgId: t.orgId, projectId: t.projectId });
const sheetPath = (t: TimesheetTarget, timesheetId: string) => ({ ...path(t), timesheetId });

export async function listTimesheets(
  api: ApiClient,
  t: TimesheetTarget,
  range: { from: string; to: string },
) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/timesheets', {
      params: { path: path(t), query: range },
    }),
  ).data;
}

export async function getTimesheet(api: ApiClient, t: TimesheetTarget, timesheetId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}', {
      params: { path: sheetPath(t, timesheetId) },
    }),
  );
}

export async function submitTimesheet(api: ApiClient, t: TimesheetTarget, timesheetId: string) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}/submit', {
      params: { path: sheetPath(t, timesheetId) },
    }),
  );
}

export async function approveTimesheet(api: ApiClient, t: TimesheetTarget, timesheetId: string) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}/approve', {
      params: { path: sheetPath(t, timesheetId) },
    }),
  );
}

export async function rejectTimesheet(
  api: ApiClient,
  t: TimesheetTarget,
  timesheetId: string,
  reason: string,
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}/reject', {
      params: { path: sheetPath(t, timesheetId) },
      body: { reason: reason.trim() },
    }),
  );
}

/** The day's sign-in records, used by the mismatch check on the approve screen. */
export async function listSessions(api: ApiClient, t: TimesheetTarget, date: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/attendance/sessions', {
      params: { path: path(t), query: { date } },
    }),
  ).data;
}

/** Shifts that start within a window around the day, for the roster side of the check. */
export async function listShiftsBetween(
  api: ApiClient,
  t: TimesheetTarget,
  from: string,
  to: string,
) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/shifts', {
      params: { path: path(t), query: { from, to } },
    }),
  ).data;
}
