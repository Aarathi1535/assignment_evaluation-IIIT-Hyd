import { withAuth, NextRequestWithAuth } from 'next-auth/middleware';
import { JWT } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { hasPermission, Permission, UserRole } from './constants/permissions';
import { isLearningModuleServerEnabled } from './config/env';

/**
 * Matches learning module route families:
 * - /api/learning/*
 * - /professor/learning*
 * - /student/learning*
 *
 * Avoids matching unrelated routes like /api/learning-center or /professor/learning-analytics.
 */
export function isLearningRoute(path: string): boolean {
  return (
    path === '/api/learning' ||
    path.startsWith('/api/learning/') ||
    path === '/professor/learning' ||
    path.startsWith('/professor/learning/') ||
    path === '/student/learning' ||
    path.startsWith('/student/learning/')
  );
}

export function proxyMiddleware(req: NextRequestWithAuth) {
  const token = req.nextauth?.token;
  const path = req.nextUrl.pathname;

  // Feature flag security guard: generic 404 when server flag is off
  if (isLearningRoute(path) && !isLearningModuleServerEnabled()) {
    return NextResponse.json(
      { success: false, message: 'Not Found', data: null },
      { status: 404 }
    );
  }

  // API route protection (JSON 401 instead of redirecting)
  if (path.startsWith('/api')) {
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

export const proxyAuthOptions = {
  callbacks: {
    authorized: ({ token, req }: { token: JWT | null; req: NextRequest }) => {
      const path = req.nextUrl.pathname;

      // When Learning Module is disabled, permit request to reach proxyMiddleware
      // so it returns a generic 404 rather than redirecting to login (avoiding information disclosure)
      if (isLearningRoute(path) && !isLearningModuleServerEnabled()) {
        return true;
      }

      // Allow public routes
      if (
        path.startsWith('/api') ||
        (process.env.NODE_ENV !== 'production' && process.env.AE174_PROFILE_ONLY === 'true' && path === '/ae174-profile') ||
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
};

export default withAuth(proxyMiddleware, proxyAuthOptions);

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
