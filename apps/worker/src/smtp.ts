import { randomUUID } from 'node:crypto';
import * as tls from 'node:tls';
import type { EmailMessage, EmailSender } from '@archova/kernel';
import { buildRawMessage } from './mime';

export interface SmtpOptions {
  host: string;
  /** 465 is implicit TLS, which is all this sender speaks. */
  port: number;
  user: string;
  pass: string;
  /** The From header, e.g. `Archova <noreply@archova.com.au>`. */
  from: string;
  replyTo?: string;
  /** For tests against a local server with its own certificate. */
  tls?: tls.ConnectionOptions;
  timeoutMs?: number;
}

const bare = (address: string) => /<([^<>]+)>/.exec(address)?.[1] ?? address.trim();

/** One SMTP exchange: the code and text of a (possibly multi-line) reply. */
function reader(socket: tls.TLSSocket) {
  let buf = '';
  const waiting: {
    resolve: (r: { code: number; text: string }) => void;
    reject: (e: Error) => void;
  }[] = [];
  const ready: { code: number; text: string }[] = [];
  const fail = (e: Error) => waiting.splice(0).forEach((w) => w.reject(e));
  socket.on('data', (d) => {
    buf += d.toString('utf8');
    for (;;) {
      const lines = buf.split('\r\n');
      const end = lines.findIndex((l) => /^\d{3} /.test(l));
      if (end < 0) return;
      const text = lines.slice(0, end + 1).join('\n');
      buf = lines.slice(end + 1).join('\r\n');
      const reply = { code: Number(lines[end]!.slice(0, 3)), text };
      const w = waiting.shift();
      if (w) w.resolve(reply);
      else ready.push(reply);
    }
  });
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('SMTP connection closed')));
  return () =>
    new Promise<{ code: number; text: string }>((resolve, reject) => {
      const r = ready.shift();
      if (r) resolve(r);
      else waiting.push({ resolve, reject });
    });
}

/**
 * Sends through an SMTP server over implicit TLS (port 465) with AUTH PLAIN, for mail that goes out through the
 * domain's own mail host instead of SES. No new dependency: the message is the same MIME the SES raw path builds.
 * The Message-ID is our own and there is no delivery confirmation: it returns the exact bytes sent and the relay's
 * reply as a send record, and nothing that needs delivery confirmation may rely on this sender.
 */
export function createSmtpSender(opts: SmtpOptions): EmailSender {
  return {
    async send(m: EmailMessage) {
      let sent: { messageId: string; raw: Uint8Array; serverResponse: string } | undefined;
      const socket = tls.connect({
        host: opts.host,
        port: opts.port,
        servername: opts.host,
        ...opts.tls,
      });
      const next = reader(socket);
      const timer = setTimeout(
        () => socket.destroy(new Error('SMTP timed out')),
        opts.timeoutMs ?? 30_000,
      );
      const expect = async (ok: number[], what: string) => {
        const r = await next();
        if (!ok.includes(r.code)) throw new Error(`SMTP ${what} refused (${r.code})`);
        return r;
      };
      const say = async (line: string, ok: number[], what: string) => {
        socket.write(`${line}\r\n`);
        return expect(ok, what);
      };
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('secureConnect', resolve);
          socket.once('error', reject);
        });
        await expect([220], 'greeting');
        await say(`EHLO ${opts.host.includes('.') ? 'archova.com.au' : opts.host}`, [250], 'EHLO');
        const plain = Buffer.from(`\0${opts.user}\0${opts.pass}`, 'utf8').toString('base64');
        await say(`AUTH PLAIN ${plain}`, [235], 'login');
        await say(`MAIL FROM:<${bare(opts.from)}>`, [250], 'sender');
        await say(`RCPT TO:<${bare(m.to)}>`, [250, 251], 'recipient');
        await say('DATA', [354], 'DATA');
        const domain = bare(opts.from).split('@')[1] ?? 'archova.com.au';
        const messageId = `<${randomUUID()}@${domain}>`;
        const raw =
          `Date: ${new Date().toUTCString()}\r\nMessage-ID: ${messageId}\r\n` +
          buildRawMessage(m, opts.from, opts.replyTo);
        // Dot-stuffing keeps a body line that starts with "." from ending the message early.
        socket.write(`${raw.replace(/^\./gm, '..')}\r\n.\r\n`);
        const accepted = await expect([250], 'message');
        // What we handed the relay, and its reply. The relay accepting it is not delivery to the recipient.
        sent = { messageId, raw: Buffer.from(raw, 'utf8'), serverResponse: accepted.text };
        socket.write('QUIT\r\n');
      } finally {
        clearTimeout(timer);
        socket.destroy();
      }
      return sent;
    },
  };
}
