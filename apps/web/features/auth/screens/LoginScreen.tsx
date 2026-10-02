'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { Card, PageHeader } from '@archova/ui';
import { LoginForm } from '../forms/LoginForm';
import { useRedirectAfterSignIn } from '../hooks/useRedirectAfterSignIn';

export function LoginScreen({ next }: { next?: string }) {
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
        <LoginForm onSignedIn={redirect} />
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
