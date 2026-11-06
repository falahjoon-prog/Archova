// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('@/shared/lib/uploads', () => ({
  uploadFile: vi.fn(async () => ({ id: 'fil_1' })),
  fileDownloadUrl: vi.fn(),
}));
vi.mock('@/shared/providers/useProjectDirectory', () => ({
  useProjectDirectory: () => ({ companies: [], people: [] }),
}));
vi.mock('@/features/budget', () => ({ useCostCodes: () => ({ data: [] }) }));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { ContractNewScreen } = await import('../screens/ContractNewScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const draft = (over: Record<string, unknown> = {}) => ({
  runId: 'air_1',
  fileName: 'contract.pdf',
  pageCount: 3,
  unreadPages: [],
  truncated: false,
  prices: 'exclude_gst',
  statedTotalExGst: null,
  linesTotalExGst: '65000.00',
  contractValueExGst: '70000.00',
  totalCheck: 'differs',
  difference: '-5000.00',
  dropped: 0,
  warnings: ['total_differs'],
  lines: [
    {
      code: '1.01',
      description: 'Preliminaries',
      amount: '40000.00',
      source: { page: 2, quote: '1.01 Preliminaries $40,000.00' },
    },
    {
      code: '',
      description: 'Demolition',
      amount: '25000.00',
      source: { page: 2, quote: 'Demolition $25,000.00' },
    },
  ],
  ...over,
});

beforeEach(() => fake.reset());

async function openAndRead(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Fill with Nova' }));
  const dialog = await screen.findByRole('dialog');
  await user.upload(
    within(dialog).getByLabelText(/Contract or pricing schedule/),
    new File(['%PDF'], 'contract.pdf', { type: 'application/pdf' }),
  );
  await user.click(within(dialog).getByRole('button', { name: 'Read with Nova' }));
  return dialog;
}

describe('Fill the schedule of values with Nova', () => {
  it('proposes lines with their page quotes, says when they differ, and adds only what is kept', async () => {
    const asked = vi.fn();
    fake.on('POST', `${P}/ai/contract-sov-drafts`, (init: { body?: unknown }) => {
      asked(init.body);
      return draft();
    });
    const user = userEvent.setup();
    renderInProject(<ContractNewScreen />);
    await enterText(user, screen.getByLabelText('Contract value (ex GST)'), '70000.00');
    const dialog = await openAndRead(user);

    expect(await within(dialog).findByDisplayValue('Preliminaries')).toBeTruthy();
    expect(asked).toHaveBeenCalledWith({ fileId: 'fil_1', contractValue: '70000.00' });
    expect(within(dialog).getByText(/Page 2: “1.01 Preliminaries \$40,000.00”/)).toBeTruthy();
    expect(within(dialog).getByText("These lines don't add up to the contract value")).toBeTruthy();
    // Nothing is in the form until Add is pressed.
    expect((screen.getAllByLabelText('Description 1')[0] as HTMLInputElement).value).toBe('');

    await user.click(within(dialog).getByRole('button', { name: 'Discard line 2' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 line to the schedule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByLabelText('Code 1') as HTMLInputElement).value).toBe('1.01');
    expect((screen.getByLabelText('Description 1') as HTMLInputElement).value).toBe(
      'Preliminaries',
    );
    expect((screen.getByLabelText('Amount 1 (ex GST)') as HTMLInputElement).value).toBe('40000.00');
    expect(screen.queryByLabelText('Description 2')).toBeNull();
  });

  it('adds nothing when the person cancels', async () => {
    fake.on('POST', `${P}/ai/contract-sov-drafts`, () => draft());
    const user = userEvent.setup();
    renderInProject(<ContractNewScreen />);
    const dialog = await openAndRead(user);
    await within(dialog).findByDisplayValue('Demolition');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByLabelText('Description 1') as HTMLInputElement).value).toBe('');
  });

  it('says so when the document has no schedule', async () => {
    fake.on('POST', `${P}/ai/contract-sov-drafts`, () =>
      draft({ lines: [], warnings: ['no_lines'], totalCheck: 'no_value', difference: null }),
    );
    const user = userEvent.setup();
    renderInProject(<ContractNewScreen />);
    const dialog = await openAndRead(user);
    expect(await within(dialog).findByText('Nova found no priced lines')).toBeTruthy();
  });
});
