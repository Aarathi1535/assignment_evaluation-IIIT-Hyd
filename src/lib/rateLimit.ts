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

// Maximum number of distinct tracking keys to hold in memory
export const MAX_RATE_LIMIT_ENTRIES = 10_000;

// In-memory sliding window storage: key -> timestamps
const rateLimitStore = new Map<string, number[]>();

/**
 * Prunes expired timestamps across the rate limit store to prevent memory leaks.
 */
export function pruneRateLimitStore(now: number = Date.now()): void {
  for (const [key, timestamps] of rateLimitStore.entries()) {
    // Find highest window bound among tiers or default 24h
    const maxWindow = 24 * 60 * 60 * 1000;
    const windowStart = now - maxWindow;
    const active = timestamps.filter((ts) => ts > windowStart);
    if (active.length === 0) {
      rateLimitStore.delete(key);
    } else if (active.length < timestamps.length) {
      rateLimitStore.set(key, active);
    }
  }
}

/**
 * Returns the current count of active rate limit buckets.
 */
export function getRateLimitStoreSize(): number {
  return rateLimitStore.size;
}

/**
 * Checks if a request is permitted under the sliding-window rate limit policy.
 *
 * @param key Unique key for the rate limit subject (e.g. 'auth:register:ip:192.168.1.1' or 'export:user:usr-123')
 * @param config Max requests and window duration in milliseconds
 * @param now Optional timestamp override for deterministic testing
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): RateLimitResult {
  // When running in test environment, allow requests unless rate limit testing is explicitly enabled
  if (process.env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT_TEST !== 'true') {
    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests,
      resetTime: now + config.windowMs,
    };
  }

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

  // Cap total entries to prevent unbounded memory growth
  if (rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES && !rateLimitStore.has(key)) {
    pruneRateLimitStore(now);
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
 *
 * When behind a reverse proxy (e.g. Cloud Run, Cloud Load Balancing, Nginx):
 * - `x-real-ip` is authoritative from the edge proxy and cannot be forged by the client.
 * - In `x-forwarded-for`, the client controls the initial entries. Reverse proxies append
 *   the true upstream peer IP to the rightmost side of the list. We use the rightmost IP
 *   or x-real-ip to prevent client spoofing.
 */
export function getClientIdentifier(
  req: { headers: { get: (name: string) => string | null } },
  userId?: string
): string {
  if (userId && userId.trim()) {
    return `user:${userId.trim()}`;
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    return `ip:${realIp.trim()}`;
  }

  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const parts = forwardedFor
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    // Prefer the last entry appended by the trusted reverse proxy to defend against client spoofing
    if (parts.length > 0) {
      const trustedClientIp = parts[parts.length - 1];
      if (trustedClientIp) {
        return `ip:${trustedClientIp}`;
      }
    }
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
