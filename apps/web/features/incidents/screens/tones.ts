import type { StatusTone } from '@archova/ui';
import type { CorrectiveStatus, IncidentStatus, Severity } from '../lib/types';

export const STATUS_TONE: Record<IncidentStatus, StatusTone> = {
  reported: 'info',
  investigating: 'warning',
  closed: 'success',
};
export const SEVERITY_TONE: Record<Severity, StatusTone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};
export const CORRECTIVE_TONE: Record<CorrectiveStatus, StatusTone> = {
  open: 'warning',
  done: 'info',
  verified: 'success',
};
