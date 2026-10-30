// Retry schedule (integrations/06 §5): 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h, then every 6 h until 72 h after the
// event, when the delivery is abandoned and the subscription is disabled.
const STEPS_S = [30, 120, 600, 1800, 3600, 10_800, 21_600];
const EVERY_S = 21_600;
export const GIVE_UP_AFTER_MS = 72 * 3_600_000;

/** Seconds to wait after failed attempt number `attempts` (1 = the first attempt just failed). */
export const retryDelayS = (attempts: number) => STEPS_S[attempts - 1] ?? EVERY_S;

export const shouldAbandon = (createdAt: Date, now: Date) =>
  now.getTime() - createdAt.getTime() >= GIVE_UP_AFTER_MS;
