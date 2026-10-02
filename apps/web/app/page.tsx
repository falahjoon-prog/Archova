import { redirect } from 'next/navigation';
import { webRoutes } from '@archova/routes';

export default function HomePage() {
  redirect(webRoutes.orgPicker());
}
