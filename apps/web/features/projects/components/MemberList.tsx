import type { ProjectMember } from '@archova/contracts';

export function MemberList({
  members,
  companyNames,
  templateNames,
}: {
  members: readonly ProjectMember[];
  /** id → name, when the caller can read companies; otherwise the column shows a dash. */
  companyNames: ReadonlyMap<string, string>;
  templateNames: ReadonlyMap<string, string>;
}) {
  if (members.length === 0)
    return <p className="u-muted">No one has been added to this project yet.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="u-visually-hidden">Project members</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Company</th>
            <th scope="col">Permissions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <th scope="row">
                {m.name}
                {m.isExternal ? <span className="tag">External</span> : null}
              </th>
              <td>{m.email}</td>
              <td>{companyNames.get(m.companyId) ?? '—'}</td>
              <td>{templateNames.get(m.permissionTemplateId) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
