const MESSAGES: Record<string, string> = {
  google_cancelled: 'You cancelled the Google sign-in. Try again, or use your email and password.',
  google_expired: 'That Google sign-in took too long or was opened twice. Please try again.',
  google_unverified_email:
    'Google says this email address is not verified, so we cannot use it. Verify it with Google or use another account.',
  google_link_requires_sign_in:
    'This email already has an account with extra sign-in protection. Sign in the usual way first, then link Google from your account.',
  google_account_disabled:
    'This account has been disabled. Contact your organisation administrator.',
  google_unavailable: 'Google sign-in is not available right now. Use your email and password.',
  google_failed: 'Google sign-in did not complete. Please try again.',
};

/** The sign-in page's `?error=` value as a sentence; undefined for anything we did not send. */
export function googleErrorMessage(code: string | undefined): string | undefined {
  return code ? MESSAGES[code] : undefined;
}
