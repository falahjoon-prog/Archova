import type { Metadata } from 'next';
import { SignupScreen } from '@/features/auth';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return <SignupScreen next={typeof next === 'string' ? next : undefined} />;
}
