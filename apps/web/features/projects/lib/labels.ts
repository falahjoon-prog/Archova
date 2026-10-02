import { AU_STATES, type AuState, type ProjectStatus } from '@archova/domain';

export const AU_STATE_NAMES: Record<AuState, string> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  WA: 'Western Australia',
  SA: 'South Australia',
  TAS: 'Tasmania',
  ACT: 'Australian Capital Territory',
  NT: 'Northern Territory',
};

export const AU_STATE_OPTIONS = AU_STATES.map((s) => ({ value: s, label: AU_STATE_NAMES[s] }));

const STATUS_LABELS: Record<ProjectStatus, string> = {
  tender: 'Tender',
  active: 'Active',
  on_hold: 'On hold',
  closed: 'Closed',
  archived: 'Archived',
};

export function statusLabel(status: ProjectStatus): string {
  return STATUS_LABELS[status];
}

export function isAuState(value: string): value is AuState {
  return (AU_STATES as readonly string[]).includes(value);
}
