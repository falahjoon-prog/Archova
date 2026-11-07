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
  inbox: (orgSlug: string) => `/${enc(orgSlug)}/inbox`,
  /** Global search; `q` pre-fills the box. */
  search: (orgSlug: string, q?: string) =>
    `/${enc(orgSlug)}/search${q ? `?q=${encodeURIComponent(q)}` : ''}`,
  bidBoard: (orgSlug: string) => `/${enc(orgSlug)}/bid-board`,
  portfolio: (orgSlug: string) => `/${enc(orgSlug)}/portfolio`,
  reports: (orgSlug: string) => `/${enc(orgSlug)}/reports`,
  readiness: (orgSlug: string) => `/${enc(orgSlug)}/readiness`,
  prequalification: (orgSlug: string) => `/${enc(orgSlug)}/prequalification`,
  accounting: (orgSlug: string) => `/${enc(orgSlug)}/settings/accounting`,
  apps: (orgSlug: string) => `/${enc(orgSlug)}/settings/apps`,
  integrations: (orgSlug: string) => `/${enc(orgSlug)}/settings/integrations`,
  folders: (orgSlug: string) => `/${enc(orgSlug)}/settings/folders`,
  supportAccess: (orgSlug: string) => `/${enc(orgSlug)}/settings/support-access`,
  wallet: (orgSlug: string) => `/${enc(orgSlug)}/settings/wallet`,
  subcontractorWallets: (orgSlug: string) => `/${enc(orgSlug)}/settings/subcontractor-wallets`,
  plan: (orgSlug: string) => `/${enc(orgSlug)}/settings/plan`,
  permissionTemplates: (orgSlug: string) => `/${enc(orgSlug)}/settings/permission-templates`,
  novaSettings: (orgSlug: string) => `/${enc(orgSlug)}/settings/nova`,
  contractPlaybook: (orgSlug: string) => `/${enc(orgSlug)}/settings/contract-playbook`,
  apiAccess: (orgSlug: string) => `/${enc(orgSlug)}/settings/api`,
  dataExport: (orgSlug: string) => `/${enc(orgSlug)}/settings/data-export`,
  project: (orgSlug: string, projectId: string) => `/${enc(orgSlug)}/projects/${enc(projectId)}`,
  projectMembers: (orgSlug: string, projectId: string) =>
    `/${enc(orgSlug)}/projects/${enc(projectId)}/members`,

  // Project tools (frontend 03 §1). Entity segments are API ids; pages show the human number.
  documents: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/documents`,
  drawings: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/drawings`,
  coordination: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/coordination`,
  /** The 3D viewer for the project's IFC models, with clash checking. */
  coordinationModels: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/coordination/models`,
  specifications: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/specifications`,
  /** A sheet in the viewer; without `revisionId` it opens the current revision. */
  drawing: (orgSlug: string, projectId: string, sheetId: string, revisionId?: string) =>
    `${p(orgSlug, projectId)}/drawings/${enc(sheetId)}${revisionId ? `?rev=${enc(revisionId)}` : ''}`,
  transmittals: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/transmittals`,
  newTransmittal: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/transmittals/new`,
  transmittal: (orgSlug: string, projectId: string, transmittalId: string) =>
    `${p(orgSlug, projectId)}/transmittals/${enc(transmittalId)}`,
  rfis: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/rfis`,
  newRfi: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/rfis/new`,
  rfi: (orgSlug: string, projectId: string, rfiId: string) =>
    `${p(orgSlug, projectId)}/rfis/${enc(rfiId)}`,
  submittals: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/submittals`,
  newSubmittal: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/submittals/new`,
  submittal: (orgSlug: string, projectId: string, submittalId: string) =>
    `${p(orgSlug, projectId)}/submittals/${enc(submittalId)}`,
  conversations: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/conversations`,
  correspondence: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/correspondence`,
  newCorrespondence: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/correspondence/new`,
  correspondenceItem: (orgSlug: string, projectId: string, itemId: string) =>
    `${p(orgSlug, projectId)}/correspondence/${enc(itemId)}`,
  /** The diary for a project-local date (`YYYY-MM-DD`); without a date it opens today. */
  diary: (orgSlug: string, projectId: string, date?: string) =>
    `${p(orgSlug, projectId)}/diary${date ? `/${enc(date)}` : ''}`,
  delays: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/delays`,
  programme: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/programme`,
  contracts: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/contracts`,
  newContract: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/contracts/new`,
  contract: (orgSlug: string, projectId: string, contractId: string) =>
    `${p(orgSlug, projectId)}/contracts/${enc(contractId)}`,
  contractReviews: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/contracts/review`,
  contractReview: (orgSlug: string, projectId: string, reviewId: string) =>
    `${p(orgSlug, projectId)}/contracts/review/${enc(reviewId)}`,
  costForecast: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/cost-forecast`,
  paymentClaims: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/payment-claims`,
  paymentClaim: (orgSlug: string, projectId: string, claimId: string) =>
    `${p(orgSlug, projectId)}/payment-claims/${enc(claimId)}`,
  budget: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/budget`,
  commitments: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/commitments`,
  commitment: (orgSlug: string, projectId: string, commitmentId: string) =>
    `${p(orgSlug, projectId)}/commitments/${enc(commitmentId)}`,
  defects: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/defects`,
  meetings: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/meetings`,
  meeting: (orgSlug: string, projectId: string, meetingId: string) =>
    `${p(orgSlug, projectId)}/meetings/${enc(meetingId)}`,
  newDefect: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/defects/new`,
  defect: (orgSlug: string, projectId: string, defectId: string) =>
    `${p(orgSlug, projectId)}/defects/${enc(defectId)}`,
  inductions: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/inductions`,
  /** The builder for one induction. (`induction` below is the worker's guest link.) */
  inductionBuilder: (orgSlug: string, projectId: string, inductionId: string) =>
    `${p(orgSlug, projectId)}/inductions/${enc(inductionId)}`,
  inductionRegister: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/inductions/register`,
  safetySignals: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/safety-signals`,
  swms: (orgSlug: string, projectId: string, swmsId?: string) =>
    `${p(orgSlug, projectId)}/swms${swmsId ? `?id=${enc(swmsId)}` : ''}`,
  incidents: (orgSlug: string, projectId: string, incidentId?: string) =>
    `${p(orgSlug, projectId)}/incidents${incidentId ? `?id=${enc(incidentId)}` : ''}`,
  inspections: (orgSlug: string, projectId: string, inspectionId?: string) =>
    `${p(orgSlug, projectId)}/inspections${inspectionId ? `?id=${enc(inspectionId)}` : ''}`,
  inspectionTemplates: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/inspections/templates`,
  imports: (orgSlug: string, projectId: string, jobId?: string) =>
    `${p(orgSlug, projectId)}/imports${jobId ? `?id=${enc(jobId)}` : ''}`,
  folderLinks: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/folder-links`,
  ownerPortal: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/owner-portal`,
  lateSubmissions: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/late-submissions`,
  observations: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/observations`,
  attendance: (orgSlug: string, projectId: string) => `${p(orgSlug, projectId)}/attendance`,
  attendanceWorkers: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/attendance/workers`,
  attendanceRollCall: (orgSlug: string, projectId: string, rollCallId?: string) =>
    `${p(orgSlug, projectId)}/attendance/roll-call${rollCallId ? `?id=${enc(rollCallId)}` : ''}`,
  attendanceRoster: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/attendance/roster`,
  attendanceEquipment: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/attendance/equipment`,
  attendanceTimesheets: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/attendance/timesheets`,
  attendanceCheckIn: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/attendance/check-in`,
  attendanceSites: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/attendance/sites`,
  tenderPackages: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/estimating/packages`,
  tenderPackage: (orgSlug: string, projectId: string, packageId: string) =>
    `${p(orgSlug, projectId)}/estimating/packages/${enc(packageId)}`,
  estimates: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/estimating/estimates`,
  estimate: (orgSlug: string, projectId: string, estimateId: string) =>
    `${p(orgSlug, projectId)}/estimating/estimates/${enc(estimateId)}`,
  costLibrary: (orgSlug: string, projectId: string) =>
    `${p(orgSlug, projectId)}/estimating/cost-library`,

  // Guest flows outside any org (X58): no app sign-in, the link itself is the access (X45).
  /** A worker's site induction, opened from an SMS or email access link. */
  induction: (token: string) => `/i/${enc(token)}`,
} as const;

