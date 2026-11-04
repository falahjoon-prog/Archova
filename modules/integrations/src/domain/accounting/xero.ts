import { decimalToCents, centsToDecimal, resolveLines } from './money';
import { readJson, type FetchLike, type RateLimiter } from './http';
import type {
  AccountingProvider,
  FieldMap,
  LedgerDocument,
  PushResult,
  RemotePayment,
} from './types';

const API = 'https://api.xero.com/api.xro/2.0';

export interface XeroSession {
  // Returns a valid access token, refreshing and persisting the rotated refresh token when needed.
  accessToken(): Promise<string>;
  // One Xero organisation per connection (integrations/02 §4).
  tenantId: string;
}

interface XeroInvoice {
  InvoiceID: string;
  Status: string;
  UpdatedDateUTC?: string;
}

// Xero: bills are ACCPAY invoices, invoices are ACCREC (integrations/02 §4).
export function buildXeroInvoice(doc: LedgerDocument, map: FieldMap, invoiceId?: string) {
  return {
    ...(invoiceId ? { InvoiceID: invoiceId } : {}),
    Type: doc.kind === 'bill' ? 'ACCPAY' : 'ACCREC',
    Contact: { ContactID: doc.contactRemoteId },
    Date: doc.date,
    DueDate: doc.dueDate,
    Reference: doc.reference,
    // Never AUTHORISED: approval belongs to the bookkeeper.
    Status: doc.status === 'draft' ? 'DRAFT' : 'SUBMITTED',
    LineAmountTypes: 'Exclusive',
    LineItems: resolveLines(doc, map).map((l) => ({
      Description: l.description,
      Quantity: 1,
      UnitAmount: centsToDecimal(l.amountCents),
      AccountCode: l.target.accountRef,
      TaxType: l.target.taxRef,
      TaxAmount: centsToDecimal(l.gstCents),
      ...(l.target.trackingRef ? { Tracking: [{ TrackingOptionID: l.target.trackingRef }] } : {}),
    })),
  };
}

export function createXeroProvider(
  session: XeroSession,
  fetchFn: FetchLike,
  limiter: RateLimiter,
): AccountingProvider {
  const call = async (path: string, init: RequestInit = {}) =>
    limiter.run(async () =>
      readJson(
        'xero',
        await fetchFn(`${API}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${await session.accessToken()}`,
            'xero-tenant-id': session.tenantId,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...init.headers,
          },
        }),
      ),
    );

  return {
    name: 'xero',
    async push(doc, map): Promise<PushResult> {
      // Build first so an unmapped cost code fails before any network call.
      buildXeroInvoice(doc, map);
      const found = (await call(
        `/Invoices?where=${encodeURIComponent(`Reference=="${doc.reference}"`)}`,
      )) as {
        Invoices?: XeroInvoice[];
      };
      const existing = found.Invoices?.[0];
      const info = (i: XeroInvoice) => ({
        remoteId: i.InvoiceID,
        remoteVersion: i.UpdatedDateUTC ?? '',
        remoteStatus: i.Status.toLowerCase(),
      });
      // Only a draft is ever updated; once approved or paid it is the bookkeeper's (integrations/02 §3).
      if (existing && existing.Status !== 'DRAFT') return { outcome: 'locked', ...info(existing) };
      const res = (await call('/Invoices', {
        method: 'POST',
        // Retry-safe: the same reference and version always carry the same key.
        headers: { 'Idempotency-Key': `${doc.reference}:${existing?.InvoiceID ?? 'new'}` },
        body: JSON.stringify({ Invoices: [buildXeroInvoice(doc, map, existing?.InvoiceID)] }),
      })) as { Invoices: XeroInvoice[] };
      return { outcome: existing ? 'updated' : 'created', ...info(res.Invoices[0] as XeroInvoice) };
    },
    async findContact(q) {
      const lookup = async (where: string) =>
        (
          (await call(`/Contacts?where=${encodeURIComponent(where)}`)) as {
            Contacts?: { ContactID: string }[];
          }
        ).Contacts?.[0]?.ContactID;
      // An ABN names one entity: when we have it, a lookup that finds nothing must not fall back to a name, which could
      // bill a different business with the same name.
      const abn = q.abn?.replace(/\s/g, '');
      if (abn) {
        if (!/^\d{11}$/.test(abn)) return null;
        const byAbn = await lookup(`TaxNumber=="${abn}"`);
        return byAbn ? { remoteId: byAbn, matchedBy: 'abn' } : null;
      }
      // A name with a quote or backslash cannot be matched exactly in a where clause, so it matches nothing.
      if (/["\\]/.test(q.name)) return null;
      const byName = await lookup(`Name=="${q.name}"`);
      return byName ? { remoteId: byName, matchedBy: 'name' } : null;
    },
    async paymentsSince(since) {
      const res = (await call('/Payments', {
        headers: { 'If-Modified-Since': since.toUTCString() },
      })) as {
        Payments?: {
          PaymentID: string;
          Date: string;
          Amount: number;
          Status: string;
          Invoice?: { Reference?: string };
        }[];
      };
      const out: RemotePayment[] = [];
      for (const p of res.Payments ?? []) {
        const reference = p.Invoice?.Reference;
        // Only documents we pushed carry a PC- reference.
        if (!reference?.startsWith('PC-') || p.Status === 'DELETED') continue;
        out.push({
          remoteId: p.PaymentID,
          documentReference: reference,
          paidOn: xeroDate(p.Date),
          amountCents: decimalToCents(p.Amount),
        });
      }
      return out;
    },
  };
}

// Xero dates arrive as "/Date(1697500800000+0000)/" or ISO.
export function xeroDate(value: string): string {
  const m = /\/Date\((-?\d+)/.exec(value);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : value.slice(0, 10);
}
