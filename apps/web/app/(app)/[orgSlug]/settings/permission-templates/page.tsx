import type { Metadata } from 'next';
import { PermissionTemplatesScreen } from '@/features/permission-templates';

export const metadata: Metadata = { title: 'Permission templates' };

export default function PermissionTemplatesPage() {
  return <PermissionTemplatesScreen />;
}
