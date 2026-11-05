import * as asn1js from 'asn1js';
import type { ContentInfo } from 'pkijs';
import { Certificate, SignedData, TimeStampResp } from 'pkijs';
import type { TimestampVerifier } from '@archova/mod-financials';

const ID_KP_TIME_STAMPING = '1.3.6.1.5.5.7.3.8';
const toAb = (b: Uint8Array) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** The certificates in a PEM bundle. */
export function certificatesFromPem(pem: string): Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (blocks.length === 0) throw new Error('No certificates in the pinned bundle');
  return blocks.map((b) => {
    const der = Buffer.from(b.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, ''), 'base64');
    const asn = asn1js.fromBER(toAb(der));
    if (asn.offset === -1) throw new Error('Unreadable certificate in the pinned bundle');
    return new Certificate({ schema: asn.result });
  });
}

/**
 * Checks a timestamp response against pinned certificates only (the system trust store is not used): the CMS
 * signature, the signer's chain up to a pinned certificate, that the signer is valid now, and that its certificate
 * is limited to time stamping (RFC 3161 §2.3). The imprint and nonce are checked by the caller's parser.
 */
export function pinnedTimestampVerifier(caChainPem: string): TimestampVerifier {
  const trusted = certificatesFromPem(caChainPem);
  return async ({ response, message }) => {
    const asn = asn1js.fromBER(toAb(response));
    if (asn.offset === -1) throw new Error('Unreadable timestamp response');
    const resp = new TimeStampResp({ schema: asn.result });
    const token: ContentInfo | undefined = resp.timeStampToken;
    if (!token) throw new Error('The timestamp response has no token');
    const signed = new SignedData({ schema: token.content });
    let result;
    try {
      result = await signed.verify({
        signer: 0,
        data: toAb(message),
        trustedCerts: trusted,
        checkChain: true,
        checkDate: new Date(),
        extendedMode: true,
      });
    } catch (e) {
      throw new Error(
        `The timestamp did not verify against the pinned certificates: ${e instanceof Error ? e.message : 'failed'}`,
      );
    }
    if (!result.signatureVerified || !result.signerCertificateVerified)
      throw new Error('The timestamp did not verify against the pinned certificates');
    const eku = result.signerCertificate?.extensions?.find((x) => x.extnID === '2.5.29.37');
    const usages = (eku?.parsedValue as { keyPurposes?: string[] } | undefined)?.keyPurposes ?? [];
    if (!usages.includes(ID_KP_TIME_STAMPING))
      throw new Error('The timestamp signer is not a time-stamping certificate');
  };
}
