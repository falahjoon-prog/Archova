'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { webRoutes } from '@archova/routes';
import { Alert, Button, Card, PageHeader, TextField, buttonClassName } from '@archova/ui';
import { AttendanceIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useCheckInMutations } from '../hooks/useAttendance';
import { parseGateCode, type CheckInMessage } from '../lib/checkin';

/**
 * Where a gate poster's QR lands when scanned with a phone camera: check in or out of the site.
 * The gate code is in the URL fragment (`#code=`) and never leaves the browser except in the API call.
 */
export function CheckInScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const { checkIn, checkOut } = useCheckInMutations();
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<CheckInMessage | null>(null);

  useEffect(() => {
    const read = () => setCode(parseGateCode(decodeURIComponent(window.location.hash)));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const pending = checkIn.isPending || checkOut.isPending;
  const error = checkIn.error ?? checkOut.error;
  const typedCode = parseGateCode(typed);

  return (
    <>
      <PageHeader
        eyebrow="Workforce"
        title="Site check-in"
        description="Check in when you arrive and out when you leave. Your hours feed the attendance and timesheet pages."
      />
      <div className="stack">
        {result ? (
          <Alert tone={result.tone} title={result.title}>
            {result.detail ? <p className="u-m-0">{result.detail}</p> : null}
          </Alert>
        ) : null}
        <ErrorAlert error={error} title="We couldn’t record that" />
        <Card title={code ? 'Ready to check in' : 'Scan the code at the gate'}>
          <div className="stack">
            {code ? (
              <p className="u-m-0">Gate code read. Check in now, or check out if you’re leaving.</p>
            ) : (
              <>
                <p className="u-m-0">
                  Point your phone’s camera at the code on the site gate, or type the code printed
                  under it.
                </p>
                <TextField
                  label="Gate code"
                  value={typed}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Button
                disabled={pending || !(code ?? typedCode)}
                onClick={() =>
                  checkIn.mutate((code ?? typedCode)!, { onSuccess: (m) => setResult(m) })
                }
              >
                <AttendanceIcon size={16} aria-hidden="true" />{' '}
                {checkIn.isPending ? 'Checking in…' : 'Check in'}
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  checkOut.mutate(code ?? typedCode, { onSuccess: (m) => setResult(m) })
                }
              >
                {checkOut.isPending ? 'Checking out…' : 'Check out'}
              </Button>
            </div>
          </div>
        </Card>
        <Link
          className={buttonClassName('secondary')}
          href={webRoutes.attendance(org.orgSlug, project.projectId)}
        >
          View attendance
        </Link>
      </div>
    </>
  );
}
