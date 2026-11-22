'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { Alert, Card, PageHeader } from '@archova/ui';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { googleErrorMessage } from '../lib/google-errors';
import { LoginForm } from '../forms/LoginForm';
import { useRedirectAfterSignIn } from '../hooks/useRedirectAfterSignIn';

export function LoginScreen({ next, error }: { next?: string; error?: string }) {
  const googleError = googleErrorMessage(error);
  const redirect = useRedirectAfterSignIn(next);
  const signupHref = next
    ? `${webRoutes.signup()}?next=${encodeURIComponent(next)}`
    : webRoutes.signup();
  return (
    <>
      <PageHeader
        title="Sign in"
        description="Use your Archova account to open your organisation."
      />
      <Card>
        <div className="stack">
          {googleError ? (
            <Alert tone="danger" title="We couldn't sign you in with Google">
              {googleError}
            </Alert>
          ) : null}
          <GoogleSignInButton {...(next ? { next } : {})} />
          <LoginForm onSignedIn={redirect} />
        </div>
      </Card>
      <p className="u-center">
        New to Archova?{' '}
        <Link className="link" href={signupHref}>
          Create an account
        </Link>
      </p>
    </>
  );
}
