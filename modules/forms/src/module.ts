import { defineModule, type KernelServices } from '@archova/kernel';
import { createFormsService, type FormsDeps } from './application/forms';
import { formsRoutes } from './api/routes';
import { FORMS_PERMISSIONS } from './permissions';

export type { FormsDeps } from './application/forms';

export function createFormsModule(services: KernelServices, deps: FormsDeps) {
  const service = createFormsService(deps);
  return {
    definition: defineModule({ name: 'forms', permissions: FORMS_PERMISSIONS }),
    routes: formsRoutes(services.database, service),
    api: {},
  };
}

export type FormsModule = ReturnType<typeof createFormsModule>;
