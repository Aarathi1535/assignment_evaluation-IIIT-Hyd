import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformToken, TokenVerificationError } from './tokens';
import { PlatformUserClaims, ServiceAudience, PlatformRole } from './types';
import { hasPermission } from './permissions';

export interface AuthMiddlewareResult {
  authorized: boolean;
  claims?: PlatformUserClaims;
  response?: NextResponse;
}

/**
 * Validates platform authorization header or cookie for Next.js API route handlers.
 */
export function authenticatePlatformToken(
  req: NextRequest,
  expectedAudience?: ServiceAudience | string
): AuthMiddlewareResult {
  const authHeader = req.headers.get('authorization');
  let token: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers.get('x-platform-token')) {
    token = req.headers.get('x-platform-token')!.trim();
  } else if (req.cookies.get('platform_token')) {
    token = req.cookies.get('platform_token')!.value;
  }

  if (!token) {
    return {
      authorized: false,
      response: NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/missing-token',
          title: 'Unauthorized',
          status: 401,
          detail: 'Authentication token is required to access this resource.',
        },
        { status: 401 }
      ),
    };
  }

  try {
    const claims = verifyPlatformToken(token, { expectedAudience });
    return {
      authorized: true,
      claims,
    };
  } catch (err: unknown) {
    const isVerificationError = err instanceof TokenVerificationError;
    const statusCode = isVerificationError ? (err as TokenVerificationError).statusCode : 401;
    const code = isVerificationError ? (err as TokenVerificationError).code : 'INVALID_TOKEN';

    return {
      authorized: false,
      response: NextResponse.json(
        {
          type: `https://errors.iiit.ac.in/auth/${code.toLowerCase().replace(/_/g, '-')}`,
          title: statusCode === 403 ? 'Forbidden' : 'Unauthorized',
          status: statusCode,
          detail: (err as Error).message,
        },
        { status: statusCode }
      ),
    };
  }
}

/**
 * Requires one or more allowed roles.
 */
export function requirePlatformRole(
  claims: PlatformUserClaims,
  allowedRoles: PlatformRole[]
): AuthMiddlewareResult {
  if (!allowedRoles.includes(claims.role)) {
    return {
      authorized: false,
      response: NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/insufficient-role',
          title: 'Forbidden',
          status: 403,
          detail: `User with role '${claims.role}' does not have sufficient role privileges. Required: [${allowedRoles.join(', ')}]`,
        },
        { status: 403 }
      ),
    };
  }

  return { authorized: true, claims };
}

/**
 * Requires a specific permission claim.
 */
export function requirePlatformPermission(
  claims: PlatformUserClaims,
  permission: string
): AuthMiddlewareResult {
  if (!hasPermission(claims.role, permission) && !claims.permissions?.includes(permission)) {
    return {
      authorized: false,
      response: NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/permission-denied',
          title: 'Forbidden',
          status: 403,
          detail: `Permission '${permission}' is required to perform this action.`,
        },
        { status: 403 }
      ),
    };
  }

  return { authorized: true, claims };
}
