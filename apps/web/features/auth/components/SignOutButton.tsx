'use client';

import { webRoutes } from '@archova/routes';
import { Button } from '@archova/ui';
import { LogOut } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { isApiError } from '@/shared/lib/errors';
import { useLogout } from '../hooks/useAuthMutations';

/** POST /v1/auth/logout, then a full page load to sign-in so no signed-in state survives in memory. */
export function SignOutButton() {
  const logout = useLogout();
  const leave = () => window.location.assign(webRoutes.login());
  return (
    <div className="sign-out">
      <Button
        variant="secondary"
        aria-label="Sign out"
        className="sign-out__button"
        loading={logout.isPending}
        onClick={() =>
          logout.mutate(undefined, {
            onSuccess: leave,
            // Already signed out (expired or revoked session): nothing left to revoke.
            onError: (error) => {
              if (isApiError(error, 401)) leave();
            },
          })
        }
      >
        <LogOut className="sign-out__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
        <span className="sign-out__label">Sign out</span>
      </Button>
      {logout.isError && !isApiError(logout.error, 401) ? (
        <ErrorAlert error={logout.error} />
      ) : null}
    </div>
  );
}
