import type { Milestone } from '../infra/tables';

/** What is still ahead on the client view: finished milestones drop off, dated ones come first, soonest first. */
export function upcomingMilestones(milestones: readonly Milestone[]): Milestone[] {
  return milestones
    .filter((m) => m.status !== 'done')
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (a.m.date && b.m.date) return a.m.date.localeCompare(b.m.date) || a.i - b.i;
      if (a.m.date) return -1;
      if (b.m.date) return 1;
      return a.i - b.i;
    })
    .map((x) => x.m);
}
