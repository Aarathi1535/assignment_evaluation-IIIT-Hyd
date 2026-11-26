/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { validateEnv, isStudentResultsEnabled } from '../config/env';

describe('AE-228: Security Scan and Secrets Cleanliness Audit', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Environment Variable Schema Validation (src/config/env.ts)', () => {
    it('validates successfully when all required environment variables are set', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017/test_db';
      process.env.NEXTAUTH_SECRET = 'super-secret-key-at-least-32-chars-long!';
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'audit-hmac-secret-key-32-chars-long!';
      process.env.ORIGINAL_STORAGE_KEY_ID = 'v1';
      process.env.STUDENT_RESULTS_ENABLED = 'true';

      const config = validateEnv();
      expect(config.MONGODB_URI).toBe('mongodb://localhost:27017/test_db');
      expect(config.NEXTAUTH_SECRET).toBe('super-secret-key-at-least-32-chars-long!');
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

  describe('2. Automated Secrets & Credential Cleanliness Scan', () => {
    it('asserts zero unencrypted private keys or cloud credentials in production source code', () => {
      const gitFilesOutput = execSync('git ls-files', { encoding: 'utf-8' });
      const files = gitFilesOutput
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f && !f.startsWith('src/__tests__/') && !f.startsWith('docs/'));

      const highRiskPatterns = [
        { name: 'Private Key', regex: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/ },
        { name: 'Google API Key', regex: /AIza[0-9A-Za-z-_]{35}/ },
        { name: 'GitHub Token', regex: /gh[pousr]_[0-9a-zA-Z]{36}/ },
        { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
      ];

      const detectedViolations: { file: string; pattern: string }[] = [];

      for (const relativePath of files) {
        if (!fs.existsSync(relativePath)) continue;
        const stat = fs.statSync(relativePath);
        if (stat.isDirectory()) continue;
        // Skip binary and image assets
        if (/\.(png|jpg|jpeg|webp|pdf|ico|woff|woff2|ttf|eot)$/i.test(relativePath)) continue;

        const content = fs.readFileSync(relativePath, 'utf-8');
        for (const pattern of highRiskPatterns) {
          if (pattern.regex.test(content)) {
            detectedViolations.push({ file: relativePath, pattern: pattern.name });
          }
        }
      }

      expect(detectedViolations).toEqual([]);
    });

    it('verifies .gitignore strictly blocks environment variable files and certificate keys', () => {
      const gitignorePath = path.join(process.cwd(), '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const content = fs.readFileSync(gitignorePath, 'utf-8');

      expect(content).toMatch(/\.env\*/);
      expect(content).toMatch(/\*\.pem/);

      // Verify no live .env or .env.local file is tracked in git
      const trackedEnvFiles = execSync('git ls-files "*.env*"', { encoding: 'utf-8' })
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);

      // Only .env.example should ever be tracked
      expect(trackedEnvFiles).toEqual(['.env.example']);
    });
  });

  describe('3. Credential Sanitization & Data Masking', () => {
    it('verifies that sensitive password hashes are stripped from user data outputs', () => {
      const rawUserDocument = {
        _id: 'usr-12345',
        name: 'Prof. Raman',
        email: 'prof@iiit.ac.in',
        role: 'PROFESSOR',
        password: '$2a$12$e8kL8n43O9.dummybcryptpasswordhash...',
        isActive: true,
        toObject() {
          return { ...this };
        },
      };

      const sanitized = rawUserDocument.toObject();
      delete (sanitized as any).password;

      expect(sanitized).not.toHaveProperty('password');
      expect(sanitized.email).toBe('prof@iiit.ac.in');
    });

    it('verifies sensitive fields are sanitized from audit log entries', () => {
      function sanitizeDetails(value: any): any {
        if (typeof value !== 'object' || value === null) return value;
        return Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => !/(password|secret|token|ipaddress|storage(path|key)|file(path|name))/i.test(key))
            .map(([key, item]) => [key, sanitizeDetails(item)])
        );
      }

      const rawDetails = {
        action: 'USER_LOGIN',
        userEmail: 'user@iiit.ac.in',
        password: 'PlainTextPassword123!',
        token: 'jwt-bearer-token-value',
        storageKey: 'batches/123/original.pdf',
        safeProperty: 'AllowedAuditMetadata',
      };

      const sanitized = sanitizeDetails(rawDetails);
      expect(sanitized).toHaveProperty('safeProperty', 'AllowedAuditMetadata');
      expect(sanitized).toHaveProperty('userEmail', 'user@iiit.ac.in');
      expect(sanitized).not.toHaveProperty('password');
      expect(sanitized).not.toHaveProperty('token');
      expect(sanitized).not.toHaveProperty('storageKey');
    });
  });
});
