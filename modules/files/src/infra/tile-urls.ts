import { createSign } from 'node:crypto';

/**
 * Signed access to a drawing's tile pyramid (mobile 03 §3.3). One signature covers every object under the prefix, so
 * the phone fills `{z}/{x}/{y}` itself and caches tiles by key instead of asking for a URL per tile.
 */
export interface TileUrls {
  sign(
    prefix: string,
    o: { expiresInS: number },
  ): Promise<{ tileUrlTemplate: string; overviewUrl: string; expiresAt: Date }>;
}

const TEMPLATE_PATH = '{z}/{x}/{y}.webp';
const OVERVIEW_PATH = 'overview.webp';

/** Local runs and tests: no CDN, so the URLs only look right. */
export function createMemoryTileUrls(now: () => Date = () => new Date()): TileUrls {
  return {
    async sign(prefix, { expiresInS }) {
      const expiresAt = new Date(now().getTime() + expiresInS * 1000);
      const q = `?expires=${Math.floor(expiresAt.getTime() / 1000)}`;
      return {
        tileUrlTemplate: `memory://tiles/${prefix}/${TEMPLATE_PATH}${q}`,
        overviewUrl: `memory://tiles/${prefix}/${OVERVIEW_PATH}${q}`,
        expiresAt,
      };
    },
  };
}

export interface CloudFrontTileConfig {
  /** Distribution domain serving the files bucket, e.g. `files.archova.com.au`. */
  domain: string;
  keyPairId: string;
  /** PEM private key of the CloudFront key group's public key. Never logged. */
  privateKey: string;
}

const cfBase64 = (b: Buffer) =>
  b.toString('base64').replaceAll('+', '-').replaceAll('=', '_').replaceAll('/', '~');

/** CloudFront custom policy: a wildcard resource under the prefix with an expiry (RSA-SHA1, as CloudFront requires). */
export function createCloudFrontTileUrls(
  cfg: CloudFrontTileConfig,
  now: () => Date = () => new Date(),
): TileUrls {
  return {
    async sign(prefix, { expiresInS }) {
      const expiresAt = new Date(now().getTime() + expiresInS * 1000);
      const policy = JSON.stringify({
        Statement: [
          {
            Resource: `https://${cfg.domain}/${prefix}/*`,
            Condition: {
              DateLessThan: { 'AWS:EpochTime': Math.floor(expiresAt.getTime() / 1000) },
            },
          },
        ],
      });
      const signer = createSign('RSA-SHA1');
      signer.update(policy);
      const query =
        `?Policy=${cfBase64(Buffer.from(policy))}` +
        `&Signature=${cfBase64(signer.sign(cfg.privateKey))}` +
        `&Key-Pair-Id=${cfg.keyPairId}`;
      const base = `https://${cfg.domain}/${prefix}`;
      return {
        tileUrlTemplate: `${base}/${TEMPLATE_PATH}${query}`,
        overviewUrl: `${base}/${OVERVIEW_PATH}${query}`,
        expiresAt,
      };
    },
  };
}
