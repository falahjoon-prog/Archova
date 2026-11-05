import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { EmailMessage, EmailSender } from '@archova/kernel';
import { buildRawMessage } from './mime';

/** Production sender: Amazon SES in an Australian region, so mail processing stays in Australia. */
export function createSesSender(opts: {
  region: string;
  from: string;
  replyTo?: string;
  configurationSet?: string;
}): EmailSender {
  const client = new SESv2Client({ region: opts.region });
  return {
    async send(m: EmailMessage) {
      // Attachments need a raw message; plain mail keeps the simple request.
      const res = await client.send(
        new SendEmailCommand({
          FromEmailAddress: opts.from,
          ReplyToAddresses: opts.replyTo ? [opts.replyTo] : undefined,
          ConfigurationSetName: opts.configurationSet,
          Destination: { ToAddresses: [m.to] },
          Content: m.attachments?.length
            ? {
                Raw: {
                  Data: Buffer.from(buildRawMessage(m, opts.from, opts.replyTo), 'utf8'),
                },
              }
            : {
                Simple: {
                  Subject: { Data: m.subject, Charset: 'UTF-8' },
                  Body: {
                    Text: { Data: m.text, Charset: 'UTF-8' },
                    Html: { Data: m.html, Charset: 'UTF-8' },
                  },
                },
              },
        }),
      );
      return res.MessageId ? { messageId: res.MessageId } : undefined;
    },
  };
}

/** Local sender: logs that a mail would go out (never the address or body) and sends nothing. */
export function createLogSender(
  log: (msg: string, o: Record<string, unknown>) => void,
): EmailSender {
  return {
    async send(m) {
      log('email not sent: WORKER_EMAIL_PROVIDER is not ses', { subject: m.subject });
    },
  };
}
