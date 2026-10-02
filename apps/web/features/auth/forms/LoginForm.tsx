'use client';

import { useState, type FormEvent } from 'react';
import { LoginRequestSchema } from '@archova/contracts';
import { Button, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { parseForm, serverFieldErrors, type FieldErrors } from '@/shared/lib/forms';
import { useLogin } from '../hooks/useAuthMutations';

const MESSAGES = {
  email: 'Enter your email address, like name@company.com.au.',
  password: 'Enter your password.',
};

export function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseForm(LoginRequestSchema, { email: email.trim(), password }, MESSAGES);
    if (!parsed.ok) return setFieldErrors(parsed.fieldErrors);
    setFieldErrors({});
    login.mutate(parsed.data, { onSuccess: onSignedIn });
  }

  const errors = { ...serverFieldErrors(login.error), ...fieldErrors };
  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label="Sign in">
      <ErrorAlert error={login.error} title="We couldn't sign you in" />
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      <Button type="submit" loading={login.isPending}>
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
