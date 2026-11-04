import type { Attendance, MeetingItem, MeetingTemplate } from '../data/api';

export const TEMPLATE_LABELS: Record<MeetingTemplate, string> = {
  site_coordination: 'Site coordination',
  pcg: 'Project control group (PCG)',
  design_coordination: 'Design coordination',
  safety_committee: 'Safety committee',
  custom: 'Other meeting',
};

export const KIND_LABELS: Record<MeetingItem['kind'], string> = {
  information: 'Information',
  decision: 'Decision',
  action: 'Action',
};

export const ATTENDANCE_LABELS: Record<Attendance, string> = {
  present: 'Present',
  apologies: 'Apologies',
  absent: 'Absent',
};

/** "3 times" or "once", for an open item that keeps coming back (MTG-AC2). */
export function carriedLabel(count: number): string {
  return count === 1 ? 'Carried forward once' : `Carried forward ${count} times`;
}

/** A `datetime-local` value (the browser's local time) as an ISO instant. */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** Today at 9:00 in the browser's time zone, as a `datetime-local` value, to start a new meeting from. */
export function defaultHeldAt(now: Date = new Date()): string {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Hands a generated file to the browser as a download. */
export function saveFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}
