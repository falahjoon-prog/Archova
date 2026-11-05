'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { CostCode } from '../data/api';
import { useBudgetMutations, useCostCodes } from '../hooks/useBudget';

/** Cost codes for the project. A code is renamed or archived, never deleted, so budget lines keep their meaning. */
export function CostCodesPanel({ canManage }: { canManage: boolean }) {
  const project = useCurrentProject();
  const q = useCostCodes(project.projectId);
  const { createCostCode, updateCostCode } = useBudgetMutations(project.projectId);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const codes = q.data ?? [];
  const label = (id: string | null) => {
    const c = codes.find((x) => x.id === id);
    return c ? `${c.code} ${c.description}` : '—';
  };

  function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) return setError('Enter a code, like 03-100.');
    if (!description.trim()) return setError('Enter a description.');
    createCostCode.mutate(
      {
        code: code.trim(),
        description: description.trim(),
        ...(parentId ? { parentId } : {}),
      },
      {
        onSuccess: () => {
          setCode('');
          setDescription('');
          setParentId('');
        },
      },
    );
  }

  const columns: DataTableColumn<CostCode>[] = [
    {
      id: 'code',
      header: 'Code',
      rowHeader: true,
      sortValue: (c) => c.code,
      cell: (c) => <span className="u-mono">{c.code}</span>,
    },
    {
      id: 'description',
      header: 'Description',
      sortValue: (c) => c.description,
      cell: (c) => c.description,
    },
    { id: 'parent', header: 'Parent', cell: (c) => label(c.parentId) },
    {
      id: 'status',
      header: 'Status',
      cell: (c) =>
        c.archived ? (
          <StatusPill tone="neutral">Archived</StatusPill>
        ) : (
          <StatusPill tone="success">Active</StatusPill>
        ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'end' as const,
            cell: (c: CostCode) => (
              <Button
                size="sm"
                variant="secondary"
                loading={updateCostCode.isPending && updateCostCode.variables?.costCodeId === c.id}
                onClick={() =>
                  updateCostCode.mutate({ costCodeId: c.id, body: { archived: !c.archived } })
                }
              >
                {c.archived ? 'Restore' : 'Archive'}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="stack-lg">
      {canManage ? (
        <Card>
          <form className="stack" onSubmit={add} noValidate aria-label="Add a cost code">
            <div className="form-row">
              <TextField
                label="Code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <TextField
                label="Description"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <Select
                label="Parent code"
                placeholder="None"
                options={codes
                  .filter((c) => !c.archived)
                  .map((c) => ({ value: c.id, label: `${c.code} ${c.description}` }))}
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              />
            </div>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <ErrorAlert error={createCostCode.error} title="We couldn't add the cost code" />
            <div>
              <Button type="submit" loading={createCostCode.isPending}>
                Add cost code
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      <ErrorAlert error={q.error} title="We couldn't load the cost codes" />
      <ErrorAlert error={updateCostCode.error} title="We couldn't update the cost code" />
      {q.isPending ? (
        <SkeletonRows label="Loading cost codes…" />
      ) : q.data ? (
        <DataTable
          caption="Cost codes"
          columns={columns}
          rows={q.data}
          getRowId={(c) => c.id}
          defaultSort={{ columnId: 'code', direction: 'asc' }}
          empty={
            <EmptyState
              title="No cost codes yet"
              description="Add the codes you track cost against, then use them to build the budget."
            />
          }
        />
      ) : null}
    </div>
  );
}
