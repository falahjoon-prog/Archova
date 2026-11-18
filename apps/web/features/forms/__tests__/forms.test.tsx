// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupBy, moveItem, newField, newKey } from '../lib/fields';

const list = vi.fn();
vi.mock('../data/api', () => ({
  createFormsApi: () => ({
    list,
    projectTemplates: async () => [],
    attention: async () => [
      {
        kind: 'overdue',
        message: 'Toolbox Talk is overdue.',
        templateId: 't',
        templateName: 'T',
        formId: null,
        signerNames: [],
      },
    ],
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/assistant', () => ({ usePublishAssistantScope: () => undefined }));
vi.mock('@/shared/providers/CurrentProjectProvider', () => ({
  useCurrentProject: () => ({ projectId: 'prj_1', timezone: 'Australia/Melbourne' }),
}));
vi.mock('@/shared/providers/CurrentOrgProvider', () => ({
  useCurrentOrg: () => ({ orgId: 'org_1', orgSlug: 'harbour' }),
}));

import { FormsScreen } from '../screens/FormsScreen';

afterEach(() => list.mockReset());

const summary = (id: string, templateName: string, status: 'draft' | 'submitted') => ({
  id,
  projectId: 'prj_1',
  numberLabel: 'FRM-0001',
  templateId: 'library:x',
  templateName,
  category: 'safety',
  title: `${templateName} 7 Nov`,
  status,
  createdById: 'usr_1',
  createdByName: 'Dana Smith',
  createdAt: '2026-11-07T01:00:00Z',
  submittedAt: null,
  signatureCount: 0,
});

describe('FormsScreen', () => {
  it('groups forms by template and shows Nova flags', async () => {
    list.mockResolvedValue([
      summary('frm_1', 'Toolbox Talk', 'submitted'),
      summary('frm_2', 'Job Hazard Analysis', 'draft'),
      summary('frm_3', 'Toolbox Talk', 'draft'),
    ]);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <FormsScreen />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('region', { name: 'Toolbox Talk' })).toBeTruthy());
    expect(screen.getByRole('region', { name: 'Job Hazard Analysis' })).toBeTruthy();
    expect(screen.getAllByText('Dana Smith', { exact: false }).length).toBe(3);
    await waitFor(() => expect(screen.getByText('Toolbox Talk is overdue.')).toBeTruthy());
  });
});

describe('builder helpers', () => {
  it('reorders, groups and generates unused keys', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(groupBy([1, 2, 3], (n) => (n % 2 ? 'odd' : 'even'))).toEqual([
      ['odd', [1, 3]],
      ['even', [2]],
    ]);
    const f = newField('text', []);
    expect(newKey('text', [f])).not.toBe(f.key);
    expect(newField('table', []).columns).toHaveLength(2);
  });
});
