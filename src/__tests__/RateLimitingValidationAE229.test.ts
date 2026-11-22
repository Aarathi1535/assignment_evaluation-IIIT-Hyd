import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  getClientIdentifier,
  createRateLimitResponse,
  resetRateLimitStore,
  pruneRateLimitStore,
  getRateLimitStoreSize,
  RATE_LIMIT_TIERS,
} from '../lib/rateLimit';
import {
  detectFileTypeByMagicBytes,
  MAX_SINGLE_FILE_SIZE,
  MAX_FILES_PER_BATCH,
  MAX_TOTAL_REQUEST_SIZE,
  MAX_PDF_PAGE_COUNT,
} from '../utils/fileValidation';
import { registerSchema } from '../validations/authValidation';
import { createCourseSchema } from '../validations/courseValidation';
import { POST as registerPOST } from '../app/api/auth/register/route';
import { POST as resetPOST } from '../app/api/auth/reset/route';

describe('AE-229: Rate Limiting and Input Validation Hardening', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  describe('1. Sliding-Window Rate Limiting Engine', () => {
    const testConfig = {
      maxRequests: 3,
      windowMs: 60 * 1000, // 60 seconds
    };

    it('permits requests within configured quota and tracks remaining allowances', () => {
      const now = 1700000000000;
      const key = 'test:user:usr-1';

      const res1 = checkRateLimit(key, testConfig, now);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);
      expect(res1.limit).toBe(3);

      const res2 = checkRateLimit(key, testConfig, now + 1000);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(1);

      const res3 = checkRateLimit(key, testConfig, now + 2000);
      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(0);
    });

    it('rejects requests exceeding quota with 429-ready result and retryAfterSeconds', () => {
      const now = 1700000000000;
      const key = 'test:ip:10.0.0.1';

      // Exhaust quota (3 requests)
      checkRateLimit(key, testConfig, now);
      checkRateLimit(key, testConfig, now + 1000);
      checkRateLimit(key, testConfig, now + 2000);

      // 4th request must be rejected
      const rejected = checkRateLimit(key, testConfig, now + 3000);
      expect(rejected.allowed).toBe(false);
      expect(rejected.remaining).toBe(0);
      expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
      expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(60);

      // Verify HTTP 429 response structure
      const response = createRateLimitResponse(rejected);
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe(String(rejected.retryAfterSeconds));
      expect(response.headers.get('X-RateLimit-Limit')).toBe('3');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(response.headers.get('X-RateLimit-Reset')).toBeDefined();
    });

    it('automatically restores quota when sliding window advances', () => {
      const now = 1700000000000;
      const key = 'test:window-advance';

      // Exhaust quota
      checkRateLimit(key, testConfig, now);
      checkRateLimit(key, testConfig, now + 1000);
      checkRateLimit(key, testConfig, now + 2000);

      // Immediately blocked
      expect(checkRateLimit(key, testConfig, now + 3000).allowed).toBe(false);

      // Advance clock past the 60s window (windowMs = 60,000)
      const afterWindow = now + 65 * 1000;
      const restored = checkRateLimit(key, testConfig, afterWindow);
      expect(restored.allowed).toBe(true);
      expect(restored.remaining).toBe(2);
    });

    it('isolates rate limit buckets across different IPs and users', () => {
      const now = 1700000000000;
      const keyA = 'ip:192.168.1.1';
      const keyB = 'ip:192.168.1.2';

      // Exhaust quota for keyA
      checkRateLimit(keyA, testConfig, now);
      checkRateLimit(keyA, testConfig, now);
      checkRateLimit(keyA, testConfig, now);
      expect(checkRateLimit(keyA, testConfig, now).allowed).toBe(false);

      // keyB must still have full quota
      const resB = checkRateLimit(keyB, testConfig, now);
      expect(resB.allowed).toBe(true);
      expect(resB.remaining).toBe(2);
    });

    it('resolves client identifiers correctly and safely from request headers', () => {
      // Behind reverse proxy: rightmost entry is the proxy-appended upstream client IP
      const mockReqXForwarded = {
        headers: {
          get: (header: string) => (header === 'x-forwarded-for' ? '203.0.113.195, 70.41.3.18' : null),
        },
      };
      expect(getClientIdentifier(mockReqXForwarded)).toBe('ip:70.41.3.18');

      // Edge proxy x-real-ip
      const mockReqXReal = {
        headers: {
          get: (header: string) => (header === 'x-real-ip' ? '198.51.100.22' : null),
        },
      };
      expect(getClientIdentifier(mockReqXReal)).toBe('ip:198.51.100.22');

      // Authenticated user priority
      const mockReqUser = {
        headers: { get: () => null },
      };
      expect(getClientIdentifier(mockReqUser, 'student-42')).toBe('user:student-42');
    });

    it('prunes expired rate limit entries to prevent memory leaks', () => {
      const now = 1700000000000;
      checkRateLimit('key:expire', { maxRequests: 2, windowMs: 1000 }, now);
      expect(getRateLimitStoreSize()).toBe(1);

      // Advance clock past max window and sweep
      pruneRateLimitStore(now + 25 * 60 * 60 * 1000);
      expect(getRateLimitStoreSize()).toBe(0);
    });

    it('verifies predefined tiers match documented security thresholds', () => {
      expect(RATE_LIMIT_TIERS.AUTH.maxRequests).toBe(5);
      expect(RATE_LIMIT_TIERS.AUTH.windowMs).toBe(60000);

      expect(RATE_LIMIT_TIERS.UPLOAD.maxRequests).toBe(10);
      expect(RATE_LIMIT_TIERS.UPLOAD.windowMs).toBe(3600000);

      expect(RATE_LIMIT_TIERS.STUDENT_EXPORT.maxRequests).toBe(5);
      expect(RATE_LIMIT_TIERS.STUDENT_EXPORT.windowMs).toBe(3600000);

      expect(RATE_LIMIT_TIERS.REGRADE_REQUEST.maxRequests).toBe(10);
      expect(RATE_LIMIT_TIERS.REGRADE_REQUEST.windowMs).toBe(86400000);
    });
  });

  describe('2. Magic Byte File Validation (Content Sniffing Protection)', () => {
    it('detects authentic PDF format by magic bytes (%PDF-)', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj', 'utf-8');
      const detected = detectFileTypeByMagicBytes(pdfBuffer);
      expect(detected).toEqual({
        mimeType: 'application/pdf',
        extension: 'pdf',
        category: 'pdf',
      });
    });

    it('detects authentic JPEG format by magic bytes (0xFF 0xD8 0xFF)', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const detected = detectFileTypeByMagicBytes(jpegBuffer);
      expect(detected).toEqual({
        mimeType: 'image/jpeg',
        extension: 'jpg',
        category: 'image',
      });
    });

    it('detects authentic PNG format by magic bytes (8-byte signature)', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const detected = detectFileTypeByMagicBytes(pngBuffer);
      expect(detected).toEqual({
        mimeType: 'image/png',
        extension: 'png',
        category: 'image',
      });
    });

    it('detects authentic WebP format by RIFF + WEBP signatures', () => {
      const webpBuffer = Buffer.alloc(16);
      Buffer.from('RIFF').copy(webpBuffer, 0);
      Buffer.from('WEBP').copy(webpBuffer, 8);
      const detected = detectFileTypeByMagicBytes(webpBuffer);
      expect(detected).toEqual({
        mimeType: 'image/webp',
        extension: 'webp',
        category: 'image',
      });
    });

    it('detects authentic TIFF format by endianness signatures', () => {
      const tiffBufferLE = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]);
      expect(detectFileTypeByMagicBytes(tiffBufferLE)).toEqual({
        mimeType: 'image/tiff',
        extension: 'tiff',
        category: 'image',
      });

      const tiffBufferBE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x08]);
      expect(detectFileTypeByMagicBytes(tiffBufferBE)).toEqual({
        mimeType: 'image/tiff',
        extension: 'tiff',
        category: 'image',
      });
    });

    it('rejects spoofed files (e.g. plain text or executable masked as PDF)', () => {
      const fakePdf = Buffer.from('Hello, I am a malicious shell script pretending to be a PDF!', 'utf-8');
      expect(detectFileTypeByMagicBytes(fakePdf)).toBeNull();

      // Windows executable PE header (MZ)
      const fakeBinary = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      expect(detectFileTypeByMagicBytes(fakeBinary)).toBeNull();
    });

    it('rejects truncated buffers (< 4 bytes)', () => {
      expect(detectFileTypeByMagicBytes(Buffer.from([0x25, 0x50]))).toBeNull();
      expect(detectFileTypeByMagicBytes(Buffer.alloc(0))).toBeNull();
    });
  });

  describe('3. Resource & Batch Boundary Constants', () => {
    it('enforces exact architectural size limits', () => {
      expect(MAX_SINGLE_FILE_SIZE).toBe(50 * 1024 * 1024); // 50MB
      expect(MAX_FILES_PER_BATCH).toBe(20);
      expect(MAX_TOTAL_REQUEST_SIZE).toBe(200 * 1024 * 1024); // 200MB
      expect(MAX_PDF_PAGE_COUNT).toBe(200);
    });
  });

  describe('4. Input Identifier & Schema Validation Injection Defenses', () => {
    it('validates authentic MongoDB ObjectId hex format and rejects injection attempts', () => {
      const validObjectId = new mongoose.Types.ObjectId().toString();
      expect(mongoose.Types.ObjectId.isValid(validObjectId)).toBe(true);

      // Rejects SQL/NoSQL injection payloads
      expect(mongoose.Types.ObjectId.isValid('{"$gt": ""}')).toBe(false);
      expect(mongoose.Types.ObjectId.isValid("1' OR '1'='1")).toBe(false);
      expect(mongoose.Types.ObjectId.isValid('../../etc/passwd')).toBe(false);
      expect(mongoose.Types.ObjectId.isValid('12345')).toBe(false);
    });

    it('validates user registration schema: strictly enforces STUDENT role on public signup', () => {
      const validStudent = {
        name: 'Aarathi Sree',
        email: 'student@iiit.ac.in',
        password: 'securepassword123',
      };
      expect(registerSchema.safeParse(validStudent).success).toBe(true);

      // Prohibits self-registering as ADMIN or PROFESSOR
      const maliciousAdmin = {
        name: 'Attacker Admin',
        email: 'attacker@evil.com',
        password: 'password123',
        role: 'ADMIN',
      };
      const result = registerSchema.safeParse(maliciousAdmin);
      expect(result.success).toBe(false);
    });

    it('validates course creation schema bounds', () => {
      const validCourse = {
        courseCode: 'CS101',
        courseName: 'Introduction to Computer Science',
        semester: '1',
        academicYear: '2026-27',
      };
      const parsed = createCourseSchema.safeParse(validCourse);
      expect(parsed.success).toBe(true);

      // Rejects missing course code or short name
      expect(
        createCourseSchema.safeParse({
          courseCode: '',
          courseName: 'CS',
          semester: '0',
          academicYear: 'invalid',
        }).success
      ).toBe(false);
    });
  });

  describe('5. Real Route Integration: Auth Rate Limiting Enforcement', () => {
    it('enforces 429 Too Many Requests on POST /api/auth/register after quota is exceeded', async () => {
      const testIp = '198.51.100.99';

      // 5 attempts allowed within 1 minute
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost:3000/api/auth/register', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-real-ip': testIp,
          },
          body: JSON.stringify({ email: 'invalid-email' }),
        });
        const res = await registerPOST(req);
        // Returns 400 validation error, not 429
        expect(res.status).toBe(400);
      }

      // 6th attempt must be rejected with 429 Too Many Requests
      const req6 = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-real-ip': testIp,
        },
        body: JSON.stringify({ email: 'invalid-email' }),
      });
      const res6 = await registerPOST(req6);
      expect(res6.status).toBe(429);
      expect(res6.headers.get('Retry-After')).toBeDefined();
      expect(res6.headers.get('X-RateLimit-Limit')).toBe('5');
      expect(res6.headers.get('X-RateLimit-Remaining')).toBe('0');
      const body6 = await res6.json();
      expect(body6.message).toMatch(/too many.*attempts/i);
    });

    it('enforces 429 Too Many Requests on POST /api/auth/reset after quota is exceeded', async () => {
      const testIp = '198.51.100.100';

      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost:3000/api/auth/reset', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-real-ip': testIp,
          },
          body: JSON.stringify({ email: 'test@example.com' }),
        });
        const res = await resetPOST(req);
        expect(res.status).toBe(200);
      }

      // 6th attempt rejected with 429
      const req6 = new NextRequest('http://localhost:3000/api/auth/reset', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-real-ip': testIp,
        },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
      const res6 = await resetPOST(req6);
      expect(res6.status).toBe(429);
      expect(res6.headers.get('Retry-After')).toBeDefined();
    });
  });
});
