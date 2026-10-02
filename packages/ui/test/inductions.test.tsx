// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CredentialCaptureCard,
  ProgressStepper,
  SignaturePad,
  WatchToEndVideo,
  formatClock,
} from '../src';

afterEach(cleanup);

// jsdom has no canvas; the pad draws nothing here and the test reads its strokes.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

// jsdom has no PointerEvent; a MouseEvent with a pointer id carries the coordinates the pad reads.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent;
}

/** jsdom has no media playback: give the element a duration and a settable time. */
function fakeMedia(video: HTMLVideoElement, duration: number) {
  let t = 0;
  Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => t,
    set: (v: number) => {
      t = v;
    },
  });
  return {
    playTo(seconds: number) {
      // Playback advances in small steps, each a timeupdate.
      while (t < seconds) {
        t = Math.min(seconds, t + 0.5);
        fireEvent.timeUpdate(video);
      }
    },
    seekTo(seconds: number) {
      t = seconds;
      fireEvent.seeking(video);
    },
    get time() {
      return t;
    },
  };
}

describe('ProgressStepper', () => {
  it('says the step in words and shows that progress is saved', () => {
    render(<ProgressStepper current={3} total={8} label="Induction progress" saveState="saved" />);
    expect(screen.getByText('Step 3 of 8')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Induction progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(screen.getByText('Saved')).toBeTruthy();
  });
});

describe('WatchToEndVideo', () => {
  const props = {
    title: 'Welcome to site',
    src: '/v.webm',
    captionsSrc: '/v.vtt',
  };

  it("can't be skipped ahead on first view, and reports how far it was watched", () => {
    const onProgress = vi.fn();
    render(<WatchToEndVideo {...props} enforce onProgress={onProgress} />);
    const video = screen.getByLabelText('Welcome to site') as HTMLVideoElement;
    const media = fakeMedia(video, 60);
    media.playTo(12);
    media.seekTo(50);
    expect(media.time).toBe(12);
    fireEvent.pause(video);
    expect(onProgress).toHaveBeenLastCalledWith({ furthest: 12, duration: 60 });
    // Going back is always fine.
    media.seekTo(2);
    expect(media.time).toBe(2);
  });

  it('allows seeking once it has been watched', () => {
    render(<WatchToEndVideo {...props} enforce={false} onProgress={() => {}} />);
    const video = screen.getByLabelText('Welcome to site') as HTMLVideoElement;
    const media = fakeMedia(video, 60);
    media.seekTo(50);
    expect(media.time).toBe(50);
  });

  it('has captions on by default and labelled controls', () => {
    render(<WatchToEndVideo {...props} enforce onProgress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Captions' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeTruthy();
    expect(formatClock(134)).toBe('2:14');
  });
});

describe('SignaturePad', () => {
  it('collects drawn strokes as normalised points', () => {
    const onChange = vi.fn();
    render(<SignaturePad name="Sam Nguyen" onChange={onChange} />);
    const pad = screen.getByRole('img', { name: /Signature box/ });
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 100 }) as DOMRect;
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(pad, { clientX: 150, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    const value = onChange.mock.lastCall?.[0];
    expect(value.method).toBe('drawn');
    expect(value.strokes).toHaveLength(1);
    expect(value.strokes[0]).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
    ]);
  });

  it('offers a typed signature that counts only once confirmed (design 08 B6)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SignaturePad name="Sam Nguyen" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: "I can't draw a signature" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByLabelText('Typed signature: Sam Nguyen')).toBeTruthy();
    await user.click(screen.getByLabelText('I confirm this typed name is my signature.'));
    expect(onChange).toHaveBeenLastCalledWith({ method: 'typed', name: 'Sam Nguyen' });
  });
});

describe('CredentialCaptureCard', () => {
  it('says Recorded, never Verified, and passes the chosen photo up', async () => {
    const user = userEvent.setup();
    const onPhoto = vi.fn();
    render(
      <CredentialCaptureCard
        title="White card"
        required
        status="recorded"
        photo={null}
        onPhoto={onPhoto}
      />,
    );
    expect(screen.getByText('Recorded')).toBeTruthy();
    expect(screen.queryByText(/verified/i)).toBeNull();
    const file = new File(['x'], 'card.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Take photo'), file);
    expect(onPhoto).toHaveBeenCalledWith(file);
  });
});
