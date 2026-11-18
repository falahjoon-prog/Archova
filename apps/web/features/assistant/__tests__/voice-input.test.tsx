// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';
import { AssistantPanel } from '../components/AssistantPanel';
import { usePublishAssistantScope } from '../components/AssistantScope';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);
vi.mock('@/shared/lib/data-mode', async (orig) => ({
  ...(await orig<object>()),
  previewDataOnly: false,
}));
const speech = vi.hoisted(() => ({
  supported: true,
  start: vi.fn(),
  stopSpeaking: vi.fn(),
}));
vi.mock('@/shared/lib/speech', () => ({
  recordingSupported: () => speech.supported,
  startRecording: speech.start,
  stopSpeaking: speech.stopSpeaking,
}));
const listen = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock('../data/listen', () => ({ transcribeClip: listen.transcribe }));
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
  speech.start
    .mockReset()
    .mockResolvedValue({ stop: async () => new Blob(['x'], { type: 'audio/webm' }) });
  listen.transcribe.mockReset().mockResolvedValue('Which RFIs are overdue?');
});

describe('Ask Nova voice input', () => {
  it('records, turns the clip into words in the box and leaves them to edit', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Speak' }));
    await user.click(await screen.findByRole('button', { name: 'Stop and use' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toBe(
        'Which RFIs are overdue?',
      ),
    );
    expect(listen.transcribe).toHaveBeenCalledWith(
      expect.any(String),
      'prj_test',
      expect.any(Blob),
    );
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveProperty('disabled', false);
  });

  it('says so when nothing could be heard and keeps typing available', async () => {
    listen.transcribe.mockRejectedValue(new Error('nothing heard'));
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Speak' }));
    await user.click(await screen.findByRole('button', { name: 'Stop and use' }));
    expect((await screen.findByRole('alert')).textContent).toContain("couldn't hear that");
  });

  it('shows no microphone button where the browser cannot record', async () => {
    speech.supported = false;
    renderPanel();
    await screen.findByLabelText('Question');
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
  });
});
