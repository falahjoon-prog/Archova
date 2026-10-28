import { decodeId } from '@archova/domain';

export interface ProjectScope {
  projectId: string;
  modules: string[];
}

export interface ParsedScopes {
  org: boolean;
  projects: ProjectScope[];
}

const MODULE = /^[a-z][a-z_]{0,31}$/;
const MAX_PROJECTS = 50;
const MAX_MODULES = 20;

/**
 * `project:{projectId}:{module,module};org` (mobile 02 §3, `formatScopesParam` on the device). Returns null when the
 * text is not in that shape. A project listed twice has its modules merged.
 */
export function parseScopes(text: string): ParsedScopes | null {
  const out: ParsedScopes = { org: false, projects: [] };
  const byProject = new Map<string, Set<string>>();
  for (const segment of text.split(';')) {
    if (segment === 'org') {
      out.org = true;
      continue;
    }
    const parts = segment.split(':');
    if (parts.length !== 3 || parts[0] !== 'project') return null;
    const projectId = decodeId('project', parts[1]!);
    if (!projectId) return null;
    const modules = parts[2]!.split(',');
    if (modules.length > MAX_MODULES || modules.some((m) => !MODULE.test(m))) return null;
    const set = byProject.get(projectId) ?? new Set<string>();
    for (const m of modules) set.add(m);
    byProject.set(projectId, set);
  }
  if (byProject.size > MAX_PROJECTS) return null;
  out.projects = [...byProject].map(([projectId, modules]) => ({
    projectId,
    modules: [...modules],
  }));
  return out.org || out.projects.length > 0 ? out : null;
}
