// Typed route and deep-link builders (ADR-0006). Web, mobile and email/push templates all build links here,
// so one URL opens the same screen on any device (mobile 01 §1.2: universal links map onto the same routes).
// Web URLs use the org slug; API paths use prefixed ids.

const enc = encodeURIComponent;
const p = (orgSlug: string, projectId: string) => `/${enc(orgSlug)}/projects/${enc(projectId)}`;

export const webRoutes = {
  login: (next?: string) => (next ? `/login?next=${enc(next)}` : '/login'),
  signup: () => '/signup',
  orgPicker: () => '/orgs',
  newOrg: () => '/orgs/new',
  org: (orgSlug: string) => `/${enc(orgSlug)}`,
  projects: (orgSlug: string) => `/${enc(orgSlug)}/projects`,
  project: (orgSlug: string, projectId: string) => `/${enc(orgSlug)}/projects/${enc(projectId)}`,
  projectMembers: (orgSlug: string, projectId: string) =>
    `/${enc(orgSlug)}/projects/${enc(projectId)}/members`,

  // Project tools (frontend 03 §1). Entity segments are API ids; pages show the human number.
  documents: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/documents`,
  drawings: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/drawings`,
  /** A sheet in the viewer; without `revisionId` it opens the current revision. */
  drawing: (orgSlug: string, projectId: string, sheetId: string, revisionId?: string) =>
    `${p(orgSlug, projectId)}/drawings/${enc(sheetId)}${revisionId ? `?rev=${enc(revisionId)}` : ''}`,
  rfis: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/rfis`,
  newRfi: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/rfis/new`,
  rfi: (orgSlug: string, projectId: string, rfiId: string) =>
    `${p(orgSlug, projectId)}/rfis/${enc(rfiId)}`,
  submittals: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/submittals`,
  newSubmittal: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/submittals/new`,
  submittal: (orgSlug: string, projectId: string, submittalId: string) =>
    `${p(orgSlug, projectId)}/submittals/${enc(submittalId)}`,
  /** The diary for a project-local date (`YYYY-MM-DD`); without a date it opens today. */
  diary: (orgSlug: string, projectId: string, date?: string) =>
    `${p(orgSlug, projectId)}/diary${date ? `/${enc(date)}` : ''}`,
  defects: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/defects`,
  newDefect: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/defects/new`,
  defect: (orgSlug: string, projectId: string, defectId: string) =>
    `${p(orgSlug, projectId)}/defects/${enc(defectId)}`,
  inductions: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/inductions`,
  /** The builder for one induction. (`induction` below is the worker's guest link.) */
  inductionBuilder: (orgSlug: string, projectId: string, inductionId: string) =>
    `${p(orgSlug, projectId)}/inductions/${enc(inductionId)}`,
  inductionRegister: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/inductions/register`,
  attendance: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/attendance`,
  tenderPackages: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/estimating/packages`,
  tenderPackage: (orgSlug: string, projectId: string, packageId: string) =>
    `${p(orgSlug, projectId)}/estimating/packages/${enc(packageId)}`,

  // Guest flows outside any org (X58): no app sign-in, the link itself is the access (X45).
  /** A worker's site induction, opened from an SMS or email access link. */
  induction: (token: string) => `/i/${enc(token)}`,
} as const;

/** Mobile (expo-router) paths. Feature names match web and backend modules one to one. */
export const mobileRoutes = {
  signIn: () => '/sign-in',
  home: () => '/',
  project: (projectId: string) => `/project/${enc(projectId)}`,
  diary: (projectId: string) => `/project/${enc(projectId)}/diary`,
  defects: (projectId: string) => `/project/${enc(projectId)}/defects`,
  drawings: (projectId: string) => `/project/${enc(projectId)}/drawings`,
  drawingSheet: (projectId: string, revisionId: string) =>
    `/project/${enc(projectId)}/drawings/${enc(revisionId)}`,
  siteSignIn: (projectId: string) => `/project/${enc(projectId)}/sign-in`,
  rollCall: (projectId: string) => `/project/${enc(projectId)}/roll-call`,
  induction: (projectId: string) => `/project/${enc(projectId)}/induction`,
  newDefect: (
    projectId: string,
    onSheet?: { sheetId: string; drawingRevisionId: string; pinX: number; pinY: number },
  ) =>
    `/project/${enc(projectId)}/defects/new${
      onSheet
        ? `?sheetId=${enc(onSheet.sheetId)}&drawingRevisionId=${enc(onSheet.drawingRevisionId)}&pinX=${onSheet.pinX}&pinY=${onSheet.pinY}`
        : ''
    }`,
  defect: (projectId: string, defectId: string) =>
    `/project/${enc(projectId)}/defects/${enc(defectId)}`,
  defectPhoto: (projectId: string, defectId: string, purpose: 'before' | 'after') =>
    `/project/${enc(projectId)}/defects/${enc(defectId)}/photo?purpose=${purpose}`,
} as const;

/** Absolute link for emails and push payloads, e.g. `deepLink('https://app.example.com', webRoutes.project(...))`. */
export function deepLink(appOrigin: string, path: string): string {
  return new URL(path, appOrigin).toString();
}
