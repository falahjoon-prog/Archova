// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject, enterText } from '@/test/render';
import { resetRfisPreview } from '@/features/rfis';
import { AssistantPanel } from '../components/AssistantPanel';
import { usePublishAssistantScope, type AssistantScope } from '../components/AssistantScope';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const usage = vi.hoisted(() => ({
  value: {
    periodStart: '2026-10-01',
    timezone: 'Australia/Sydney',
    allowance: 600,
    used: 120,
    remaining: 480,
    byFeature: [],
  } as Record<string, unknown>,
}));
vi.mock('@/shared/lib/api', () => ({
  api: { GET: async () => ({ data: usage.value, response: new Response(null, { status: 200 }) }) },
}));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T23:00:00Z'));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  resetRfisPreview();
  usage.value = { ...usage.value, used: 120, remaining: 480 };
});

function Screen({ scope }: { scope: AssistantScope }) {
  usePublishAssistantScope(scope);
  return null;
}

function renderPanel(scope: AssistantScope = { projectId: 'prj_test' }) {
  return renderInProject(
    <>
      <Screen scope={scope} />
      <AssistantPanel />
    </>,
  );
}

describe('Ask Nova panel', () => {
  it('answers with citations that link to the records', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText('120 of 600 credits used this month.')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Answering about' }).textContent).toContain(
      'Harbour St Tower',
    );
    await enterText(user, screen.getByLabelText('Question'), 'Which RFIs are overdue?');
    await user.keyboard('{Enter}');
    const answer = await screen.findByRole('region', { name: 'Answer from Nova' });
    await waitFor(() => expect(within(answer).getByRole('link', { name: 'RFI-003' })).toBeTruthy());
    expect(within(answer).getByRole('link', { name: 'RFI-003' }).getAttribute('href')).toBe(
      '/acme/projects/prj_test/rfis/rfi_003',
    );
    expect(answer.textContent).toContain('1 overdue RFI');
    expect(within(answer).getByRole('group', { name: 'Was this helpful?' })).toBeTruthy();
  });

  it('answers about the record on screen, and lets the person remove that context', async () => {
    const user = userEvent.setup();
    renderPanel({
      projectId: 'prj_test',
      record: { type: 'rfi', id: 'rfi_004', label: 'RFI-004' },
    });
    const chips = await screen.findByRole('list', { name: 'Answering about' });
    expect(within(chips).getByText('RFI-004')).toBeTruthy();
    await enterText(user, screen.getByLabelText('Question'), 'Who has this?');
    await user.keyboard('{Enter}');
    const answer = await screen.findByRole('region', { name: 'Answer from Nova' });
    await waitFor(() => expect(answer.textContent).toContain('waiting on Brightwire Electrical'));

    await user.click(screen.getByRole('button', { name: 'Remove RFI-004' }));
    expect(
      within(screen.getByRole('list', { name: 'Answering about' })).queryByText('RFI-004'),
    ).toBeNull();
  });

  it('says plainly when the answer is not in the project', async () => {
    const user = userEvent.setup();
    renderPanel();
    await enterText(user, screen.getByLabelText('Question'), 'What is the crane lift plan?');
    await user.keyboard('{Enter}');
    const nf = await screen.findByRole('region', { name: 'Not found' });
    await waitFor(() => expect(nf.textContent).toContain("couldn't find that"));
  });

  it('shows the allowance state and stops asking when credits are used up', async () => {
    usage.value = { ...usage.value, used: 600, remaining: 0 };
    renderPanel();
    expect(await screen.findByText("Nova's allowance is used for this month")).toBeTruthy();
    expect(screen.getByText(/resets on 1 Nov 2026/)).toBeTruthy();
    expect((screen.getByLabelText('Question') as HTMLTextAreaElement).disabled).toBe(true);
  });
});
