import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { hasPermission, Permission, UserRole } from './constants/permissions';
import { isFeatureEnabled } from './config/features';

import type { JWT } from 'next-auth/jwt';

export function proxyMiddleware(req: {
  nextUrl: { pathname: string };
  nextauth?: { token?: JWT | Record<string, unknown> | null };
  url: string;
}) {
  const token = req.nextauth?.token;
  const path = req.nextUrl.pathname;

    // API route protection (JSON 401 instead of redirecting)
    if (path.startsWith('/api')) {
      // Research feature flag protection for API endpoints
      if (path.startsWith('/api/classroom') && !isFeatureEnabled('CLASSROOM_ASSESSMENT')) {
        return NextResponse.json(
          { success: false, message: 'Classroom assessment feature is disabled', data: null },
          { status: 404 }
        );
      }
      if (path.startsWith('/api/personalized') && !isFeatureEnabled('PERSONALIZED_ASSESSMENT')) {
        return NextResponse.json(
          { success: false, message: 'Personalized assessment feature is disabled', data: null },
          { status: 404 }
        );
      }

      // Allow public access ONLY to /api/auth/** and /api/health
      if (path.startsWith('/api/auth') || path === '/api/health') {
        return;
      }
      
      // Protect all other API routes
      if (!token) {
        return NextResponse.json(
          { success: false, message: 'Unauthorized' },
          { status: 401 }
        );
      }
      return;
    }

    if (token) {
      const rawRole = token.role as string;
      const userRole = rawRole?.toUpperCase() as UserRole;
      const userRoleLower = rawRole?.toLowerCase();

      // Redirect root path to their dashboard
      if (path === '/') {
        return NextResponse.redirect(new URL(`/${userRoleLower}`, req.url));
      }

      // Redirect authenticated users away from /login, /register, /forgot-password, and /reset-password
      if (path === '/login' || path === '/register' || path === '/forgot-password' || path === '/reset-password') {
        return NextResponse.redirect(new URL(`/${userRoleLower}`, req.url));
      }

      // Strict role-based route prefix check
      if (path.startsWith('/admin') && userRole !== UserRole.ADMIN) {
        return NextResponse.redirect(new URL(`/${userRoleLower}`, req.url));
      }
      if (path.startsWith('/professor') && userRole !== UserRole.PROFESSOR) {
        return NextResponse.redirect(new URL(`/${userRoleLower}`, req.url));
      }
      if (path.startsWith('/ta') && userRole !== UserRole.TA) {
        return NextResponse.redirect(new URL(`/${userRoleLower}`, req.url));
      }
      if (path.startsWith('/student') && userRole !== UserRole.STUDENT) {
        return NextResponse.redirect(new URL(`/${userRoleLower}`, req.url));
      }

      // Feature flag route protection for research pages
      if (
        (path.startsWith('/professor/classroom') || path.startsWith('/student/classroom')) &&
        !isFeatureEnabled('CLASSROOM_ASSESSMENT')
      ) {
        return NextResponse.redirect(new URL(`/${userRoleLower}`, req.url));
      }
      if (
        (path.startsWith('/professor/personalized') || path.startsWith('/student/personalized')) &&
        !isFeatureEnabled('PERSONALIZED_ASSESSMENT')
      ) {
        return NextResponse.redirect(new URL(`/${userRoleLower}`, req.url));
      }

      // Map routes to their required permissions using RolePermissions/hasPermission
      let requiredPermission: Permission | null = null;
      if (path.startsWith('/admin')) {
        requiredPermission = Permission.MANAGE_USERS;
      } else if (path.startsWith('/professor')) {
        requiredPermission = Permission.CREATE_EXAM;
      } else if (path.startsWith('/ta')) {
        requiredPermission = Permission.GRADE_SCRIPT;
      } else if (path.startsWith('/student')) {
        requiredPermission = Permission.VIEW_OWN_RESULTS;
      }

      // Authorize access using the centralized permissions implementation
      if (requiredPermission && !hasPermission(userRole, requiredPermission)) {
        return NextResponse.redirect(new URL(`/${userRoleLower}`, req.url));
      }
    }
}

export default withAuth(
  proxyMiddleware,
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const path = req.nextUrl.pathname;

        // Allow public routes
        if (
          path.startsWith('/api') ||
          path === '/login' ||
          path === '/register' ||
          path === '/forgot-password' ||
          path === '/reset-password'
        ) {
          return true;
        }

        // Require authentication for all other routes
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
