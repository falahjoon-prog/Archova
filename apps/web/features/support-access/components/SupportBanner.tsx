'use client';

import { Alert } from '@archova/ui';
import { useSupportBanner } from '../hooks/useSupportAccess';

/** Shown to every signed-in user of the company while an Archova support session is open (Sam 12 §4a). */
export function SupportBanner() {
  const banner = useSupportBanner();
  if (!banner.data?.active) return null;
  return (
    <Alert tone="warning" title="Archova support is viewing this company">
      Support can see project names, read only, because an admin allowed it for a support ticket. An
      owner or admin can withdraw that in Settings.
    </Alert>
  );
}
