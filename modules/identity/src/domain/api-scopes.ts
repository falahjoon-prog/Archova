// Scopes for personal access tokens (integrations/06 §2). Coarse, per area, `read` or `write`; `write` includes `read`.
// A scope only narrows a token: the owner's own permissions in the org still apply on top.

export const TOKEN_PREFIX = 'pk_live_';
export const MAX_TOKEN_LIFETIME_DAYS = 365;
export const DEFAULT_TOKEN_LIFETIME_DAYS = 90;

const AREAS = [
  'projects',
  'directory',
  'documents',
  'rfis',
  'submittals',
  'diary',
  'defects',
  'correspondence',
  'meetings',
  'estimating',
  'financials',
] as const;

/**
 * The operations a personal token may call, by id, each guarded by one scope area. Default deny: an operation not
 * listed here is refused, so a new endpoint is never public by accident. Admin and account operations (members,
 * org settings, support access, billing, identity) are deliberately absent.
 */
const ALLOWED_BY_AREA: Readonly<Record<(typeof AREAS)[number], readonly string[]>> = {
  projects: [
    'getOrg',
    'listProjects',
    'getProject',
    'updateProject',
    'getKeyDates',
    'updateKeyDates',
    'listKeyDateChanges',
  ],
  directory: ['listCompanies', 'createCompany', 'listProjectMembers'],
  documents: [
    'listFolders',
    'createFolder',
    'updateFolder',
    'listDocuments',
    'createDocument',
    'getDocument',
    'updateDocument',
    'addDocumentRevision',
    'listDrawingSets',
    'createDrawingSet',
    'getDrawingSetReview',
    'addDrawingSetRevision',
    'updateDraftDrawingRevision',
    'removeDraftDrawingRevision',
    'publishDrawingSet',
    'listDrawings',
    'listDrawingSheetRevisions',
    'getDrawingRevision',
    'getDrawingTiles',
    'getSheetGeometry',
    'listMarkups',
    'createMarkup',
    'updateMarkup',
    'deleteMarkup',
    'listTransmittals',
    'createTransmittal',
    'getTransmittal',
  ],
  rfis: [
    'listRfis',
    'createRfi',
    'getRfi',
    'updateRfi',
    'openRfi',
    'addRfiResponse',
    'getRfiActivity',
    'closeRfi',
    'reopenRfi',
    'voidRfi',
  ],
  submittals: [
    'listSubmittals',
    'createSubmittal',
    'getSubmittal',
    'updateSubmittal',
    'submitSubmittal',
  ],
  diary: [
    'getDelayRegister',
    'listDiaryEntries',
    'getDiaryEntry',
    'saveDiaryEntry',
    'submitDiaryEntry',
    'copyDiaryLabour',
    'createDiaryLabour',
    'updateDiaryLabour',
    'deleteDiaryLabour',
    'createDiaryPlant',
    'updateDiaryPlant',
    'deleteDiaryPlant',
    'createDiaryDelivery',
    'updateDiaryDelivery',
    'deleteDiaryDelivery',
    'createDiaryDelay',
    'updateDiaryDelay',
    'deleteDiaryDelay',
    'createDiaryVisitor',
    'updateDiaryVisitor',
    'deleteDiaryVisitor',
    'createDiaryEvent',
    'updateDiaryEvent',
    'deleteDiaryEvent',
    'createDiaryStandDown',
    'updateDiaryStandDown',
    'deleteDiaryStandDown',
  ],
  defects: ['listDefects', 'createDefect', 'getDefect', 'updateDefect', 'transitionDefect'],
  estimating: [
    'listTenderPackages',
    'createTenderPackage',
    'getTenderPackage',
    'updateTenderPackage',
    'transitionTenderPackage',
    'inviteToTenderPackage',
    'setTenderPackageAllowances',
    'getQuoteComparison',
    'listQuotes',
    'createQuote',
    'getQuote',
    'updateQuote',
    'listTakeoffMeasurements',
    'createTakeoffMeasurement',
    'getTakeoffMeasurement',
    'updateTakeoffMeasurement',
    'deleteTakeoffMeasurement',
  ],
  correspondence: [],
  meetings: [],
  financials: [],
};

/**
 * Every scope a token may be created with: read and write for each area that has operations a token can call, so a
 * scope that would grant nothing is not offered. Personal tokens never hold `financials:write` (integrations/06 §2).
 */
export const TOKEN_SCOPES: readonly string[] = AREAS.filter(
  (a) => ALLOWED_BY_AREA[a].length > 0,
).flatMap((a) => (a === 'financials' ? [`${a}:read`] : [`${a}:read`, `${a}:write`]));

const AREA_BY_OPERATION: ReadonlyMap<string, (typeof AREAS)[number]> = new Map(
  AREAS.flatMap((a) => ALLOWED_BY_AREA[a].map((id) => [id, a] as const)),
);

/** Every operation id a token may call. */
export const TOKEN_OPERATIONS: readonly string[] = [...AREA_BY_OPERATION.keys()];

/** The scope an operation needs, or null when tokens may not call it at all. */
export function requiredScope(operationId: string, method: string): string | null {
  const area = AREA_BY_OPERATION.get(operationId);
  if (!area) return null;
  return `${area}:${method === 'GET' || method === 'HEAD' ? 'read' : 'write'}`;
}

export function scopeAllows(granted: readonly string[], needed: string): boolean {
  if (granted.includes(needed)) return true;
  return needed.endsWith(':read') && granted.includes(`${needed.slice(0, -5)}:write`);
}

/** Unknown scopes, in the order given. */
export const unknownScopes = (scopes: readonly string[]) =>
  scopes.filter((s) => !TOKEN_SCOPES.includes(s));
