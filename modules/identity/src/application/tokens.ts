import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
} from 'jose';
import type { Principal } from '@archova/kernel';
import { ACCESS_TOKEN_TTL_S } from '../domain/policy';

// 10-minute ES256 access JWTs for mobile and integrations (ADR-0004 §2): claims `sub`, `sid`, `client`.
// No roles and no org claim: the org always comes from the URL path (X4).

export interface TokenSigner {
  issue(p: { userId: string; sessionId: string; client: Principal['client'] }): Promise<string>;
  verify(token: string): Promise<{
    userId: string;
    sessionId: string;
    client: Principal['client'];
    authTime: Date;
  } | null>;
  jwks(): { keys: JWK[] };
}

export interface TokenConfig {
  issuer: string;
  audience: string;
  /** ES256 private JWK (JSON). When absent outside production, an ephemeral key is generated at boot. */
  privateJwk: string | null;
}

export async function createTokenSigner(cfg: TokenConfig): Promise<TokenSigner> {
  let privateJwk: JWK;
  if (cfg.privateJwk) {
    privateJwk = JSON.parse(cfg.privateJwk) as JWK;
  } else {
    const pair = await generateKeyPair('ES256', { extractable: true });
    privateJwk = await exportJWK(pair.privateKey);
  }
  const { d: _d, ...publicJwk } = privateJwk;
  const kid = await calculateJwkThumbprint(publicJwk);
  const privateKey = await importJWK({ ...privateJwk, alg: 'ES256' }, 'ES256');
  const publicKey = await importJWK({ ...publicJwk, alg: 'ES256' }, 'ES256');
  const published: JWK = { ...publicJwk, kid, alg: 'ES256', use: 'sig' };

  return {
    async issue({ userId, sessionId, client }) {
      return new SignJWT({ sid: sessionId, client })
        .setProtectedHeader({ alg: 'ES256', kid, typ: 'at+jwt' })
        .setSubject(userId)
        .setIssuer(cfg.issuer)
        .setAudience(cfg.audience)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_S}s`)
        .sign(privateKey);
    },
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, publicKey, {
          issuer: cfg.issuer,
          audience: cfg.audience,
          algorithms: ['ES256'],
          typ: 'at+jwt',
        });
        if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
        const client = payload.client;
        if (client !== 'ios' && client !== 'android' && client !== 'api' && client !== 'web')
          return null;
        return {
          userId: payload.sub,
          sessionId: payload.sid,
          client,
          authTime: new Date((payload.iat ?? 0) * 1000),
        };
      } catch {
        return null;
      }
    },
    jwks: () => ({ keys: [published] }),
  };
}
