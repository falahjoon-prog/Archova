import Link from 'next/link';
import type { ReactNode } from 'react';

/** Adapter so `@archova/ui` link slots (citation chips, `linkAs`) navigate client-side with next/link. */
export function AppLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
