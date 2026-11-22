'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { Card, PageHeader } from '@archova/ui';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { SignupForm } from '../forms/SignupForm';
import { useRedirectAfterSignIn } from '../hooks/useRedirectAfterSignIn';

export function SignupScreen({ next }: { next?: string }) {
  const redirect = useRedirectAfterSignIn(next);
  return (
    <>
      <PageHeader
        title="Create your account"
        description="You can create or join an organisation next."
      />
      <Card>
        <div className="stack">
          <GoogleSignInButton {...(next ? { next } : {})} />
          <SignupForm onSignedUp={redirect} />
        </div>
      </Card>
      <p className="u-center">
        Already have an account?{' '}
        <Link className="link" href={webRoutes.login(next)}>
          Sign in
        </Link>
      </p>
      <p className="u-center">
        Working for a company as a contractor?{' '}
        <Link className="link" href={webRoutes.signup(webRoutes.contractor())}>
          Create a free contractor account
        </Link>
      </p>
    </>
  );
}
