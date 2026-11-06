// Injury classification and safety rates for incident analytics. Pure, no IO. The categories follow the
// Safe Work Australia Type of Occurrence Classification System (TOOCS) in simplified form, and the rates follow
// the usual Australian industry definitions: LTIFR and TRIFR per million hours worked. These are measures of
// injuries recorded on Archova, not a statutory return; the regulator's own notification stays with the builder.

export const BODY_PARTS = [
  'head',
  'eye',
  'face',
  'neck',
  'shoulder',
  'upper_arm',
  'elbow',
  'forearm',
  'wrist',
  'hand',
  'fingers',
  'chest',
  'upper_back',
  'lower_back',
  'abdomen',
  'hip_groin',
  'thigh',
  'knee',
  'lower_leg',
  'ankle',
  'foot',
  'toes',
  /** More than one part, or not one place on the body; counted but not drawn on the body map. */
  'multiple',
  'systemic',
] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const INJURY_TYPES = [
  'fracture',
  'laceration',
  'sprain_strain',
  'contusion',
  'burn',
  'foreign_body',
  'amputation',
  'concussion',
  'dermatitis',
  'hearing_loss',
  'respiratory',
  'psychological',
  'other',
] as const;
export type InjuryType = (typeof INJURY_TYPES)[number];

/** What caused the harm (TOOCS "mechanism of incident"). */
export const HARM_SOURCES = [
  'falls_trips_slips',
  'hitting_objects',
  'being_hit',
  'body_stressing',
  'vehicle_plant',
  'electricity_heat',
  'chemicals',
  'sound_pressure',
  'biological',
  'mental_stress',
  'other',
] as const;
export type HarmSource = (typeof HARM_SOURCES)[number];

/** How serious the outcome was, least to most. `lost_time` is at least one full day or shift off work. */
export const INJURY_OUTCOMES = [
  'first_aid',
  'medical_treatment',
  'restricted_work',
  'lost_time',
  'fatality',
] as const;
export type InjuryOutcome = (typeof INJURY_OUTCOMES)[number];

export const BODY_PART_LABELS: Record<BodyPart, string> = {
  head: 'Head',
  eye: 'Eye',
  face: 'Face',
  neck: 'Neck',
  shoulder: 'Shoulder',
  upper_arm: 'Upper arm',
  elbow: 'Elbow',
  forearm: 'Forearm',
  wrist: 'Wrist',
  hand: 'Hand',
  fingers: 'Fingers',
  chest: 'Chest',
  upper_back: 'Upper back',
  lower_back: 'Lower back',
  abdomen: 'Abdomen',
  hip_groin: 'Hip and groin',
  thigh: 'Thigh',
  knee: 'Knee',
  lower_leg: 'Lower leg',
  ankle: 'Ankle',
  foot: 'Foot',
  toes: 'Toes',
  multiple: 'Multiple parts',
  systemic: 'Whole body or systemic',
};

export const INJURY_TYPE_LABELS: Record<InjuryType, string> = {
  fracture: 'Fracture',
  laceration: 'Cut or laceration',
  sprain_strain: 'Sprain or strain',
  contusion: 'Bruise or contusion',
  burn: 'Burn',
  foreign_body: 'Foreign body',
  amputation: 'Amputation',
  concussion: 'Concussion',
  dermatitis: 'Dermatitis',
  hearing_loss: 'Hearing loss',
  respiratory: 'Respiratory',
  psychological: 'Psychological',
  other: 'Other',
};

export const HARM_SOURCE_LABELS: Record<HarmSource, string> = {
  falls_trips_slips: 'Falls, trips and slips',
  hitting_objects: 'Hitting objects',
  being_hit: 'Being hit by moving objects',
  body_stressing: 'Body stressing (lifting, repetitive)',
  vehicle_plant: 'Vehicles and plant',
  electricity_heat: 'Electricity, heat or fire',
  chemicals: 'Chemicals and substances',
  sound_pressure: 'Sound and pressure',
  biological: 'Biological factors',
  mental_stress: 'Mental stress',
  other: 'Other',
};

export const INJURY_OUTCOME_LABELS: Record<InjuryOutcome, string> = {
  first_aid: 'First aid only',
  medical_treatment: 'Medical treatment',
  restricted_work: 'Restricted work',
  lost_time: 'Lost time',
  fatality: 'Fatality',
};

/** Parts that have a place on the body map, so everything except `multiple` and `systemic`. */
export const MAPPED_BODY_PARTS = BODY_PARTS.filter(
  (p) => p !== 'multiple' && p !== 'systemic',
) as readonly BodyPart[];

