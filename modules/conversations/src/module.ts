import { defineModule, type KernelServices } from '@archova/kernel';
import { createConversationsService, type ConversationsDeps } from './application/conversations';
import { conversationsRoutes } from './api/routes';
import { CONVERSATIONS_PERMISSIONS } from './permissions';

export function createConversationsModule(services: KernelServices, deps: ConversationsDeps) {
  const service = createConversationsService(deps);
  return {
    definition: defineModule({ name: 'conversations', permissions: CONVERSATIONS_PERMISSIONS }),
    routes: conversationsRoutes(services.database, service),
    api: {},
  };
}

export type ConversationsModule = ReturnType<typeof createConversationsModule>;
