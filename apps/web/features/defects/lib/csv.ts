import { locationPath } from '@/shared/mocks/locations';
import { STAGE_LABELS, STATUS_LABELS, formatDefectNumber, type Defect } from './types';

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The filtered register as CSV, sorted by location so it reads as a walk list (DEF-AC10). PDF is server-side. */
export function defectsToCsv(
  rows: readonly Defect[],
  companyName: (id: string | null) => string,
): string {
  const head = [
    'Number',
    'Title',
    'Location',
    'Drawing',
    'Company',
    'Trade',
    'Status',
    'Stage',
    'Due',
  ];
  const sorted = [...rows].sort((a, b) =>
    (locationPath(a.locationId) ?? '').localeCompare(locationPath(b.locationId) ?? '', 'en-AU', {
      numeric: true,
    }),
  );
  const lines = sorted.map((d) =>
    [
      formatDefectNumber(d.number),
      d.title,
      locationPath(d.locationId) ?? '',
      d.drawing?.label ?? '',
      companyName(d.assigneeCompanyId),
      d.trade,
      STATUS_LABELS[d.status],
      STAGE_LABELS[d.stage],
      d.dueDate ?? '',
    ]
      .map(cell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
