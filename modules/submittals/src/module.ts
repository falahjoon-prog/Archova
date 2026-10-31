import {
  defineModule,
  type KernelServices,
  type Logger,
  type MessageSender,
} from '@archova/kernel';
import { createSubmittalService, type SubmittalsDeps } from './application/submittals';
import { submittalsRoutes } from './api/routes';
import { SUBMITTALS_PERMISSIONS } from './permissions';

export function createSubmittalsModule(
  services: KernelServices,
  deps: SubmittalsDeps & { messages: MessageSender; logger?: Pick<Logger, 'warn'> },
) {
  const service = createSubmittalService(deps);
  return {
    definition: defineModule({ name: 'submittals', permissions: SUBMITTALS_PERMISSIONS }),
    routes: submittalsRoutes(services.database, service, {
      messages: deps.messages,
      ...(deps.logger ? { logger: deps.logger } : {}),
    }),
    api: {},
  };
}

export type SubmittalsModule = ReturnType<typeof createSubmittalsModule>;
