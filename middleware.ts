import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    if (token) {
      const userRole = token.role?.toLowerCase();

      // Redirect root path to their dashboard
      if (path === '/') {
        return NextResponse.redirect(new URL(`/${userRole}`, req.url));
      }

      // Redirect authenticated users away from /login and /register
      if (path === '/login' || path === '/register') {
        return NextResponse.redirect(new URL(`/${userRole}`, req.url));
      }

      // Role-based dashboard authorization guard
      if (path.startsWith('/admin') && userRole !== 'admin') {
        return NextResponse.redirect(new URL(`/${userRole}`, req.url));
      }
      if (path.startsWith('/professor') && userRole !== 'professor') {
        return NextResponse.redirect(new URL(`/${userRole}`, req.url));
      }
      if (path.startsWith('/student') && userRole !== 'student') {
        return NextResponse.redirect(new URL(`/${userRole}`, req.url));
      }
      if (path.startsWith('/ta') && userRole !== 'ta') {
        return NextResponse.redirect(new URL(`/${userRole}`, req.url));
      }
    }
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const path = req.nextUrl.pathname;

        // Allow unauthenticated access to login, register, and public APIs
        if (
          path.startsWith('/api') ||
          path === '/login' ||
          path === '/register'
        ) {
          return true;
        }

        // Require authentication for all other routes (dashboards and root "/")
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
