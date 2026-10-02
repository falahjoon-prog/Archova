// Typed route and deep-link builders (ADR-0006). Web, mobile and email/push templates all build links here,
// so one URL opens the same screen on any device (mobile 01 §1.2: universal links map onto the same routes).
// Web URLs use the org slug; API paths use prefixed ids.

const enc = encodeURIComponent;

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
} as const;

/** Mobile (expo-router) paths. Feature names match web and backend modules one to one. */
export const mobileRoutes = {
  signIn: () => '/sign-in',
  home: () => '/',
  project: (projectId: string) => `/project/${enc(projectId)}`,
} as const;

/** Absolute link for emails and push payloads, e.g. `deepLink('https://app.example.com', webRoutes.project(...))`. */
export function deepLink(appOrigin: string, path: string): string {
  return new URL(path, appOrigin).toString();
}