/** The structured part of an injured person's record. Free-text keys already stored are kept alongside it. */
export interface InjuryDetail {
  bodyPart: BodyPart | null;
  injuryType: InjuryType | null;
  harmSource: HarmSource | null;
  outcome: InjuryOutcome | null;
  /** Whole days or shifts lost after the day of the injury; 0 unless the outcome is lost time or fatality. */
  daysLost: number;
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** Reads the structured fields out of the stored injury object; anything unrecognised becomes null. */
export function readInjury(raw: Record<string, unknown> | null | undefined): InjuryDetail {
  const days = raw?.['daysLost'];
  return {
    bodyPart: pick(raw?.['bodyPart'], BODY_PARTS),
    injuryType: pick(raw?.['injuryType'], INJURY_TYPES),
    harmSource: pick(raw?.['harmSource'], HARM_SOURCES),
    outcome: pick(raw?.['outcome'], INJURY_OUTCOMES),
    daysLost: typeof days === 'number' && Number.isInteger(days) && days > 0 ? days : 0,
  };
}

export interface InjuryProblem {
  path: string;
  message: string;
}

/** Problems with the structured fields of an injury object being saved; free-text keys are not checked here. */
export function injuryProblems(raw: Record<string, unknown>): InjuryProblem[] {
  const out: InjuryProblem[] = [];
  const bad = (key: string, allowed: readonly string[]) => {
    const v = raw[key];
    if (v !== undefined && v !== null && !(typeof v === 'string' && allowed.includes(v)))
      out.push({ path: `injury.${key}`, message: 'Not a recognised value' });
  };
  bad('bodyPart', BODY_PARTS);
  bad('injuryType', INJURY_TYPES);
  bad('harmSource', HARM_SOURCES);
  bad('outcome', INJURY_OUTCOMES);
  const days = raw['daysLost'];
  if (days !== undefined && days !== null) {
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 3650)
      out.push({ path: 'injury.daysLost', message: 'Use a whole number of days from 0 to 3650' });
    else if (days > 0 && raw['outcome'] !== 'lost_time' && raw['outcome'] !== 'fatality')
      out.push({ path: 'injury.daysLost', message: 'Days lost needs the lost time outcome' });
  }
  return out;
}

/** A lost time injury: at least one full day or shift lost. A fatality counts as one. */
export const isLostTime = (d: Pick<InjuryDetail, 'outcome'>) =>
  d.outcome === 'lost_time' || d.outcome === 'fatality';

/** Counts toward the total recordable rate: everything beyond first aid. */
export const isRecordable = (d: Pick<InjuryDetail, 'outcome'>) =>
  d.outcome !== null && d.outcome !== 'first_aid';

/** Cases per million hours worked, one decimal. Null when no hours are known, so a rate is never shown as 0. */
export function ratePerMillionHours(cases: number, hours: number | null): number | null {
  if (hours === null || hours <= 0) return null;
  return Math.round((cases * 1_000_000 * 10) / hours) / 10;
}

export interface InjuryRecord extends InjuryDetail {
  incidentId: string;
  projectId: string;
  ref: string;
  occurredAt: string;
  /** The day it happened in the project's own time zone, `YYYY-MM-DD`. */
  localDate: string;
  personName: string;
  companyId: string | null;
  notifiable: boolean;
}

export interface CountBy<K extends string> {
  key: K;
  count: number;
}

export interface InjurySummary {
  injuries: number;
  lostTimeInjuries: number;
  recordableInjuries: number;
  daysLost: number;
  notifiable: number;
  hoursWorked: number | null;
  /** Lost time injuries per million hours worked. */
  ltifr: number | null;
  /** Lost time, restricted work and medical treatment injuries per million hours worked. */
  trifr: number | null;
  byBodyPart: CountBy<BodyPart | 'unknown'>[];
  byHarmSource: CountBy<HarmSource | 'unknown'>[];
  byInjuryType: CountBy<InjuryType | 'unknown'>[];
  byOutcome: CountBy<InjuryOutcome | 'unknown'>[];
}

function tally<K extends string>(values: (K | null)[]): CountBy<K | 'unknown'>[] {
  const m = new Map<K | 'unknown', number>();
  for (const v of values) m.set(v ?? 'unknown', (m.get(v ?? 'unknown') ?? 0) + 1);
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Totals, rates and breakdowns for the injuries given; `hoursWorked` is null when the hours cannot be read. */
export function summariseInjuries(
  records: readonly InjuryRecord[],
  hoursWorked: number | null,
): InjurySummary {
  const lostTime = records.filter(isLostTime).length;
  const recordable = records.filter(isRecordable).length;
  return {
    injuries: records.length,
    lostTimeInjuries: lostTime,
    recordableInjuries: recordable,
    daysLost: records.reduce((n, r) => n + r.daysLost, 0),
    notifiable: records.filter((r) => r.notifiable).length,
    hoursWorked,
    ltifr: ratePerMillionHours(lostTime, hoursWorked),
    trifr: ratePerMillionHours(recordable, hoursWorked),
    byBodyPart: tally(records.map((r) => r.bodyPart)),
    byHarmSource: tally(records.map((r) => r.harmSource)),
    byInjuryType: tally(records.map((r) => r.injuryType)),
    byOutcome: tally(records.map((r) => r.outcome)),
  };
}
