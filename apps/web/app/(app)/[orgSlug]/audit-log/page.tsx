import type { Metadata } from 'next';
import { AuditLogScreen } from '@/features/reporting';

export const metadata: Metadata = { title: 'Audit log' };

export default function AuditLogPage() {
  return <AuditLogScreen />;
}
