import { decimalToCents, centsToDecimal, resolveLines } from './money';
import { readJson, type FetchLike, type RateLimiter } from './http';
import type {
  AccountingProvider,
  FieldMap,
  LedgerDocument,
  PushResult,
  RemotePayment,
} from './types';

export interface MyobSession {
  accessToken(): Promise<string>;
  // The developer key, shared across customers, so the limiter is app-wide (integrations/02 §5).
  apiKey: string;
  // Cloud company file base, e.g. https://api.myob.com/accountright/{companyFileId}.
  companyFileUrl: string;
}

interface MyobBill {
  UID: string;
  RowVersion?: string;
  Status?: string;
  BalanceDueAmount?: number;
  Number?: string;
}

// MYOB Business has no draft state for bills or invoices; a pushed document is open in the ledger.
// The bookkeeper still approves payment, and Archova never edits it after creation.
export function buildMyobDocument(doc: LedgerDocument, map: FieldMap) {
  const lines = resolveLines(doc, map).map((l) => ({
    Type: 'Transaction',
    Description: l.description,
    Total: Number(centsToDecimal(l.amountCents)),
    Account: { UID: l.target.accountRef },
    TaxCode: { UID: l.target.taxRef },
    ...(l.target.trackingRef ? { Job: { UID: l.target.trackingRef } } : {}),
  }));
  const common = { Date: doc.date, IsTaxInclusive: false, Lines: lines };
  return doc.kind === 'bill'
    ? { ...common, Supplier: { UID: doc.contactRemoteId }, SupplierInvoiceNumber: doc.reference }
    : {
        ...common,
        Customer: { UID: doc.contactRemoteId },
        CustomerPurchaseOrderNumber: doc.reference,
      };
}

const resource = (kind: LedgerDocument['kind']) =>
  kind === 'bill' ? '/Purchase/Bill/Service' : '/Sale/Invoice/Service';
const referenceField = (kind: LedgerDocument['kind']) =>
  kind === 'bill' ? 'SupplierInvoiceNumber' : 'CustomerPurchaseOrderNumber';

export function createMyobProvider(
  session: MyobSession,
  fetchFn: FetchLike,
  limiter: RateLimiter,
): AccountingProvider {
  const call = async (path: string, init: RequestInit = {}) =>
    limiter.run(async () => {
      const res = await fetchFn(`${session.companyFileUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${await session.accessToken()}`,
          'x-myobapi-key': session.apiKey,
          'x-myobapi-version': 'v2',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });
      // A create answers 201 with the new record's URL in Location and no body.
      if (res.status === 201) return { location: res.headers.get('Location') ?? '' };
      return readJson('myob', res);
    });

  return {
    name: 'myob',
    async push(doc, map): Promise<PushResult> {
      const body = buildMyobDocument(doc, map);
      const filter = encodeURIComponent(
        `${referenceField(doc.kind)} eq '${doc.reference.replace(/'/g, "''")}'`,
      );
      const found = (await call(`${resource(doc.kind)}?$filter=${filter}`)) as {
        Items?: MyobBill[];
      };
      const existing = found.Items?.[0];
      // MYOB cannot be a draft, so an existing document is never rewritten.
      if (existing) {
        return {
          outcome: 'locked',
          remoteId: existing.UID,
          remoteVersion: existing.RowVersion ?? '',
          remoteStatus: existing.Status?.toLowerCase() ?? 'open',
        };
      }
      const created = (await call(resource(doc.kind), {
        method: 'POST',
        body: JSON.stringify(body),
      })) as {
        location: string;
      };
      const uid = created.location.split('/').pop() ?? '';
      return { outcome: 'created', remoteId: uid, remoteVersion: '', remoteStatus: 'open' };
    },
    async findContact(q, role) {
      const path = role === 'supplier' ? '/Contact/Supplier' : '/Contact/Customer';
      const lookup = async (filter: string) =>
        (
          (await call(`${path}?$filter=${encodeURIComponent(filter)}`)) as {
            Items?: { UID: string }[];
          }
        ).Items?.[0]?.UID;
      const quote = (v: string) => v.replace(/'/g, "''");
      const abn = q.abn?.replace(/\s/g, '');
      const byAbn = abn ? await lookup(`TaxIdNumber eq '${quote(abn)}'`) : undefined;
      if (byAbn) return { remoteId: byAbn, matchedBy: 'abn' };
      const byName = await lookup(`CompanyName eq '${quote(q.name)}'`);
      return byName ? { remoteId: byName, matchedBy: 'name' } : null;
    },
    async paymentsSince(since) {
      const out: RemotePayment[] = [];
      type Item = {
        UID: string;
        Date: string;
        Lines?: { Purchase?: { SupplierInvoiceNumber?: string }; Amount: number }[];
        Invoices?: { CustomerPurchaseOrderNumber?: string; AmountApplied: number }[];
      };
      for (const path of ['/Purchase/SupplierPayment', '/Sale/CustomerPayment']) {
        const filter = encodeURIComponent(`LastModified gt datetime'${since.toISOString()}'`);
        const res = (await call(`${path}?$filter=${filter}`)) as { Items?: Item[] };
        for (const p of res.Items ?? []) {
          const applied = [
            ...(p.Lines ?? []).map((l) => ({
              reference: l.Purchase?.SupplierInvoiceNumber,
              amount: l.Amount,
            })),
            ...(p.Invoices ?? []).map((i) => ({
              reference: i.CustomerPurchaseOrderNumber,
              amount: i.AmountApplied,
            })),
          ];
          for (const { reference, amount } of applied) {
            if (!reference?.startsWith('PC-')) continue;
            out.push({
              remoteId: `${p.UID}:${reference}`,
              documentReference: reference,
              paidOn: p.Date.slice(0, 10),
              amountCents: decimalToCents(amount),
            });
          }
        }
      }
      return out;
    },
  };
}
