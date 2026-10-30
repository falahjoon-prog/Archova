'use client';

import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** The poster QR: the gate code as-is, which is what the phone's scanner reads. */
export function gateQrSvg(code: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(code);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

export function GateQr({ code, label }: { code: string; label: string }) {
  const svg = useMemo(() => gateQrSvg(code), [code]);
  // The markup comes from the QR library for a code the server issued; it holds no user text.
  return (
    <div
      role="img"
      aria-label={label}
      className="gate-qr"
      style={{ width: 240, maxWidth: '100%', background: '#fff', padding: 8, borderRadius: 8 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