/** Mobile (expo-router) paths. Feature names match web and backend modules one to one. */
export const mobileRoutes = {
  signIn: () => '/sign-in',
  home: () => '/',
  offline: () => '/offline',
  deleteAccount: () => '/delete-account',
  bidBoard: () => '/bid-board',
  tenders: (projectId: string) => `/project/${enc(projectId)}/tenders`,
  tender: (projectId: string, packageId: string) =>
    `/project/${enc(projectId)}/tenders/${enc(packageId)}`,
  project: (projectId: string) => `/project/${enc(projectId)}`,
  diary: (projectId: string) => `/project/${enc(projectId)}/diary`,
  /** Hands-free voice actions for a project (diary note, delay, RFI, incident, Ask Nova). */
  voice: (projectId: string) => `/project/${enc(projectId)}/voice`,
  /** A photo for a diary day; `reason` is the amendment reason once the day is submitted. */
  diaryPhoto: (projectId: string, date: string, reason?: string) =>
    `/project/${enc(projectId)}/diary/photo?date=${enc(date)}${reason ? `&reason=${enc(reason)}` : ''}`,
  defects: (projectId: string) => `/project/${enc(projectId)}/defects`,
  incidents: (projectId: string) => `/project/${enc(projectId)}/incidents`,
  incidentPhoto: (projectId: string, incidentId: string) =>
    `/project/${enc(projectId)}/incidents/${enc(incidentId)}/photo`,
  inspections: (projectId: string) => `/project/${enc(projectId)}/inspections`,
  inspection: (projectId: string, inspectionId: string) =>
    `/project/${enc(projectId)}/inspections/${enc(inspectionId)}`,
  inspectionItemPhoto: (projectId: string, inspectionId: string, itemId: string) =>
    `/project/${enc(projectId)}/inspections/${enc(inspectionId)}/photo?itemId=${enc(itemId)}`,
  drawings: (projectId: string) => `/project/${enc(projectId)}/drawings`,
  drawingSheet: (projectId: string, revisionId: string) =>
    `/project/${enc(projectId)}/drawings/${enc(revisionId)}`,
  siteSignIn: (projectId: string) => `/project/${enc(projectId)}/sign-in`,
  meetings: (projectId: string) => `/project/${enc(projectId)}/meetings`,
  meeting: (projectId: string, meetingId: string) =>
    `/project/${enc(projectId)}/meetings/${enc(meetingId)}`,
  ownerPortal: (projectId: string) => `/project/${enc(projectId)}/owner-portal`,
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
