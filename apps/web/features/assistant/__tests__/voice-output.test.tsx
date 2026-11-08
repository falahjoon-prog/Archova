// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';
import { AssistantPanel } from '../components/AssistantPanel';
import { usePublishAssistantScope } from '../components/AssistantScope';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);
const speech = vi.hoisted(() => ({ supported: true, speak: vi.fn(), stopSpeaking: vi.fn() }));
vi.mock('@/shared/lib/speech', () => ({
  recordingSupported: () => false,
  startRecording: vi.fn(),
  stopSpeaking: speech.stopSpeaking,
  speak: speech.speak,
  speechSupported: () => speech.supported,
}));
vi.mock('@/shared/lib/api', () => ({
  api: {
    GET: async () => ({
      data: {
        periodStart: '2026-10-01',
        timezone: 'Australia/Sydney',
        allowance: 600,
        used: 1,
        remaining: 599,
        byFeature: [],
      },
      response: new Response(null, { status: 200 }),
    }),
  },
  ensureCsrfToken: async () => undefined,
}));

function Screen() {
  usePublishAssistantScope({ projectId: 'prj_test' });
  return null;
}
const renderPanel = () =>
  renderInProject(
    <>
      <Screen />
      <AssistantPanel />
    </>,
  );

beforeEach(() => {
  speech.supported = true;
  speech.speak.mockReset();
  speech.stopSpeaking.mockReset();
});

describe('Ask Nova voice output', () => {
  it('reads an answer aloud on request and can stop it', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(await screen.findByLabelText('Question'), 'Which RFIs are overdue?{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Read aloud' }, { timeout: 5000 }));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Stop reading' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(speech.stopSpeaking).toHaveBeenCalled();
  });

  it('reads answers automatically once the box is ticked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('checkbox', { name: "Read Nova's answers aloud" }));
    await user.type(screen.getByLabelText('Question'), 'Which RFIs are overdue?{Enter}');
    await waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1), { timeout: 5000 });
  });

  it('offers no voice output where the device has none', async () => {
    speech.supported = false;
    renderPanel();
    await screen.findByLabelText('Question');
    expect(screen.queryByRole('checkbox', { name: "Read Nova's answers aloud" })).toBeNull();
  });
});
