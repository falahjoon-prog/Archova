import Link from 'next/link';
import type { Project } from '@archova/contracts';
import { webRoutes } from '@archova/routes';
import { AU_STATE_NAMES, isAuState, statusLabel } from '../lib/labels';

export function ProjectTable({
  orgSlug,
  projects,
}: {
  orgSlug: string;
  projects: readonly Project[];
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="u-visually-hidden">Projects</caption>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Number</th>
            <th scope="col">State</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <th scope="row">
                <Link className="link" href={webRoutes.project(orgSlug, p.id)}>
                  {p.name}
                </Link>
              </th>
              <td className="u-mono">{p.number ?? '—'}</td>
              <td>
                {p.state && isAuState(p.state) ? (
                  <abbr title={AU_STATE_NAMES[p.state]}>{p.state}</abbr>
                ) : (
                  '—'
                )}
              </td>
              <td>{statusLabel(p.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
