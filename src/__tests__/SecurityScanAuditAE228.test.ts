import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { validateEnv, isStudentResultsEnabled } from '../config/env';
import { sanitizeDisplayFilename } from '../utils/fileValidation';
import { sanitizeFailureReason } from '../validations/ingestionValidation';
import { sanitizeSpreadsheetCell } from '../lib/gradeExport';
import { sanitizeAuditFeedback } from '../lib/audit';

describe('AE-228: Security Scan, Dependency Audit, and Sanitization Verification', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Production Dependency Versions & Vulnerability Remediation', () => {
    it('verifies core production dependencies meet non-vulnerable version thresholds', () => {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      // Next.js: RCE advisories fixed in >= 16.4.5
      expect(pkg.dependencies.next).toMatch(/(?:\^|~)?16\.[4-9]\.\d+/);

      // Mongoose: Prototype pollution / countDocuments filter injection fixed in >= 9.12.0
      expect(pkg.dependencies.mongoose).toMatch(/(?:\^|~)?9\.(?:1[2-9]|[2-9]\d)\.\d+/);

      // Zod: Collection memory exhaustion fixed in >= 4.6.6
      expect(pkg.dependencies.zod).toMatch(/(?:\^|~)?4\.(?:[6-9]|[1-9]\d)\.\d+/);

      // @google-cloud/storage: fast-xml-parser upgrade in >= 7.22.0
      expect(pkg.dependencies['@google-cloud/storage']).toMatch(/(?:\^|~)?7\.(?:2[2-9]|[3-9]\d)\.\d+/);

      // Overrides for transitive dependencies
      expect(pkg.overrides).toBeDefined();
      expect(pkg.overrides['fast-uri']).toBeDefined();
      expect(pkg.overrides['source-map-js']).toBeDefined();
      expect(pkg.overrides['uuid']).toBeDefined();
    });
  });

  describe('2. Environment Variable Schema Validation (src/config/env.ts)', () => {
    it('validates successfully when all required environment variables are set', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017/test_db';
      process.env.NEXTAUTH_SECRET = 'ci-test-secret';
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'audit-hmac-secret-key-32-chars-long!';
      process.env.ORIGINAL_STORAGE_KEY_ID = 'v1';
      process.env.STUDENT_RESULTS_ENABLED = 'true';

      const config = validateEnv();
      expect(config.MONGODB_URI).toBe('mongodb://localhost:27017/test_db');
      expect(config.NEXTAUTH_SECRET).toBe('ci-test-secret');
      expect(config.NEXTAUTH_URL).toBe('http://localhost:3000');
      expect(config.ORIGINAL_STORAGE_HMAC_SECRET).toBe('audit-hmac-secret-key-32-chars-long!');
      expect(isStudentResultsEnabled()).toBe(true);
    });

    it('throws explicit validation error when MONGODB_URI is missing or empty', () => {
      delete process.env.MONGODB_URI;
      process.env.NEXTAUTH_SECRET = 'secret';
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'secret';

      expect(() => validateEnv()).toThrow(/Invalid environment variables: MONGODB_URI/i);
    });

    it('throws explicit validation error when NEXTAUTH_SECRET is missing', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017/test_db';
      delete process.env.NEXTAUTH_SECRET;
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'secret';

      expect(() => validateEnv()).toThrow(/Invalid environment variables: NEXTAUTH_SECRET/i);
    });

    it('throws explicit validation error when ORIGINAL_STORAGE_HMAC_SECRET is missing', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017/test_db';
      process.env.NEXTAUTH_SECRET = 'secret';
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      delete process.env.ORIGINAL_STORAGE_HMAC_SECRET;

      expect(() => validateEnv()).toThrow(/Invalid environment variables: ORIGINAL_STORAGE_HMAC_SECRET/i);
    });
  });

  describe('3. Git Boundary & Repository Credential Cleanliness', () => {
    it('asserts zero unencrypted private keys in production source code (src/)', () => {
      const gitFilesOutput = execSync('git ls-files src/', { encoding: 'utf-8' });
      const files = gitFilesOutput
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f && !f.startsWith('src/__tests__/'));

      const privateKeyRegex = /-----BEGIN [A-Z ]+ PRIVATE KEY-----/;
      const detectedViolations: string[] = [];

      for (const relativePath of files) {
        if (!fs.existsSync(relativePath)) continue;
        const stat = fs.statSync(relativePath);
        if (stat.isDirectory()) continue;
        if (/\.(png|jpg|jpeg|webp|pdf|ico|woff|woff2|ttf|eot)$/i.test(relativePath)) continue;

        const content = fs.readFileSync(relativePath, 'utf-8');
        if (privateKeyRegex.test(content)) {
          detectedViolations.push(relativePath);
        }
      }

      expect(detectedViolations).toEqual([]);
    });

    it('verifies .gitignore strictly blocks environment files and key certificates', () => {
      const gitignorePath = path.join(process.cwd(), '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const content = fs.readFileSync(gitignorePath, 'utf-8');

      expect(content).toMatch(/\.env\*/);
      expect(content).toMatch(/\*\.pem/);

      const trackedEnvFiles = execSync('git ls-files "*.env*"', { encoding: 'utf-8' })
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);

      // Only .env.example templates are permitted in version control
      for (const envFile of trackedEnvFiles) {
        expect(envFile).toMatch(/\.env\.example$/);
      }
    });
  });

  describe('4. Real Production Data Sanitizers', () => {
    it('sanitizes path traversal and control characters from display filenames', () => {
      expect(sanitizeDisplayFilename('../../../etc/passwd')).toBe('passwd');
      expect(sanitizeDisplayFilename('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe');
      expect(sanitizeDisplayFilename('exam\x00sheet.pdf')).toBe('examsheet.pdf');
    });

    it('sanitizes stack traces from ingestion failure reasons', () => {
      const rawError = 'Image processing failed\n    at /usr/src/app/node_modules/pdfjs:10:2\n    at processTicksAndRejections';
      const sanitized = sanitizeFailureReason(rawError);
      expect(sanitized).toBe('Image processing failed');
    });

    it('neutralizes CSV formula injection characters in spreadsheet exports', () => {
      expect(sanitizeSpreadsheetCell('=SUM(A1:B10)')).toBe("'=SUM(A1:B10)");
      expect(sanitizeSpreadsheetCell('+cmd|/C')).toBe("'+cmd|/C");
      expect(sanitizeSpreadsheetCell('-100')).toBe("'-100");
      expect(sanitizeSpreadsheetCell('@payload')).toBe("'@payload");
      expect(sanitizeSpreadsheetCell('Normal Student')).toBe('Normal Student');
    });

    it('safely handles circular references and truncates oversized text in audit feedback', () => {
      const cyclicObj: Record<string, unknown> = { name: 'Root' };
      cyclicObj.self = cyclicObj;

      const sanitizedCyclic = sanitizeAuditFeedback(cyclicObj) as Record<string, unknown>;
      expect(sanitizedCyclic.name).toBe('Root');
      expect(sanitizedCyclic.self).toBeUndefined();

      const oversizedComment = 'A'.repeat(3000);
      const sanitizedComment = sanitizeAuditFeedback({ comment: oversizedComment }) as { comment: string };
      expect(sanitizedComment.comment.length).toBeLessThanOrEqual(2000);
      expect(sanitizedComment.comment).toContain('... [TRUNCATED]');
    });
  });
});
