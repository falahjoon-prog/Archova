'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { Alert, Card, PageHeader } from '@archova/ui';
import { ExternalSignInButtons } from '../components/ExternalSignInButtons';
import { externalErrorMessage, externalErrorProvider } from '../lib/external-errors';
import { LoginForm } from '../forms/LoginForm';
import { useRedirectAfterSignIn } from '../hooks/useRedirectAfterSignIn';

export function LoginScreen({ next, error }: { next?: string; error?: string }) {
  const externalError = externalErrorMessage(error);
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
          {externalError ? (
            <Alert
              tone="danger"
              title={`We couldn't sign you in with ${externalErrorProvider(error)}`}
            >
              {externalError}
            </Alert>
          ) : null}
          <ExternalSignInButtons {...(next ? { next } : {})} />
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
