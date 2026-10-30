import { decodeId } from '@archova/domain';
import { AppError, defineRoutes, requireTenant } from '@archova/kernel';
import type { RegisterService } from '../application/register';
import type { RegisterFilter } from '../domain/register';

export function schedulingRoutes(register: RegisterService) {
  return defineRoutes({
    getDelayRegister: async (input) => {
      const projectId = decodeId('project', input.params.projectId);
      if (!projectId) throw new AppError('project.not_found');
      const q = input.query ?? {};
      const filter: RegisterFilter = {
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(q.cause ? { cause: q.cause } : {}),
        ...(q.source ? { source: q.source } : {}),
        ...(q.eotOnly === 'true' ? { eotOnly: true } : {}),
      };
      if (filter.from && filter.to && filter.to < filter.from)
        throw new AppError('validation_failed', '`to` must be on or after `from`.', [
          { path: 'to', message: 'Before from' },
        ]);
      return { status: 200, body: await register.build(requireTenant(input), projectId, filter) };
    },
  });
}
