import { decodeId, encodeId } from '@archova/domain';
import type {
  EffectivePermissions as EffectivePermissionsDto,
  PermissionTemplate,
} from '@archova/contracts';
import { AppError, defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { AccessService } from '../application/access-service';
import type { permissionTemplates } from '../infra/tables';

const toTemplateDto = (t: typeof permissionTemplates.$inferSelect): PermissionTemplate => ({
  id: encodeId('permissionTemplate', t.id),
  name: t.name,
  description: t.description,
  toolLevels: t.toolLevels,
  granular: t.granular,
  companyScopedTools: t.companyScopedTools,
  isSeeded: t.isSeeded,
  version: t.version,
});

export function accessRoutes(database: Database, access: AccessService) {
  return defineRoutes({
    listPermissionTemplates: async (input) => {
      const tenant = requireTenant(input);
      const rows = await database.withTenantTx(tenant, (scope) => access.listTemplates(scope), {
        readOnly: true,
      });
      return { status: 200, body: { data: rows.map(toTemplateDto) } };
    },
    getProjectPermissions: async (input) => {
      const tenant = requireTenant(input);
      const projectId = decodeId('project', input.params.projectId);
      if (!projectId) throw new AppError('project.not_found');
      const perms = await database.withTenantTx(
        tenant,
        (scope) => access.effectivePermissions(scope, projectId),
        {
          readOnly: true,
        },
      );
      const body: EffectivePermissionsDto = {
        ...perms,
        projectId: input.params.projectId,
        companyId: perms.companyId ? encodeId('company', perms.companyId) : null,
        granular: [...perms.granular],
        denied: [...perms.denied],
        companyScopedTools: [...perms.companyScopedTools],
      };
      return { status: 200, body };
    },
  });
}
