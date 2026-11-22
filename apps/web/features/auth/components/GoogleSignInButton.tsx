'use client';

import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import { buttonClassName } from '@archova/ui';
import { api } from '@/shared/lib/api';

/** Which outside sign-in providers the API has switched on. Public, so it works before anyone is signed in. */
function useAuthProviders() {
  return useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: async () => unwrap(await api.GET('/v1/auth/providers')),
    staleTime: 5 * 60_000,
    retry: false,
    meta: { authRedirect: false },
  });
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.77.9 7.35 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * "Continue with Google": a plain link, because the sign-in is a full-page trip to Google and back. Renders nothing
 * until the API says Google is switched on, so a deployment without it shows no dead button.
 */
export function GoogleSignInButton({ next }: { next?: string }) {
  const providers = useAuthProviders();
  if (!providers.data?.google) return null;
  const href = next
    ? `/v1/auth/google/start?next=${encodeURIComponent(next)}`
    : '/v1/auth/google/start';
  return (
    <div className="stack">
      <a
        className={buttonClassName('secondary', 'auth-google')}
        href={href}
        data-testid="google-sign-in"
      >
        <GoogleMark />
        <span>Continue with Google</span>
      </a>
      <p className="u-center u-caption u-m-0">or use your email</p>
    </div>
  );
}
