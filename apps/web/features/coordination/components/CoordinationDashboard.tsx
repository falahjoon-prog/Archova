'use client';

import { Card, DonutChart, ToneBars } from '@archova/ui';
import { todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { CoordinationIssue } from '../data/api';
import { ballInCourt, deadlineBars, percentDone, statusSlices } from '../lib/dashboard';

/** Overview, Progress and Ball in court for the project's coordination issues. */
export function CoordinationDashboard({ issues }: { issues: readonly CoordinationIssue[] }) {
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const today = todayIn(project.timezone);
  const ball = ballInCourt(issues, (id) => dir.personName(id));
  return (
    <div className="chart-grid">
      <Card title="Overview">
        <DonutChart
          slices={statusSlices(issues)}
          centreLabel="issues"
          ariaLabel="Number of coordination issues in each status"
        />
      </Card>
      <Card title="Progress">
        <div className="stack">
          <p className="u-m-0">
            <strong>{percentDone(issues)}%</strong> resolved or closed
          </p>
          <ToneBars bars={deadlineBars(issues, today)} ariaLabel="Open issues by due date" />
        </div>
      </Card>
      <Card title="Ball in court" className="chart-grid__wide">
        {ball.length > 0 ? (
          <ToneBars bars={ball} ariaLabel="Open issues waiting on each person" />
        ) : (
          <p className="u-muted u-m-0">Nothing is waiting on anyone.</p>
        )}
      </Card>
    </div>
  );
}
