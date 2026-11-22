const NAMES = { google: 'Google', microsoft: 'Microsoft' } as const;

const REASONS: Record<string, (name: string) => string> = {
  cancelled: (n) => `You cancelled the ${n} sign-in. Try again, or use your email and password.`,
  expired: (n) => `That ${n} sign-in took too long or was opened twice. Please try again.`,
  unverified_email: (n) =>
    `${n} says this email address is not verified, so we cannot use it. Verify it with ${n} or use another account.`,
  link_requires_sign_in: (n) =>
    `This email already has an account. Sign in the usual way first, then link ${n} from your account.`,
  account_disabled: () =>
    'This account has been disabled. Contact your organisation administrator.',
  unavailable: (n) => `${n} sign-in is not available right now. Use your email and password.`,
  failed: (n) => `${n} sign-in did not complete. Please try again.`,
};

/** The sign-in page's `?error=` value (`google_cancelled`, `microsoft_failed`, ...) as a sentence; undefined for anything we did not send. */
export function externalErrorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const i = code.indexOf('_');
  const provider = code.slice(0, i);
  if (provider !== 'google' && provider !== 'microsoft') return undefined;
  return REASONS[code.slice(i + 1)]?.(NAMES[provider]);
}

/** Which provider an `?error=` value is about, for the alert title. */
export function externalErrorProvider(code: string | undefined): string {
  return code?.startsWith('microsoft_') ? 'Microsoft' : 'Google';
}
