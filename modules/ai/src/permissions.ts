import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys the ai module owns (Sam 02). Org owners and admins hold every key; using Nova on a project
// needs the permission of the feature's own module (e.g. documents read for Ask Nova), checked by that feature.
export const AI_PERMISSIONS: readonly PermissionDefinition[] = [
  {
    key: 'ai.settings.read',
    scope: 'org',
    tool: null,
    level: 'read',
    orgRoles: ['member', 'billing_admin'],
  },
  { key: 'ai.settings.manage', scope: 'org', tool: null, level: 'admin' },
  { key: 'ai.usage.read', scope: 'org', tool: null, level: 'read', orgRoles: ['billing_admin'] },
  // Nova help: any organisation member can ask where something is or what an error means; no records are read.
  {
    key: 'ai.help.use',
    scope: 'org',
    tool: null,
    level: 'read',
    orgRoles: ['member', 'billing_admin'],
  },
  // F1: whoever can add drawings can have Nova read them and decide the suggestions.
  { key: 'ai.drawing_register.extract', scope: 'project', tool: 'documents', level: 'standard' },
  { key: 'ai.suggestions.read', scope: 'project', tool: null, level: 'read' },
  // F2: anyone on the project can ask; retrieval only searches what they can open (ai/04 §3).
  { key: 'ai.ask.use', scope: 'project', tool: null, level: 'read' },
  // Indexing reads every document in the project, so it needs document admin.
  { key: 'ai.project_index.run', scope: 'project', tool: 'documents', level: 'admin' },
  // F33: site managers draft inductions. Moves to the workforce tool when that module and tool exist (X58).
  { key: 'ai.induction.draft', scope: 'project', tool: 'project_admin', level: 'standard' },
  // F31: whoever runs an import asks Nova where the columns go. Moves to the import tool when the importer exists.
  { key: 'ai.import_mapping.suggest', scope: 'project', tool: 'project_admin', level: 'standard' },
  // F34: the commercial team (commitments admin on the project) reads contract reviews and decides their flags. The
  // playbook is kept by org admins with `ai.settings.manage`.
  // F35: anyone who can report an incident can ask Nova to look at a site photo; reviewing the signals and reading the
  // patterns is the builder's safety admin (same level as managing incidents).
  { key: 'ai.safety.scan', scope: 'project', tool: 'inspections', level: 'standard' },
  { key: 'ai.safety.review', scope: 'project', tool: 'inspections', level: 'admin' },
  { key: 'ai.contracts.review', scope: 'project', tool: 'commitments', level: 'admin' },
];
