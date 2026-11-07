// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bySection, fieldIdFor } from '../lib/types';

const api = {
  templates: vi.fn(),
  submissions: vi.fn(),
  submission: vi.fn(),
  assign: vi.fn(),
  save: vi.fn(),
  submit: vi.fn(),
  review: vi.fn(),
  suggestions: vi.fn(),
  upload: vi.fn(),
};
vi.mock('../data/api', () => ({ createFormsApi: () => api }));
vi.mock('@/shared/lib/people', () => ({
  projectMembers: async () => [{ id: 'usr_1', name: 'Priya Shah', companyId: 'cmp_1' }],
}));
vi.mock('@/shared/hooks/useUrlState', () => ({
  useUrlState: () => [{ tab: '', id: '', status: '', flagged: '' }, () => undefined],
}));
vi.mock('@/features/assistant', () => ({ usePublishAssistantScope: () => undefined }));
vi.mock('@/shared/providers/CurrentProjectProvider', () => ({
  useCurrentProject: () => ({ projectId: 'prj_1', timezone: 'Australia/Brisbane' }),
}));
vi.mock('@/shared/providers/CurrentOrgProvider', () => ({
  useCurrentOrg: () => ({ orgId: 'org_1', orgSlug: 'harbour' }),
}));

import { FormsScreen } from '../screens/FormsScreen';
import { SubmissionPanel } from '../components/SubmissionPanel';
import { draftProblem } from '../components/TemplateBuilderDialog';

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
afterEach(() => Object.values(api).forEach((f) => f.mockReset()));

const row = (over: object = {}) => ({
  id: 'frs_1',
  projectId: 'prj_1',
  number: 1,
  numberLabel: 'FRM-0001',
  templateId: 'frt_1',
  templateName: 'Safety walk',
  templateVersion: 1,
  title: 'Safety walk FRM-0001',
  status: 'in_progress',
  assigneeId: 'usr_1',
  dueDate: '2026-11-01',
  flags: ['overdue'],
  daysLate: 6,
  missingRequiredCount: 2,
  relatedType: null,
  relatedId: null,
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  submittedAt: null,
  ...over,
});

describe('helpers', () => {
  it('makes unique field ids from labels', () => {
    expect(fieldIdFor('Area made safe?', [])).toBe('area_made_safe');
    expect(fieldIdFor('Area made safe?', ['area_made_safe'])).toBe('area_made_safe_2');
    expect(fieldIdFor('???', [])).toBe('field');
  });
  it('groups fields by section in order', () => {
    expect(
      bySection([{ section: 'A' }, { section: 'B' }, { section: 'A' }]).map((g) => [
        g.section,
        g.fields.length,
      ]),
    ).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
  });
  it('explains why a draft cannot be saved', () => {
    const d = {
      id: 'a',
      section: 'S',
      label: 'Pick',
      type: 'single_select' as const,
      required: false,
      helpText: '',
      optionsText: '',
      prefillKey: '' as const,
    };
    expect(draftProblem('', [])).toBe('Name the form.');
    expect(draftProblem('F', [d])).toBe('Give "Pick" at least one option.');
    expect(draftProblem('F', [{ ...d, optionsText: 'x\nX' }])).toBe(
      'Options on "Pick" must be different.',
    );
    expect(draftProblem('F', [{ ...d, optionsText: 'x\ny' }])).toBeNull();
  });
});

describe('forms register', () => {
  it('lists forms with Nova flags and a banner for the ones needing attention', async () => {
    api.templates.mockResolvedValue([
      { id: 'frt_1', name: 'Safety walk', status: 'published', version: 1, fields: [] },
    ]);
    api.submissions.mockResolvedValue({ data: [row()], nextCursor: null });
    wrap(<FormsScreen />);
    expect(await screen.findByRole('button', { name: 'Safety walk FRM-0001' })).toBeTruthy();
    expect(await screen.findByText(/1 form needs attention, 1 overdue/)).toBeTruthy();
    expect(screen.getAllByText('Overdue 6d').length).toBeGreaterThan(0);
    expect(screen.getByText('2 required left')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Priya Shah')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Assign a form/ })).toBeTruthy();
  });

  it('hides Assign for people who cannot see templates', async () => {
    api.templates.mockRejectedValue(new Error('404'));
    api.submissions.mockResolvedValue({
      data: [row({ flags: [], missingRequiredCount: 0 })],
      nextCursor: null,
    });
    wrap(<FormsScreen />);
    await screen.findByRole('button', { name: 'Safety walk FRM-0001' });
    expect(screen.queryByRole('button', { name: /Assign a form/ })).toBeNull();
  });
});

describe('fill-in', () => {
  const detail = (over: object = {}) => ({
    submission: row({ flags: [], daysLate: 0 }),
    fields: [
      {
        id: 'site',
        section: 'Details',
        label: 'Site',
        type: 'text',
        required: true,
        helpText: null,
        options: [],
        prefillKey: 'project.name',
      },
      {
        id: 'safe',
        section: 'Sign-off',
        label: 'Area made safe',
        type: 'yes_no',
        required: true,
        helpText: null,
        options: [],
        prefillKey: null,
      },
    ],
    answers: {},
    fileIds: [],
    missingRequired: ['site', 'safe'],
    canFill: true,
    canClose: false,
    ...over,
  });

  it('blocks submit until required fields are answered, then saves and submits', async () => {
    const user = userEvent.setup();
    api.save.mockResolvedValue(detail());
    api.submit.mockResolvedValue(detail());
    wrap(<SubmissionPanel detail={detail() as never} />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(api.save).not.toHaveBeenCalled();
    expect(screen.getAllByText('Required before you can submit')).toHaveLength(2);
    await user.type(screen.getByLabelText(/^Site \(required\)/), 'Level 3');
    await user.selectOptions(screen.getByLabelText(/^Area made safe/), 'no');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    expect(api.save.mock.calls[0]![2]).toEqual({
      answers: { site: 'Level 3', safe: false },
      fileIds: [],
    });
  });

  it('shows Nova suggestions and fills the field only when the person uses one', async () => {
    const user = userEvent.setup();
    api.suggestions.mockResolvedValue([{ fieldId: 'site', value: 'Tower F', source: 'Project' }]);
    wrap(<SubmissionPanel detail={detail() as never} />);
    await user.click(screen.getByRole('button', { name: 'Suggest answers' }));
    await screen.findByText('Tower F');
    expect((screen.getByLabelText(/^Site \(required\)/) as HTMLInputElement).value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Use suggestion for Site' }));
    expect((screen.getByLabelText(/^Site \(required\)/) as HTMLInputElement).value).toBe('Tower F');
  });

  it('is read-only once submitted, with review actions for a reviewer', () => {
    wrap(
      <SubmissionPanel
        detail={
          detail({
            canFill: false,
            canClose: true,
            submission: row({ status: 'submitted', flags: [] }),
          }) as never
        }
      />,
    );
    expect((screen.getByLabelText(/^Site \(required\)/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Return for changes' })).toBeTruthy();
  });
});
