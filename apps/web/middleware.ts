import { NextResponse, type NextRequest } from 'next/server';

/** ADR-0004: the opaque web session cookie. Its value is only checked by the API; here we only test presence. */
const SESSION_COOKIE = '__Host-sid';

/**
 * Auth redirect only (frontend 03 §3): no database or API calls at the edge. Routes in the `(app)` group need a
 * session cookie; without one the user goes to sign-in with `next` set. Membership is verified by the org layout.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the auth pages, guest induction links (`/i/`, X58), guest transmittal links (`/t/`, X45), guest tender links (`/q/`, X45), the API paths proxied in development,
  // Next internals and static files.
  matcher: [
    '/((?!(?:login|signup|i|t|q)(?:/|$)|v1/|\\.well-known/|_next/|favicon\\.ico$|robots\\.txt$|.*\\.[a-zA-Z0-9]+$).+)',
    '/',
  ],
};
