// Transactional SMS and email (one-time codes, link invites). Modules depend on this port; apps/api picks the
// adapter. The AU-hosted providers (AWS End User Messaging SMS and SES in ap-southeast-2) are Jeff's to wire.
import { AppError } from './errors';
import type { Logger } from './logger';

export interface MessageSender {
  /** `to` is E.164 (`+61412345678`). */
  sms(to: string, body: string): Promise<void>;
  email(to: string, message: { subject: string; text: string }): Promise<void>;
}

/** Development and the demo cell only: writes the message to the log instead of sending it. */
export function createLogMessageSender(logger: Pick<Logger, 'info'>): MessageSender {
  return {
    async sms(to, body) {
      logger.info({ channel: 'sms', to, body }, 'message not sent (log adapter)');
    },
    async email(to, message) {
      logger.info({ channel: 'email', to, ...message }, 'message not sent (log adapter)');
    },
  };
}

/** No provider configured: anything that needs a message fails with `messages.unavailable`. */
export const disabledMessageSender: MessageSender = {
  async sms() {
    throw new AppError('messages.unavailable', "We can't send text messages right now.");
  },
  async email() {
    throw new AppError('messages.unavailable', "We can't send emails right now.");
  },
};

/** Tests: keeps what was sent. */
export function createMemoryMessageSender(): MessageSender & {
  sent: Array<{ channel: 'sms' | 'email'; to: string; text: string }>;
} {
  const sent: Array<{ channel: 'sms' | 'email'; to: string; text: string }> = [];
  return {
    sent,
    async sms(to, body) {
      sent.push({ channel: 'sms', to, text: body });
    },
    async email(to, message) {
      sent.push({ channel: 'email', to, text: `${message.subject}\n${message.text}` });
    },
  };
}
