import {
  defineModule,
  type KernelServices,
  type Logger,
  type MessageSender,
} from '@archova/kernel';
import { esignRoutes } from './api/routes';
import { createEnvelopeService } from './application/envelopes';
import type { EsignDeps } from './application/core';
import { createSigningService } from './application/signing';
import { ESIGN_PERMISSIONS } from './permissions';

export interface EsignModuleDeps extends Omit<EsignDeps, 'database' | 'redis' | 'logger'> {
  messages: MessageSender;
  logger?: Pick<Logger, 'warn' | 'error'>;
}

export function createEsignModule(services: KernelServices, deps: EsignModuleDeps) {
  const full: EsignDeps = {
    ...deps,
    database: services.database,
    redis: services.redis,
    logger: services.logger,
  };
  const envelopes = createEnvelopeService(full);
  const signing = createSigningService(full, envelopes);
  return {
    definition: defineModule({ name: 'esign', permissions: ESIGN_PERMISSIONS }),
    routes: esignRoutes(services.database, envelopes, signing, {
      messages: deps.messages,
      logger: services.logger,
    }),
  };
}

export type EsignModule = ReturnType<typeof createEsignModule>;
