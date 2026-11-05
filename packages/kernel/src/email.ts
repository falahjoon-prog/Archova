/**
 * Outbound email port. Modules and jobs build a message and hand it to an `EmailSender`; the process that runs them
 * picks the adapter (SES in ap-southeast-2 in production, a log-only sender locally), so no module imports a mail SDK.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Files sent with the message. A service email carries the sealed PDF as an attachment, never a link. */
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface EmailSender {
  /**
   * Throws when the provider rejects or cannot be reached; callers decide whether to retry. Returns the provider's
   * message id when it gives one, which is how a later delivery confirmation is matched to the message.
   */
  send(message: EmailMessage): Promise<{ messageId?: string } | void>;
}
