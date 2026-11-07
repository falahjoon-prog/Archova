import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTimestampRequest,
  parseTimestampResponse,
  sha256Bytes,
} from '@archova/mod-financials';
import { pinnedTimestampVerifier } from '../../src/tsa-verify';

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

/** A throwaway CA and time-stamping authority, so a real RFC 3161 response can be made and checked. */
function authority(dir: string, name: string) {
  const o = (args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  o([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    `${name}-ca.key`,
    '-out',
    `${name}-ca.pem`,
    '-subj',
    `/CN=${name} CA`,
    '-days',
    '2',
  ]);
  o([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    `${name}-tsa.key`,
    '-out',
    `${name}-tsa.csr`,
    '-subj',
    `/CN=${name} TSA`,
  ]);
  writeFileSync(
    join(dir, `${name}-ext.cnf`),
    'extendedKeyUsage=critical,timeStamping\nbasicConstraints=CA:FALSE\n',
  );
  o([
    'x509',
    '-req',
    '-in',
    `${name}-tsa.csr`,
    '-CA',
    `${name}-ca.pem`,
    '-CAkey',
    `${name}-ca.key`,
    '-CAcreateserial',
    '-out',
    `${name}-tsa.pem`,
    '-days',
    '2',
    '-extfile',
    `${name}-ext.cnf`,
  ]);
  writeFileSync(join(dir, `${name}-serial`), '01\n');
  writeFileSync(
    join(dir, `${name}-tsa.cnf`),
    `[tsa]\ndefault_tsa=tsa_config\n[tsa_config]\nserial=${dir}/${name}-serial\nsigner_cert=${dir}/${name}-tsa.pem\nsigner_key=${dir}/${name}-tsa.key\ncerts=${dir}/${name}-ca.pem\ndefault_policy=1.2.3.4.1\ndigests=sha256\nsigner_digest=sha256\nordering=no\ntsa_name=no\ness_cert_id_chain=no\n`,
  );
  return {
    caPem: readFileSync(join(dir, `${name}-ca.pem`), 'utf8'),
    reply(request: Buffer) {
      writeFileSync(join(dir, `${name}.tsq`), request);
      o([
        'ts',
        '-reply',
        '-queryfile',
        `${name}.tsq`,
        '-config',
        `${name}-tsa.cnf`,
        '-out',
        `${name}.tsr`,
      ]);
      return readFileSync(join(dir, `${name}.tsr`));
    },
  };
}

describe.skipIf(!hasOpenssl)('timestamp verification against pinned certificates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsa-test-'));
  const real = authority(dir, 'real');
  const other = authority(dir, 'other');
  const message = Buffer.from('seal message');
  const imprint = sha256Bytes(message);

  it('accepts a real response from the pinned authority and reads it', async () => {
    const { request, nonceHex } = buildTimestampRequest(imprint);
    const response = real.reply(request);
    await pinnedTimestampVerifier(real.caPem)({ request, response, message });
    const t = parseTimestampResponse(response, { imprint, nonceHex });
    expect(Math.abs(t.genTime.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('refuses a response signed by an authority that is not pinned', async () => {
    const { request } = buildTimestampRequest(imprint);
    const response = other.reply(request);
    await expect(
      pinnedTimestampVerifier(real.caPem)({ request, response, message }),
    ).rejects.toThrow(/did not verify/);
  });

  it('refuses a genuine response for different data', async () => {
    const { request } = buildTimestampRequest(imprint);
    const response = real.reply(request);
    await expect(
      pinnedTimestampVerifier(real.caPem)({
        request,
        response,
        message: Buffer.from('another message'),
      }),
    ).rejects.toThrow(/did not verify/);
  });
});
