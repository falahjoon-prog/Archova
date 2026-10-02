import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_PASSWORD, uniqueEmail } from '@archova/testing';
import {
  API_HOST,
  APP_HOST,
  Browser,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

describe('web sessions (ADR-0004)', () => {
  it('signs up, sets __Host- cookies and reads the session', async () => {
    const browser = new Browser(t.app);
    const email = uniqueEmail('signup');
    const res = await browser.post('/v1/auth/signup', {
      email,
      password: TEST_PASSWORD,
      name: 'Jo Builder',
    });
    expect(res.statusCode).toBe(201);
    const sid = res.cookies.find((c) => c.name === '__Host-sid')!;
    expect(sid).toMatchObject({ httpOnly: true, secure: true, path: '/', sameSite: 'Lax' });
    expect(sid.domain).toBeUndefined();
    expect(res.json().user).toMatchObject({ email, name: 'Jo Builder', locale: 'en-AU' });
    expect(res.json().user.id).toMatch(/^usr_/);

    const me = await browser.get('/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { email }, memberships: [] });
  });

  it('rejects a duplicate email and weak passwords', async () => {
    const { email } = await signUp(t.app, 'dupe');
    const again = await new Browser(t.app).post('/v1/auth/signup', {
      email,
      password: TEST_PASSWORD,
      name: 'x',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('auth.email_taken');
    const weak = await new Browser(t.app).post('/v1/auth/signup', {
      email: uniqueEmail(),
      password: 'short',
      name: 'x',
    });
    expect(weak.statusCode).toBe(422);
    expect(weak.headers['content-type']).toContain('application/problem+json');
  });

  it('logs in, rejects wrong passwords with one generic error, and logs out', async () => {
    const { email } = await signUp(t.app, 'login');
    const wrong = await new Browser(t.app).post('/v1/auth/login', {
      email,
      password: 'not-the-password',
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('auth.invalid_credentials');
    const unknown = await new Browser(t.app).post('/v1/auth/login', {
      email: uniqueEmail('nobody'),
      password: TEST_PASSWORD,
    });
    expect(unknown.json().code).toBe('auth.invalid_credentials');

    const browser = new Browser(t.app);
    expect(
      (await browser.post('/v1/auth/login', { email, password: TEST_PASSWORD })).statusCode,
    ).toBe(200);
    const stolenCookie = browser.cookies.get('__Host-sid')!;
    expect((await browser.post('/v1/auth/logout')).statusCode).toBe(204);
    // The old cookie is dead server-side, even if a copy was kept.
    const replay = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { host: APP_HOST, cookie: `__Host-sid=${stolenCookie}` },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('requires Origin and the CSRF token on unsafe cookie requests', async () => {
    const { browser } = await signUp(t.app, 'csrf');
    const noToken = await browser.post('/v1/orgs', { name: 'X' }, { 'x-csrf-token': 'wrong' });
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json().code).toBe('auth.csrf_failed');
    const evilOrigin = await browser.post(
      '/v1/orgs',
      { name: 'X' },
      { origin: 'https://evil.example' },
    );
    expect(evilOrigin.json().code).toBe('auth.csrf_failed');
    const loginFromEvil = await new Browser(t.app).post(
      '/v1/auth/login',
      { email: 'a@b.co', password: 'x' },
      { origin: 'https://evil.example' },
    );
    expect(loginFromEvil.statusCode).toBe(403);
  });

  it('accepts cookies only on app.<domain> and bearer only on api.<domain>', async () => {
    const { browser } = await signUp(t.app, 'origins');
    const cookie = `__Host-sid=${browser.cookies.get('__Host-sid')}`;
    const onApi = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { host: API_HOST, cookie },
    });
    expect(onApi.statusCode).toBe(401);
    const bearerOnApp = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { host: APP_HOST, authorization: 'Bearer abc' },
    });
    expect(bearerOnApp.json().code).toBe('auth.wrong_origin_credential');
    const unknownHost = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { host: 'evil.example', cookie },
    });
    expect(unknownHost.statusCode).toBe(404);
  });
});
