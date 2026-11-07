// Subcontracts and purchase orders against the project budget (financials commitments endpoints).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Commitment = S['Commitment'];
export type CommitmentDetail = S['CommitmentDetail'];
export type CommitmentInvoices = S['CommitmentInvoices'];
export type CommitmentInvoice = S['CommitmentInvoice'];
export type CommitmentInvoiceSummary = S['CommitmentInvoiceSummary'];
export type PaymentApplication = S['PaymentApplication'];
export type PaymentApplicationRow = S['PaymentApplicationRow'];
export type PaymentApplicationFinding = S['PaymentApplicationFinding'];

/** What the person chose for the PDF; anything left out takes the server default. */
export interface InvoicePdfOptions {
  sections?: string[];
  columns?: string[];
  paper?: 'a4' | 'letter';
  orientation?: 'portrait' | 'landscape';
  notes?: string;
  signatureBlock?: boolean;
  amountCertified?: string;
}

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;

export function createCommitmentsApi(orgId: string) {
  return {
    async list(projectId: string): Promise<Commitment[]> {
      return unwrap(await api.GET(`${P}/commitments`, { params: { path: { orgId, projectId } } }))
        .data;
    },
    async get(projectId: string, commitmentId: string): Promise<CommitmentDetail> {
      return unwrap(
        await api.GET(`${P}/commitments/{commitmentId}`, {
          params: { path: { orgId, projectId, commitmentId } },
        }),
      );
    },
    async invoices(projectId: string, commitmentId: string): Promise<CommitmentInvoices> {
      return unwrap(
        await api.GET(`${P}/commitments/{commitmentId}/invoices`, {
          params: { path: { orgId, projectId, commitmentId } },
        }),
      );
    },
    async invoice(
      projectId: string,
      commitmentId: string,
      claimId: string,
    ): Promise<PaymentApplication> {
      return unwrap(
        await api.GET(`${P}/commitments/{commitmentId}/invoices/{claimId}`, {
          params: { path: { orgId, projectId, commitmentId, claimId } },
        }),
      );
    },
    async invoicePdf(
      projectId: string,
      commitmentId: string,
      claimId: string,
      o: InvoicePdfOptions,
    ): Promise<File> {
      const r = unwrap(
        await api.POST(`${P}/commitments/{commitmentId}/invoices/{claimId}/pdf`, {
          params: { path: { orgId, projectId, commitmentId, claimId } },
          body: {
            ...(o.sections?.length ? { sections: o.sections as never } : {}),
            ...(o.columns?.length ? { columns: o.columns as never } : {}),
            ...(o.paper ? { paper: o.paper } : {}),
            ...(o.orientation ? { orientation: o.orientation } : {}),
            ...(o.notes?.trim() ? { notes: o.notes.trim() } : {}),
            ...(o.signatureBlock ? { signatureBlock: true } : {}),
            ...(o.amountCertified ? { amountCertified: o.amountCertified } : {}),
          },
        }),
      );
      const bytes = Uint8Array.from(atob(r.dataBase64), (c) => c.charCodeAt(0));
      return new File([bytes], r.filename, { type: r.contentType });
    },
    async linkContract(
      projectId: string,
      commitmentId: string,
      contractId: string | null,
    ): Promise<CommitmentDetail> {
      return unwrap(
        await api.PUT(`${P}/commitments/{commitmentId}/contract`, {
          params: { path: { orgId, projectId, commitmentId } },
          body: { contractId },
        }),
      );
    },
  };
}
