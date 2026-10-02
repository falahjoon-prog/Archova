'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { Card, PageHeader } from '@archova/ui';
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
        <SignupForm onSignedUp={redirect} />
      </Card>
      <p className="u-center">
        Already have an account?{' '}
        <Link className="link" href={webRoutes.login(next)}>
          Sign in
        </Link>
      </p>
    </>
  );
}
