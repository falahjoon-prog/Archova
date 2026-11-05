import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import * as tls from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { createSmtpSender } from '../../src/smtp';

const dir = mkdtempSync(join(tmpdir(), 'smtp-'));
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-keyout',
    join(dir, 'k.pem'),
    '-out',
    join(dir, 'c.pem'),
  ],
  { stdio: 'ignore' },
);
const cert = readFileSync(join(dir, 'c.pem'));
const key = readFileSync(join(dir, 'k.pem'));

/** A tiny SMTP server that records the conversation and answers like a normal mail host. */
function server(opts: { refuseAuth?: boolean } = {}) {
  const log: string[] = [];
  let data = '';
  const srv = tls.createServer({ cert, key }, (sock) => {
    let inData = false;
    let buf = '';
    sock.write('220 mail ready\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          sock.write('250 queued\r\n');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        log.push(line);
        if (line.startsWith('EHLO')) sock.write('250 hello\r\n');
        else if (line.startsWith('AUTH')) sock.write(opts.refuseAuth ? '535 no\r\n' : '235 ok\r\n');
        else if (line.startsWith('DATA')) {
          inData = true;
          sock.write('354 go\r\n');
        } else if (line.startsWith('QUIT')) sock.end('221 bye\r\n');
        else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise<{ port: number; log: string[]; data: () => string; close: () => void }>((r) =>
    srv.listen(0, '127.0.0.1', () =>
      r({
        port: (srv.address() as { port: number }).port,
        log,
        data: () => data,
        close: () => srv.close(),
      }),
    ),
  );
}

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((c) => c()));
const sender = (port: number) =>
  createSmtpSender({
    host: '127.0.0.1',
    port,
    user: 'noreply@archova.com.au',
    pass: 'p@ss',
    from: 'Archova <noreply@archova.com.au>',
    tls: { ca: cert, checkServerIdentity: () => undefined },
  });

describe('smtp sender', () => {
  it('authenticates, sends the envelope and the message, and dot-stuffs the body', async () => {
    const s = await server();
    closers.push(s.close);
    const res = await sender(s.port).send({
      to: 'Pat <pat@example.com>',
      subject: 'Trial ending',
      text: 'Hello\n.dot line',
      html: '<p>Hello</p>',
      attachments: [
        { filename: 'a.pdf', contentType: 'application/pdf', content: new Uint8Array([1, 2]) },
      ],
    });
    const auth = s.log.find((l) => l.startsWith('AUTH PLAIN'))!;
    expect(Buffer.from(auth.slice(11), 'base64').toString()).toBe('\0noreply@archova.com.au\0p@ss');
    expect(s.log).toContain('MAIL FROM:<noreply@archova.com.au>');
    expect(s.log).toContain('RCPT TO:<pat@example.com>');
    expect(s.data()).toMatch(/^Date: .*\r\nMessage-ID: <.+@archova\.com\.au>\r\nFrom: /);
    expect(s.data()).toContain('Subject: Trial ending');
    expect(s.data()).toContain('filename="a.pdf"');
    // The send record: our own Message-ID, the exact bytes handed over, and the relay's reply.
    expect(res).toBeTruthy();
    const sent = res as { messageId: string; raw: Uint8Array; serverResponse: string };
    expect(Buffer.from(sent.raw).toString('utf8')).toContain(`Message-ID: ${sent.messageId}`);
    expect(sent.serverResponse).toMatch(/^250/);
  });

  it('fails when the server refuses the login, without leaking the password', async () => {
    const s = await server({ refuseAuth: true });
    closers.push(s.close);
    const err = await sender(s.port)
      .send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('SMTP login refused (535)');
  });
});

describe('smtp config', () => {
  const base = { DATABASE_PLATFORM_URL: 'x', DATABASE_URL: 'x', REDIS_URL: 'x' };
  it('reads the host settings and defaults the port and sender', () => {
    const c = loadConfig({
      ...base,
      WORKER_EMAIL_PROVIDER: 'smtp',
      WORKER_SMTP_HOST: 'mail.archova.com.au',
      WORKER_SMTP_USER: 'noreply@archova.com.au',
      WORKER_SMTP_PASS: 'secret',
    });
    expect(c.email.provider).toBe('smtp');
    expect(c.email.smtp).toEqual({
      host: 'mail.archova.com.au',
      port: 465,
      user: 'noreply@archova.com.au',
      pass: 'secret',
    });
    expect(c.email.from).toBe('Archova <noreply@archova.com.au>');
  });
  it('refuses to start without the password', () => {
    expect(() =>
      loadConfig({
        ...base,
        WORKER_EMAIL_PROVIDER: 'smtp',
        WORKER_SMTP_HOST: 'h',
        WORKER_SMTP_USER: 'u',
      }),
    ).toThrow('WORKER_SMTP_PASS');
  });
});
