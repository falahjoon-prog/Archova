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
    api: {
      /** Meeting agenda (`meetings`): submittals the caller can see that are due soon. */
      dueForMeeting: service.dueForMeeting,
      /** Portfolio dashboard and report builder (`reporting`): counts and flat rows of the submittals the caller can see. */
      portfolioCounts: service.portfolioCounts,
      /** Global search (`search`): submittals the caller can see that match some words. */
      searchHits: service.searchHits,
      reportRows: service.reportRows,
      /** Programme links (`scheduling`): details of the submittals among some ids that the caller can see. */
      summariesByIds: service.summariesByIds,
    },
  };
}

export type SubmittalsModule = ReturnType<typeof createSubmittalsModule>;
