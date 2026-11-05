import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';

/**
 * Proof that a sealed record is unaltered: an Ed25519 signature by the platform over what was sealed, plus an
 * RFC 3161 timestamp from an outside authority over the same bytes. Neither says the claim was served; service time is
 * the delivery confirmation of the email (compliance/01 §4).
 */

/** The exact text that is signed and timestamped. Binds the kind, the claim, the time and both hashes. */
export function sealMessage(i: {
  kind: string;
  claimId: string;
  sealedAt: string;
  snapshotSha256: string;
  pdfSha256: string;
}): string {
  return [
    'archova-evidence-v1',
    `kind:${i.kind}`,
    `claim:${i.claimId}`,
    `sealed:${i.sealedAt}`,
    `snapshot-sha256:${i.snapshotSha256}`,
    `pdf-sha256:${i.pdfSha256}`,
  ].join('\n');
}

export const sha256Bytes = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest();

export interface EvidenceSigner {
  /** The key used to sign new records. */
  keyId: string;
  publicKeyPem: string;
  sign(message: string): string;
  /** The public key for an id this signer holds (current or retired), else null. */
  publicKeyFor(keyId: string): string | null;
  /** True only when the signature is by the held key with that id over exactly this message. */
  verify(message: string, signatureBase64: string, keyId: string): boolean;
}

/**
 * `privateKeyPem` is an Ed25519 PKCS#8 PEM. `retired` holds the public keys (id to SPKI PEM) of earlier signing keys,
 * so records signed before a rotation still verify. Never reuse an id for a different key.
 */
export function createEvidenceSigner(
  keyId: string,
  privateKeyPem: string,
  retired: Record<string, string> = {},
): EvidenceSigner {
  const priv: KeyObject = createPrivateKey(privateKeyPem);
  if (priv.asymmetricKeyType !== 'ed25519')
    throw new Error('The evidence signing key must be Ed25519');
  const pub = createPublicKey(priv);
  const keys = new Map<string, KeyObject>();
  for (const [id, pem] of Object.entries(retired)) {
    const k = createPublicKey(pem);
    if (k.asymmetricKeyType !== 'ed25519') throw new Error(`Retired key ${id} is not Ed25519`);
    keys.set(id, k);
  }
  if (keys.has(keyId)) throw new Error(`Key id ${keyId} is both current and retired`);
  keys.set(keyId, pub);
  const pems = (id: string) =>
    keys.get(id)?.export({ type: 'spki', format: 'pem' }).toString() ?? null;
  return {
    keyId,
    publicKeyPem: pems(keyId)!,
    sign: (message) => edSign(null, Buffer.from(message, 'utf8'), priv).toString('base64'),
    publicKeyFor: pems,
    verify: (message, signatureBase64, id) => {
      const k = keys.get(id);
      return (
        !!k &&
        edVerify(null, Buffer.from(message, 'utf8'), k, Buffer.from(signatureBase64, 'base64'))
      );
    },
  };
}

// --- RFC 3161 (just enough DER to ask for a timestamp and read the answer) ---------------------------------------

const der = (tag: number, body: Uint8Array): Buffer => {
  const n = body.length;
  const len =
    n < 0x80
      ? Buffer.from([n])
      : n < 0x100
        ? Buffer.from([0x81, n])
        : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};

const SHA256_ALGORITHM = Buffer.from('300d06096086480165030402010500', 'hex');

/** A TimeStampReq for the SHA-256 of `message`, asking the authority to include its certificate. */
export function buildTimestampRequest(imprint: Uint8Array, nonce = randomBytes(8)) {
  if (imprint.length !== 32) throw new Error('A SHA-256 imprint is 32 bytes');
  const n = Buffer.from(nonce);
  n[0] = (n[0]! & 0x7f) | 0x01; // a positive INTEGER with no leading zero byte
  const body = Buffer.concat([
    der(0x02, Buffer.from([1])),
    der(0x30, Buffer.concat([SHA256_ALGORITHM, der(0x04, imprint)])),
    der(0x02, n),
    der(0x01, Buffer.from([0xff])),
  ]);
  return { request: der(0x30, body), nonceHex: n.toString('hex') };
}

interface Node {
  tag: number;
  body: Buffer;
}

function readNode(buf: Buffer, at: number): { node: Node; end: number } {
  if (at + 2 > buf.length) throw new Error('Truncated DER');
  const tag = buf[at]!;
  let len = buf[at + 1]!;
  let off = at + 2;
  if (len & 0x80) {
    const count = len & 0x7f;
    if (count < 1 || count > 3 || off + count > buf.length)
      throw new Error('Unsupported DER length');
    len = 0;
    for (let i = 0; i < count; i++) len = len * 256 + buf[off + i]!;
    off += count;
  }
  if (off + len > buf.length) throw new Error('Truncated DER');
  return { node: { tag, body: buf.subarray(off, off + len) }, end: off + len };
}

