// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enterText } from '@/test/render';
import { InductionWorkerScreen } from '../index';
import { PREVIEW_CODE, inductionSource as src, resetInductionPreview } from '../worker/data/source';
import type { OpenedInduction } from '../worker/lib/types';

type Open = Extract<OpenedInduction, { state: 'open' }>;

function renderAt(token: string, search = '') {
  window.history.replaceState(null, '', `/i/${token}${search}`);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InductionWorkerScreen token={token} />
    </QueryClientProvider>,
  );
}

/** A session that has done everything up to the declaration, as if resumed from the stored session. */
async function readyToSign() {
  const opened = (await src.open('demo', null)) as Open;
  const sid = opened.sessionId;
  await src.sendCode(
    sid,
    {
      name: 'Sam Worker',
      companyId: 'cmp_elec',
      companyName: 'Brightwire Electrical',
      mobile: '0412 345 678',
    },
    { kind: 'sms' },
  );
  await src.verify(sid, PREVIEW_CODE);
  for (const s of opened.induction.sections) await src.completeSection(sid, s.id, 30);
  await src.submitQuiz(sid, { q1: 'b', q2: 'a', q3: 'b', q4: 'a', q5: 'c' });
  await src.saveCredential(sid, {
    type: 'white_card',
    label: 'White card',
    number: 'CGI 123',
    state: 'NSW',
    expiry: null,
    photo: null,
  });
  sessionStorage.setItem('archova.induction.session', sid);
}

// jsdom has no canvas or scrolling; the signature pad and step changes call them.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.scrollTo = (() => undefined) as never;
});

beforeEach(() => {
  resetInductionPreview();
  sessionStorage.clear();
});

describe('worker induction', () => {
  it('says a revoked link no longer works, with the site office number', async () => {
    renderAt('revoked');
    expect(await screen.findByRole('heading', { name: 'This link no longer works' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '02 9000 0000' }).getAttribute('href')).toBe(
      'tel:0290000000',
    );
  });

  it('verifies the worker by code, then holds the video until it has been watched', async () => {
    const user = userEvent.setup();
    renderAt('demo');
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    // The token is taken out of the address bar once the link is exchanged.
    expect(window.location.pathname).toBe('/i/continue');
    expect(window.location.search).toBe('?step=details');

    await enterText(user, screen.getByLabelText('Full name'), 'Sam Worker');
    await user.selectOptions(screen.getByLabelText('Company'), 'Brightwire Electrical');
    await enterText(user, screen.getByLabelText('Mobile number'), '0412 345 678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await enterText(user, await screen.findByLabelText('6-digit code'), PREVIEW_CODE);
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('heading', { name: 'Thanks, Sam.' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    const next = await screen.findByRole('button', { name: /Watch to the end to continue/ });
    expect(next.getAttribute('aria-disabled')).toBe('true');
    await user.click(next);
    expect(window.location.search).toBe('?step=section&n=1');
  });

  it('opens the furthest step when the URL asks for one not reached yet (IND-AC4)', async () => {
    renderAt('demo', '?step=declaration');
    expect(await screen.findByRole('heading', { name: 'Your details' })).toBeTruthy();
  });

  it('signs with a typed signature and shows the finished induction (IND-AC6)', async () => {
    await readyToSign();
    const user = userEvent.setup();
    renderAt('continue', '?step=declaration');
    expect(await screen.findByRole('heading', { name: 'Sign your induction' })).toBeTruthy();
    expect(screen.getByText(/Harbour St Tower site induction, version 4, published/)).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Tick each statement to sign' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Sam Worker');

    await user.click(screen.getByRole('button', { name: "I can't draw a signature" }));
    await user.click(screen.getByLabelText('I confirm this typed name is my signature.'));
    await user.click(screen.getByRole('button', { name: 'Sign and finish' }));

    expect(
      await screen.findByRole('heading', { name: "You're inducted for Harbour St Tower." }),
    ).toBeTruthy();
    expect(screen.getByText(/Scan the site QR code to sign in/)).toBeTruthy();
    expect(window.location.search).toBe('?step=done');
  });
});
