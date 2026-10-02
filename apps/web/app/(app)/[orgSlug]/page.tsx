import { redirect } from 'next/navigation';
import { webRoutes } from '@archova/routes';

/** The org home (portfolio dashboard) comes later; for now it opens the project list. */
export default async function OrgHomePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  redirect(webRoutes.projects(decodeURIComponent(orgSlug)));
}
