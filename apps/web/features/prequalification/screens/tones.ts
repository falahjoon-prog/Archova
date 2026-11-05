import type { StatusTone } from '@archova/ui';
import type { Qualification } from '../lib/types';

export const QUALIFICATION_TONE: Record<Qualification, StatusTone> = {
  qualified: 'success',
  expiring: 'warning',
  expired: 'danger',
  pending: 'info',
  not_qualified: 'neutral',
};
