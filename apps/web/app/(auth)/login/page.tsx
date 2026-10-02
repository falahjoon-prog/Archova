import type { Metadata } from 'next';
import { LoginScreen } from '@/features/auth';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return <LoginScreen next={typeof next === 'string' ? next : undefined} />;
}
