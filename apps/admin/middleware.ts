import { NextResponse, type NextRequest } from 'next/server';

/** The staff session cookie: `__Host-csid` over HTTPS, `csid` on a plain-http local run. Only its presence is tested here. */
const COOKIES = ['__Host-csid', 'csid'];

export function middleware(req: NextRequest) {
  if (COOKIES.some((c) => req.cookies.has(c))) return NextResponse.next();
  const url = req.nextUrl.clone();
  const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  url.pathname = '/login';
  url.search = '';
  if (next !== '/') url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!login|internal|_next/|brand/|favicon\\.svg).*)'],
};
