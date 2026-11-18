import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `conversations`. Conversations belong to the project team rather than one tool, so
// every active project member holds them (`tool: null`); outside users (subcontractors, owners) are refused in the
// application layer because the thread is the builder's internal chat.
export const CONVERSATIONS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'conversations.threads.read', scope: 'project', tool: null, level: 'read' },
  { key: 'conversations.threads.create', scope: 'project', tool: null, level: 'read' },
  { key: 'conversations.messages.post', scope: 'project', tool: null, level: 'read' },
];
