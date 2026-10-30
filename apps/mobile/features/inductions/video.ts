// "Watched to the end" is the induction record, so a video counts only when its time was actually played:
// jumping to the end or scrubbing through it adds nothing.

/** Largest gap between two time updates that still counts as playing; anything bigger was a seek. */
const MAX_STEP_SECONDS = 2;

/** Share of the video that must have been played, not skipped. */
const REQUIRED_SHARE = 0.9;

export interface WatchTracker {
  /** Report the player's current time; call on every time update. */
  tick(currentTime: number): void;
  /** The player reached the end. */
  ended(): void;
  /** Whether the video was played through to the end. */
  complete(duration: number): boolean;
  readonly watchedSeconds: number;
}

export function createWatchTracker(): WatchTracker {
  let last: number | null = null;
  // Whole seconds of the video that were played; replaying a part earns nothing new.
  const played = new Set<number>();
  let reachedEnd = false;
  return {
    tick(currentTime) {
      if (last !== null) {
        const step = currentTime - last;
        if (step > 0 && step <= MAX_STEP_SECONDS) {
          for (let s = Math.floor(last); s < Math.ceil(currentTime); s++) played.add(s);
        }
      }
      last = currentTime;
    },
    ended() {
      reachedEnd = true;
    },
    complete(duration) {
      return reachedEnd && duration > 0 && played.size >= duration * REQUIRED_SHARE;
    },
    get watchedSeconds() {
      return played.size;
    },
  };
}
