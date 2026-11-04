/**
 * Outbound email port. Modules and jobs build a message and hand it to an `EmailSender`; the process that runs them
 * picks the adapter (SES in ap-southeast-2 in production, a log-only sender locally), so no module imports a mail SDK.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  /** Throws when the provider rejects or cannot be reached; callers decide whether to retry. */
  send(message: EmailMessage): Promise<void>;
}
