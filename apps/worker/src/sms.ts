/** Sends one text message. Throws when the provider refuses it, so the caller can retry. */
export interface SmsSender {
  send(m: { to: string; body: string }): Promise<void>;
}

/**
 * Twilio, through its Australian region (`au1`) so message processing stays in Australia. `from` is a number Twilio
 * has issued to the account or a registered alphanumeric sender ID. Auth is the account's API credentials.
 */
export function createTwilioSender(opts: {
  accountSid: string;
  authToken: string;
  from: string;
  region?: string;
  fetchImpl?: typeof fetch;
}): SmsSender {
  const host = opts.region ? `api.${opts.region}.twilio.com` : 'api.au1.twilio.com';
  const f = opts.fetchImpl ?? fetch;
  return {
    async send(m) {
      const res = await f(`https://${host}/2010-04-01/Accounts/${opts.accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: m.to, From: opts.from, Body: m.body }),
      });
      if (!res.ok) throw new Error(`Twilio refused the message (${res.status})`);
    },
  };
}
