// pnpm demo:check: logs in as the demo user and calls every list endpoint under the org and the first active project
// (from the OpenAPI file), then prints the ones that come back empty. Use it after a seed to see which screens would
// still say "No X yet". Read-only. Env: SEED_APP_ORIGIN, SEED_PASSWORD, SEED_EMAIL (default demo@archova.com.au).
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ORG } from './data';
import { Session } from './session';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const origin = new URL(need('SEED_APP_ORIGIN')).origin;
const s = new Session(origin);
await s.ok('POST', '/v1/auth/login', {
  email: process.env.SEED_EMAIL ?? 'demo@archova.com.au',
  password: need('SEED_PASSWORD'),
});
const me = await s.ok<{ memberships: Array<{ orgId: string; orgSlug: string }> }>('GET', '/v1/me');
const orgId = me.memberships.find((m) => m.orgSlug === ORG.slug)?.orgId;
if (!orgId) throw new Error('demo org not found; run pnpm demo:seed first');
const projects = (
  await s.ok<{ data: Array<{ id: string; name: string; status: string }> }>(
    'GET',
    `/v1/orgs/${orgId}/projects`,
  )
).data;
const project = projects.find((p) => p.status === 'active') ?? projects[0];
if (!project) throw new Error('no projects');

const spec = parse(
  readFileSync(new URL('../../packages/contracts/openapi/openapi.yaml', import.meta.url), 'utf8'),
) as {
  paths: Record<
    string,
    {
      get?: {
        operationId?: string;
        parameters?: Array<{ $ref?: string; required?: boolean; in?: string }>;
      };
    }
  >;
};

const empty: string[] = [];
const failed: string[] = [];
let checked = 0;
for (const [path, item] of Object.entries(spec.paths)) {
  if (!item.get) continue;
  if (!path.startsWith('/v1/orgs/{orgId}')) continue;
  // Only collections: no ids other than the org and project.
  const rest = path.replace('{orgId}', orgId).replace('{projectId}', project.id);
  if (/\{[^}]+\}/.test(rest)) continue;
  if (item.get.parameters?.some((p) => p.in === 'query' && p.required)) continue;
  checked++;
  const r = await s.call<{ data?: unknown[] }>('GET', rest);
  if (r.status === 404 || r.status === 403)
    failed.push(`${r.status} ${path} (flag off or no access)`);
  else if (r.status >= 300) failed.push(`${r.status} ${path}`);
  else if (Array.isArray(r.json.data) && r.json.data.length === 0) empty.push(path);
}
console.log(`Checked ${checked} list endpoints on ${project.name}.`);
console.log(`\nEmpty (${empty.length}):\n${empty.map((p) => `  ${p}`).join('\n') || '  none'}`);
console.log(
  `\nNot reachable (${failed.length}):\n${failed.map((p) => `  ${p}`).join('\n') || '  none'}`,
);
