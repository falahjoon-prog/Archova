import { describe, expect, it, vi } from 'vitest';
import { createTwilioSender } from '../../src/sms';

describe('createTwilioSender', () => {
  it('posts the message to the Australian region with the account credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 201 }));
    const sender = createTwilioSender({
      accountSid: 'AC123',
      authToken: 'secret',
      from: 'Archova',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await sender.send({ to: '+61412345678', body: 'Service is due.' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.au1.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('AC123:secret').toString('base64')}`,
    );
    const body = init.body as URLSearchParams;
    expect(body.get('To')).toBe('+61412345678');
    expect(body.get('From')).toBe('Archova');
    expect(body.get('Body')).toBe('Service is due.');
  });

  it('throws when Twilio refuses, without echoing the credentials', async () => {
    const sender = createTwilioSender({
      accountSid: 'AC123',
      authToken: 'secret',
      from: 'Archova',
      fetchImpl: (async () => new Response('no', { status: 400 })) as unknown as typeof fetch,
    });
    await expect(sender.send({ to: '+61412345678', body: 'x' })).rejects.toThrow(
      'Twilio refused the message (400)',
    );
  });
});