function children(n: Node): Node[] {
  const out: Node[] = [];
  for (let at = 0; at < n.body.length;) {
    const { node, end } = readNode(n.body, at);
    out.push(node);
    at = end;
  }
  return out;
}

const expect = (n: Node | undefined, tag: number, what: string): Node => {
  if (!n || n.tag !== tag) throw new Error(`Unexpected timestamp response: ${what}`);
  return n;
};

export interface TimestampResult {
  genTime: Date;
  imprintHex: string;
  nonceHex: string | null;
  serialHex: string;
  /** The whole TimeStampToken (a CMS SignedData), kept so anyone can check the authority's signature later. */
  token: Buffer;
}

const intHex = (n: Node) => n.body.toString('hex').replace(/^(00)+(?=.)/, '');

/**
 * Reads a TimeStampResp. Throws unless the authority granted the request and the token is for exactly this imprint
 * (and nonce). It does not check the authority's certificate chain: the token is stored whole so that can be done
 * against the authority's published certificate (`openssl ts -verify`).
 */
export function parseTimestampResponse(
  response: Uint8Array,
  expected: { imprint: Uint8Array; nonceHex: string },
): TimestampResult {
  const buf = Buffer.from(response);
  const resp = expect(readNode(buf, 0).node, 0x30, 'not a sequence');
  const [statusInfo, tokenNode] = children(resp);
  const status = children(expect(statusInfo, 0x30, 'no status'))[0];
  const code = Number(BigInt(`0x${intHex(expect(status, 0x02, 'no status code'))}`));
  if (code !== 0 && code !== 1)
    throw new Error(`The timestamp authority refused the request (${code})`);
  const token = expect(tokenNode, 0x30, 'no token');
  // ContentInfo { OID, [0] { SignedData { version, digestAlgorithms, encapContentInfo { OID, [0] { OCTET STRING } } } } }
  const signedData = expect(
    children(expect(children(token)[1], 0xa0, 'no content'))[0],
    0x30,
    'no signed data',
  );
  const encap = expect(children(signedData)[2], 0x30, 'no encapsulated content');
  const tstOctets = expect(
    children(expect(children(encap)[1], 0xa0, 'no TSTInfo'))[0],
    0x04,
    'no TSTInfo',
  );
  const tst = expect(readNode(tstOctets.body, 0).node, 0x30, 'bad TSTInfo');
  const [, , imprintNode, serial, genTimeNode, ...rest] = children(tst);
  const hashed = expect(children(expect(imprintNode, 0x30, 'no imprint'))[1], 0x04, 'no imprint');
  if (!hashed.body.equals(Buffer.from(expected.imprint)))
    throw new Error('The timestamp is for different data than was sent');
  const gt = expect(genTimeNode, 0x18, 'no time').body.toString('ascii');
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(?:\.\d+)?Z$/.exec(gt);
  if (!m) throw new Error('Unreadable timestamp time');
  const genTime = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  // After genTime: optional accuracy (SEQUENCE), ordering (BOOLEAN), then nonce (INTEGER).
  const nonceNode = rest.find((r) => r.tag === 0x02);
  const nonceHex = nonceNode ? intHex(nonceNode) : null;
  if (nonceHex !== null && nonceHex !== expected.nonceHex.replace(/^(00)+(?=.)/, ''))
    throw new Error('The timestamp answers a different request');
  if (nonceHex === null) throw new Error('The timestamp has no nonce, so it could be a replay');
  return {
    genTime,
    imprintHex: hashed.body.toString('hex'),
    nonceHex,
    serialHex: intHex(expect(serial, 0x02, 'no serial')),
    token: buf,
  };
}

/** Checks the authority's own signature and chain over the response; throws if it does not hold. */
export type TimestampVerifier = (check: {
  request: Buffer;
  response: Buffer;
  /** The exact bytes that were timestamped (the seal message); the verifier checks them against the token. */
  message: Buffer;
}) => Promise<void>;

/**
 * Asks an RFC 3161 authority and accepts the answer only if the verifier (pinned certificates) passes and the time
 * is within `maxSkewMs` of `now` (a token dated far from now could back-date evidence).
 */
export async function requestTimestamp(
  url: string,
  messageText: string,
  post: (url: string, body: Buffer) => Promise<Uint8Array>,
  verify: TimestampVerifier,
  now: Date,
  maxSkewMs = 10 * 60 * 1000,
): Promise<TimestampResult> {
  const message = Buffer.from(messageText, 'utf8');
  const imprint = sha256Bytes(message);
  const { request, nonceHex } = buildTimestampRequest(imprint);
  const response = Buffer.from(await post(url, request));
  const result = parseTimestampResponse(response, { imprint, nonceHex });
  if (Math.abs(result.genTime.getTime() - now.getTime()) > maxSkewMs)
    throw new Error('The timestamp is dated too far from now');
  await verify({ request, response, message });
  return result;
}
