import { createServer, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GetObjectCommand } from '@aws-sdk/client-s3';
import { clamdInstream, clamdVerdict, createClamAvScanner } from '../../src/infra/scanner';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** A stand-in for clamd: decodes INSTREAM chunks and answers like clamd does. */
function fakeClamd() {
  return createServer((socket) => {
    let buf = Buffer.alloc(0);
    let body = Buffer.alloc(0);
    let started = false;
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!started) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        expect(buf.subarray(0, end).toString()).toBe('zINSTREAM');
        buf = buf.subarray(end + 1);
        started = true;
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const text = body.toString();
          socket.end(
            text.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0',
          );
          return;
        }
        if (buf.length < 4 + len) return;
        body = Buffer.concat([body, buf.subarray(4, 4 + len)]);
        buf = buf.subarray(4 + len);
      }
    });
  });
}

async function* chunks(...parts: string[]) {
  for (const p of parts) yield Buffer.from(p);
}

describe('ClamAV scanner (infrastructure/09, security-licensing/09 §4)', () => {
  const server = fakeClamd();
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('maps clamd replies and fails closed on errors', () => {
    expect(clamdVerdict('stream: OK\0')).toBe('clean');
    expect(clamdVerdict('stream: Eicar-Test-Signature FOUND\0')).toBe('infected');
    expect(clamdVerdict('INSTREAM size limit exceeded. ERROR\0')).toBe('unscannable');
    expect(clamdVerdict('stream: Heuristics.Encrypted.PDF FOUND')).toBe('infected');
    expect(clamdVerdict('')).toBe('unscannable');
  });

  it('streams the object to clamd in chunks', async () => {
    expect(await clamdInstream('127.0.0.1', port, chunks('%PDF-1.7 ', 'sheet A-101'), 5000)).toBe(
      'stream: OK\0',
    );
    expect(
      await clamdInstream('127.0.0.1', port, chunks(EICAR.slice(0, 20), EICAR.slice(20)), 5000),
    ).toMatch(/FOUND/);
  });

  it('reads the quarantine object and leaves it pending when clamd is unreachable', async () => {
    const sent: GetObjectCommand[] = [];
    const s3 = {
      send: async (cmd: GetObjectCommand) => {
        sent.push(cmd);
        return { Body: chunks(EICAR) };
      },
    } as unknown as Parameters<typeof createClamAvScanner>[1];
    const cfg = { bucket: 'files', region: 'ap-southeast-2', host: '127.0.0.1', port };
    expect(await createClamAvScanner(cfg, s3).scan('quarantine/u1')).toBe('infected');
    expect(sent[0]!.input).toEqual({ Bucket: 'files', Key: 'quarantine/u1' });

    const errors: string[] = [];
    const down = createClamAvScanner(
      { ...cfg, port: 1, timeoutMs: 1000, onError: (_err, key) => errors.push(key) },
      s3,
    );
    expect(await down.scan('quarantine/u1')).toBe('pending');
    expect(errors).toEqual(['quarantine/u1']);
  });
});
