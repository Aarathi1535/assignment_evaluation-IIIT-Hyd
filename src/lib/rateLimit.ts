import { NextResponse } from 'next/server';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number; // Unix timestamp in milliseconds
  retryAfterSeconds?: number;
}

// Predefined rate limiting tiers
export const RATE_LIMIT_TIERS = {
  // Authentication endpoints: 5 attempts per minute per IP to defend against brute force
  AUTH: {
    maxRequests: 5,
    windowMs: 60 * 1000, // 1 minute
  },
  // Batch scan uploads: 10 uploads per hour per instructor/IP to prevent storage flooding
  UPLOAD: {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  // Student PDF exports: 5 exports per hour per student to prevent canvas render exhaustion
  STUDENT_EXPORT: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  // Regrade requests: 10 requests per 24 hours per student to prevent queue spamming
  REGRADE_REQUEST: {
    maxRequests: 10,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
  },
} as const;

// In-memory sliding window storage: key -> timestamps
const rateLimitStore = new Map<string, number[]>();

/**
 * Checks if a request is permitted under the sliding-window rate limit policy.
 *
 * @param key Unique key for the rate limit subject (e.g. 'auth:ip:192.168.1.1' or 'export:user:usr-123')
 * @param config Max requests and window duration in milliseconds
 * @param now Optional timestamp override for deterministic testing
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): RateLimitResult {
  const { maxRequests, windowMs } = config;
  const windowStart = now - windowMs;

  const history = rateLimitStore.get(key) || [];
  // Prune timestamps older than current window
  const activeTimestamps = history.filter((ts) => ts > windowStart);

  if (activeTimestamps.length >= maxRequests) {
    const oldestInWindow = activeTimestamps[0];
    const resetTime = oldestInWindow + windowMs;
    const retryAfterMs = Math.max(0, resetTime - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

    // Save pruned history without adding new entry
    rateLimitStore.set(key, activeTimestamps);

    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      resetTime,
      retryAfterSeconds,
    };
  }

  // Record current request
  activeTimestamps.push(now);
  rateLimitStore.set(key, activeTimestamps);

  const resetTime = activeTimestamps[0] + windowMs;
  const remaining = Math.max(0, maxRequests - activeTimestamps.length);

  return {
    allowed: true,
    limit: maxRequests,
    remaining,
    resetTime,
  };
}

/**
 * Extracts a sanitized client identifier from request headers or user context.
 */
export function getClientIdentifier(
  req: { headers: { get: (name: string) => string | null } },
  userId?: string
): string {
  if (userId && userId.trim()) {
    return `user:${userId.trim()}`;
  }

  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const clientIp = forwardedFor.split(',')[0].trim();
    if (clientIp) return `ip:${clientIp}`;
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    return `ip:${realIp.trim()}`;
  }

  return 'ip:127.0.0.1';
}

/**
 * Creates standard HTTP 429 Too Many Requests response with RFC-compliant headers.
 */
export function createRateLimitResponse(
  result: RateLimitResult,
  message = 'Too many requests. Please try again later.'
): NextResponse {
  const retryAfter = result.retryAfterSeconds ?? 60;
  const headers = new Headers({
    'Retry-After': String(retryAfter),
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000)),
    'Cache-Control': 'no-store, private',
  });

  return NextResponse.json(
    {
      success: false,
      message,
      data: {
        retryAfterSeconds: retryAfter,
      },
    },
    {
      status: 429,
      headers,
    }
  );
}

/**
 * Clears the in-memory rate limit store. Useful for testing and isolated benchmarks.
 */
export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}
