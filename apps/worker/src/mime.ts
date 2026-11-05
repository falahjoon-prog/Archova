import { randomBytes } from 'node:crypto';
import type { EmailMessage } from '@archova/kernel';

const b64 = (data: Uint8Array) =>
  (
    Buffer.from(data)
      .toString('base64')
      .match(/.{1,76}/g) ?? []
  ).join('\r\n');

/** A header value with no line breaks, and RFC 2047 encoded when it is not plain ASCII. */
const header = (v: string) => {
  const clean = v.replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
};

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100) || 'file';
const bodyPart = (type: string, text: string) =>
  `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(Buffer.from(text, 'utf8'))}`;

/** A complete RFC 5322 message with attachments, for SES raw sending. From and To are added by SES from the request. */
export function buildRawMessage(
  m: EmailMessage,
  from: string,
  replyTo?: string,
  boundarySeed: string = randomBytes(12).toString('hex'),
): string {
  const mixed = `=_mixed_${boundarySeed}`;
  const alt = `=_alt_${boundarySeed}`;
  const head = [
    `From: ${header(from)}`,
    `To: ${header(m.to)}`,
    ...(replyTo ? [`Reply-To: ${header(replyTo)}`] : []),
    `Subject: ${header(m.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];
  const parts = [
    `--${mixed}\r\nContent-Type: multipart/alternative; boundary="${alt}"\r\n\r\n` +
      `--${alt}\r\n${bodyPart('text/plain', m.text)}\r\n--${alt}\r\n${bodyPart('text/html', m.html)}\r\n--${alt}--`,
    ...(m.attachments ?? []).map((a) => {
      const name = safeName(a.filename);
      return (
        `--${mixed}\r\nContent-Type: ${header(a.contentType)}; name="${name}"\r\n` +
        `Content-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(a.content)}`
      );
    }),
  ];
  return `${head.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${mixed}--\r\n`;
}
