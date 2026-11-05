'use client';

import { useState } from 'react';
import { PageHeader, Tabs } from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { BudgetPanel } from '../components/BudgetPanel';
import { CostCodesPanel } from '../components/CostCodesPanel';

/** Project budget and the cost codes it is built from. */
export function BudgetScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'budget', id: 'budget' },
  });
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const canManage =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.budget, 'admin');
  const [tab, setTab] = useState('budget');

  return (
    <div className="stack-lg">
      <PageHeader
        title="Budget"
        description="The project budget by cost code. Once locked, every change is an adjustment with a reason."
      />
      <Tabs
        label="Budget sections"
        tabs={[
          { id: 'budget', label: 'Budget' },
          { id: 'codes', label: 'Cost codes' },
        ]}
        value={tab}
        onValueChange={setTab}
      >
        {tab === 'budget' ? (
          <BudgetPanel canManage={canManage} />
        ) : (
          <CostCodesPanel canManage={canManage} />
        )}
      </Tabs>
    </div>
  );
}
