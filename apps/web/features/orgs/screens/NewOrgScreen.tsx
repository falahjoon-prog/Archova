'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { webRoutes } from '@archova/routes';
import { Card, PageHeader } from '@archova/ui';
import { NewOrgForm } from '../forms/NewOrgForm';

export function NewOrgScreen() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="New organisation"
        description="Set up your company's workspace. You'll be its owner and can invite your team later."
      />
      <Card>
        <NewOrgForm onCreated={(org) => router.push(webRoutes.projects(org.slug))} />
      </Card>
      <p className="u-center">
        <Link className="link" href={webRoutes.orgPicker()}>
          Back to your organisations
        </Link>
      </p>
    </>
  );
}
