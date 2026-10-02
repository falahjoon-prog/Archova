import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { Card, PageHeader } from '@archova/ui';
import { CentredShell } from '@/shared/layout/AppShell';

export default function NotFound() {
  return (
    <CentredShell>
      <PageHeader title="Page not found" />
      <Card>
        <p className="u-m-0">
          This page doesn&apos;t exist, or you don&apos;t have access to it. Check the link, or ask
          the person who sent it to add you.
        </p>
      </Card>
      <p className="u-center">
        <Link className="link" href={webRoutes.orgPicker()}>
          Go to your organisations
        </Link>
      </p>
    </CentredShell>
  );
}
