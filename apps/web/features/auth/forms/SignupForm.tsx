'use client';

import { useState, type FormEvent } from 'react';
import { SignupRequestSchema } from '@archova/contracts';
import { Button, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { parseForm, serverFieldErrors, type FieldErrors } from '@/shared/lib/forms';
import { useSignup } from '../hooks/useAuthMutations';

const MESSAGES = {
  name: 'Enter your full name.',
  email: 'Enter your email address, like name@company.com.au.',
  password: 'Use at least 10 characters.',
};

export function SignupForm({ onSignedUp }: { onSignedUp: () => void }) {
  const signup = useSignup();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseForm(
      SignupRequestSchema,
      { name: name.trim(), email: email.trim(), password },
      MESSAGES,
    );
    if (!parsed.ok) return setFieldErrors(parsed.fieldErrors);
    setFieldErrors({});
    signup.mutate(parsed.data, { onSuccess: onSignedUp });
  }

  const errors = { ...serverFieldErrors(signup.error), ...fieldErrors };
  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label="Create account">
      <ErrorAlert error={signup.error} title="We couldn't create your account" />
      <TextField
        label="Full name"
        name="name"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <TextField
        label="Work email"
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
        autoComplete="new-password"
        hint="At least 10 characters."
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      <Button type="submit" loading={signup.isPending}>
        {signup.isPending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
