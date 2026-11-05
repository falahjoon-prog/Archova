// Prefixed public ids (conventions.md §IDs): `prefix_` + Crockford base32 of the 128-bit UUID (26 chars).
import { isUuid } from './uuid';

/** Registry of id prefixes. Add new entity types here; never reuse a prefix. */
export const ID_PREFIXES = {
  org: 'org',
  user: 'usr',
  project: 'prj',
  company: 'cmp',
  membership: 'mem',
  projectMember: 'pmb',
  permissionTemplate: 'ptp',
  session: 'ses',
  apiToken: 'tok',
  upload: 'upl',
  file: 'fil',
  document: 'doc',
  revision: 'rev',
  rfi: 'rfi',
  defect: 'dfx',
  defectEvent: 'dfe',
  tenderPackage: 'tpk',
  quote: 'quo',
  quoteLine: 'qln',
  takeoffMeasurement: 'tkm',
  costItem: 'cit',
  estimate: 'est',
  estimateLine: 'esl',
  importJob: 'imp',
  webhook: 'whk',
  webhookDelivery: 'whd',
  accountingConnection: 'acn',
  syncIssue: 'syi',
  importRow: 'imr',
  lateSubmission: 'lsb',
  diary: 'dia',
  claim: 'clm',
  event: 'evt',
  folder: 'fld',
  drawingSet: 'dst',
  drawingSheet: 'dsh',
  drawingRevision: 'drv',
  markup: 'mku',
  transmittal: 'trm',
  transmittalRecipient: 'trr',
  aiRun: 'air',
  aiSuggestion: 'ais',
  rfiResponse: 'rfr',
  submittal: 'sbm',
  submittalStep: 'sbs',
  correspondenceType: 'cty',
  correspondence: 'cor',
  correspondenceResponse: 'crr',
  diaryLabour: 'dlb',
  diaryPlant: 'dpl',
  diaryDelivery: 'ddv',
  diaryDelay: 'ddy',
  diaryVisitor: 'dvi',
  diaryEvent: 'dev',
  diaryStandDown: 'dsd',
  diaryAmendment: 'dam',
  workforceSite: 'wst',
  gate: 'wgt',
  worker: 'wkr',
  attendanceSession: 'ats',
  attendanceEvent: 'ate',
  rollCall: 'rlc',
  eligibilityCheck: 'elc',
  induction: 'ind',
  inductionVersion: 'inv',
  inductionCompletion: 'inc',
  inductionQuizAttempt: 'iqa',
  workerCredential: 'wcr',
  complianceDocument: 'cdo',
  complianceExpiryAlert: 'cea',
  complianceGrant: 'cgr',
  complianceAccessRequest: 'car',
  complianceSnapshot: 'crs',
  complianceAccessLogEntry: 'cal',
  accessLink: 'lnk',
  meetingSeries: 'msr',
  ownerProgressUpdate: 'opu',
  ownerApproval: 'oap',
  ownerCapitalItem: 'oci',
  meeting: 'mtg',
  meetingSection: 'msc',
  meetingItem: 'mit',
  meetingAttendee: 'mat',
  schedule: 'sch',
  scheduleActivity: 'sac',
  scheduleDependency: 'sdp',
  scheduleLink: 'slk',
  notification: 'ntf',
  inspectionTemplate: 'itp',
  inspectionItem: 'iti',
  inspection: 'ins',
  observation: 'obs',
  swms: 'sws',
  swmsEvent: 'swe',
  contract: 'cnt',
  sovItem: 'sov',
  paymentClaim: 'pcl',
  paymentSchedule: 'psc',
  variation: 'var',
  prequalTemplate: 'pqt',
  prequalification: 'pqf',
  forecastAdjustment: 'fca',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdKind];

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DECODE: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) {
  DECODE[ALPHABET[i]!] = i;
  DECODE[ALPHABET[i]!.toLowerCase()] = i;
}
// Crockford aliases.
for (const [alias, target] of [
  ['O', '0'],
  ['o', '0'],
  ['I', '1'],
  ['i', '1'],
  ['L', '1'],
  ['l', '1'],
] as const) {
  DECODE[alias] = DECODE[target]!;
}

const ENCODED_LENGTH = 26;

function uuidToBigInt(uuid: string): bigint {
  return BigInt('0x' + uuid.replace(/-/g, ''));
}

function bigIntToUuid(value: bigint): string {
  const hex = value.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function encodeId(kind: IdKind, uuid: string): string {
  if (!isUuid(uuid)) throw new Error(`Not a UUID: ${uuid}`);
  let n = uuidToBigInt(uuid);
  let out = '';
  for (let i = 0; i < ENCODED_LENGTH; i++) {
    out = ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return `${ID_PREFIXES[kind]}_${out}`;
}

/** Decodes a prefixed id to its UUID, or returns null when the prefix or body is invalid. */
export function decodeId(kind: IdKind, id: string): string | null {
  const prefix = `${ID_PREFIXES[kind]}_`;
  if (!id.startsWith(prefix)) return null;
  const body = id.slice(prefix.length);
  if (body.length !== ENCODED_LENGTH) return null;
  let n = 0n;
  for (const ch of body) {
    const v = DECODE[ch];
    if (v === undefined) return null;
    n = (n << 5n) | BigInt(v);
  }
  if (n >> 128n !== 0n) return null;
  return bigIntToUuid(n);
}

export function isId(kind: IdKind, id: string): boolean {
  return decodeId(kind, id) !== null;
}
