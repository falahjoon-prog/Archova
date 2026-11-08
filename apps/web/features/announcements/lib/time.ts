import { formatInstant } from '@/shared/lib/format';

/** "10 minutes ago", "3 hours ago", "Yesterday"; older than a week falls back to the project-local date and time. */
export function relativeAge(iso: string, timeZone: string, now: Date = new Date()): string {
  const minutes = Math.floor(Math.max(0, now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatInstant(iso, timeZone);
}

/** "3 of 5 have read it". */
export function readSummary(r: { recipientCount: number; readCount: number }): string {
  return `${r.readCount} of ${r.recipientCount} ${r.recipientCount === 1 ? 'has' : 'have'} read it`;
}

export const READ_BY_OPTIONS = [
  { value: '', label: 'No deadline' },
  { value: '4', label: '4 hours' },
  { value: '24', label: '1 day' },
  { value: '48', label: '2 days' },
  { value: '72', label: '3 days' },
  { value: '168', label: '1 week' },
] as const;
