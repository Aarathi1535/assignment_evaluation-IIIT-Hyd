import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  signPlatformToken,
  verifyPlatformToken,
  revokeTokenJti,
  ServiceAuthManager,
} from '@cvit/auth';
import { connectIdentityDB } from '../lib/identityDb';
import IdentityUser from '../models/identity/IdentityUser';
import UserFederationLink from '../models/identity/UserFederationLink';
import { POST as registerRoute } from '../app/api/v1/identity/auth/register/route';
import { POST as loginRoute } from '../app/api/v1/identity/auth/login/route';
import { GET as jwksRoute } from '../app/.well-known/jwks.json/route';
import { POST as federationLinkRoute } from '../app/api/v1/identity/federation/link/route';
import { POST as federationUnlinkRoute } from '../app/api/v1/identity/federation/unlink/route';

describe('Shared Identity & Auth Foundation (@cvit/auth)', () => {
  beforeEach(async () => {
    await connectIdentityDB();
    await IdentityUser.deleteMany({});
    await UserFederationLink.deleteMany({});
  });

  describe('1. Cryptographic Asymmetric RS256 Signing & Claims', () => {
    it('signs and verifies an RS256 token with required claims', () => {
      const token = signPlatformToken({
        sub: 'user-12345',
        role: 'PROFESSOR',
        email: 'prof@iiit.ac.in',
        name: 'Prof. Jawahar',
        audience: 'classroom-service',
        expiresInSeconds: 300,
      });

      const claims = verifyPlatformToken(token, { expectedAudience: 'classroom-service' });
      expect(claims.sub).toBe('user-12345');
      expect(claims.role).toBe('PROFESSOR');
      expect(claims.email).toBe('prof@iiit.ac.in');
      expect(claims.aud).toBe('classroom-service');
      expect(claims.jti).toBeDefined();
      expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('rejects token when audience does not match expected target service (403 Forbidden)', () => {
      const token = signPlatformToken({
        sub: 'user-12345',
        role: 'STUDENT',
        email: 'student@iiit.ac.in',
        name: 'Student',
        audience: 'classroom-service',
      });

      expect(() => {
        verifyPlatformToken(token, { expectedAudience: 'practice-service' });
      }).toThrowError(/Audience mismatch/);
    });

    it('rejects revoked tokens via jti blacklist', () => {
      const token = signPlatformToken({
        sub: 'user-12345',
        role: 'STUDENT',
        email: 'student@iiit.ac.in',
        name: 'Student',
        audience: 'evaluation-service',
      });

      const decoded = verifyPlatformToken(token);
      revokeTokenJti(decoded.jti);

      expect(() => {
        verifyPlatformToken(token);
      }).toThrowError(/Token has been revoked/);
    });

    it('publishes valid RFC 7517 JWKS document with RS256 key', async () => {
      const res = await jwksRoute();
      expect(res.status).toBe(200);
      const jwks = await res.json();
      expect(jwks.keys).toBeDefined();
      expect(jwks.keys.length).toBeGreaterThan(0);
      expect(jwks.keys[0].kty).toBe('RSA');
      expect(jwks.keys[0].alg).toBe('RS256');
      expect(jwks.keys[0].use).toBe('sig');
    });
  });

  describe('2. Public Registration & Role Hardening', () => {
    it('strictly assigns STUDENT role for public registration even if PROFESSOR is requested without admin invite code', async () => {
      const req = new NextRequest('http://localhost/api/v1/identity/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Hacker',
          email: 'hacker@example.com',
          password: 'password123',
          role: 'PROFESSOR',
        }),
      });

      const res = await registerRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.type).toContain('role-elevation-denied');
    });

    it('successfully registers PROFESSOR when valid admin invite code is supplied', async () => {
      const req = new NextRequest('http://localhost/api/v1/identity/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Prof. Ramesh',
          email: 'ramesh@iiit.ac.in',
          password: 'facultyPassword123',
          role: 'PROFESSOR',
          department: 'CSE',
          adminInviteCode: 'iiit-faculty-invite-2026',
        }),
      });

      const res = await registerRoute(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.role).toBe('PROFESSOR');
      expect(json.data.email).toBe('ramesh@iiit.ac.in');
    });
  });

  describe('3. Login, Lockout & Token Issuance', () => {
    it('authenticates valid credentials and issues signed token with cookie', async () => {
      await IdentityUser.create({
        name: 'Aarathi',
        email: 'aarathi@iiit.ac.in',
        password: 'studentPassword123',
        role: 'STUDENT',
        isActive: true,
      });

      const req = new NextRequest('http://localhost/api/v1/identity/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'aarathi@iiit.ac.in',
          password: 'studentPassword123',
          audience: 'evaluation-service',
        }),
      });

      const res = await loginRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.token).toBeDefined();

      const verified = verifyPlatformToken(json.data.token, { expectedAudience: 'evaluation-service' });
      expect(verified.email).toBe('aarathi@iiit.ac.in');
      expect(verified.role).toBe('STUDENT');
    });

    it('enforces lockout after 5 consecutive failed login attempts', async () => {
      await IdentityUser.create({
        name: 'Target User',
        email: 'target@iiit.ac.in',
        password: 'correctPassword123',
        role: 'STUDENT',
        isActive: true,
      });

      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/v1/identity/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'target@iiit.ac.in',
            password: 'wrongPassword',
          }),
        });
        const res = await loginRoute(req);
        expect(res.status).toBe(401);
      }

      // 6th attempt must be locked out with 429
      const req6 = new NextRequest('http://localhost/api/v1/identity/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'target@iiit.ac.in',
          password: 'wrongPassword',
        }),
      });
      const res6 = await loginRoute(req6);
      expect(res6.status).toBe(429);
    });
  });

  describe('4. Explicit Two-Party Account Linking & Unlinking', () => {
    it('executes two-party state/nonce round-trip linking and supports self-service unlinking', async () => {
      const user = await IdentityUser.create({
        name: 'Linked Student',
        email: 'linked@iiit.ac.in',
        password: 'password123',
        role: 'STUDENT',
        isActive: true,
      });

      const platformToken = signPlatformToken({
        sub: user._id.toString(),
        role: 'STUDENT',
        email: user.email,
        name: user.name,
        audience: 'identity-service',
      });

      // 1. Initiate linking
      const initReq = new NextRequest('http://localhost/api/v1/identity/federation/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${platformToken}`,
        },
        body: JSON.stringify({
          action: 'initiate',
          targetProduct: 'CLASSROOM',
          localUserId: 'class-user-999',
        }),
      });

      const initRes = await federationLinkRoute(initReq);
      expect(initRes.status).toBe(200);
      const initJson = await initRes.json();
      expect(initJson.data.state).toBeDefined();
      expect(initJson.data.nonce).toBeDefined();

      // 2. Complete linking with matching state and nonce
      const completeReq = new NextRequest('http://localhost/api/v1/identity/federation/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${platformToken}`,
        },
        body: JSON.stringify({
          action: 'complete',
          targetProduct: 'CLASSROOM',
          localUserId: 'class-user-999',
          state: initJson.data.state,
          nonce: initJson.data.nonce,
        }),
      });

      const completeRes = await federationLinkRoute(completeReq);
      expect(completeRes.status).toBe(200);

      // Verify link in DB
      const dbLink = await UserFederationLink.findOne({
        platformUserId: user._id,
        product: 'CLASSROOM',
      });
      expect(dbLink).not.toBeNull();
      expect(dbLink?.localUserId).toBe('class-user-999');

      // 3. Self-service unlinking
      const unlinkReq = new NextRequest('http://localhost/api/v1/identity/federation/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${platformToken}`,
        },
        body: JSON.stringify({
          targetProduct: 'CLASSROOM',
        }),
      });

      const unlinkRes = await federationUnlinkRoute(unlinkReq);
      expect(unlinkRes.status).toBe(200);

      const dbLinkAfter = await UserFederationLink.findOne({
        platformUserId: user._id,
        product: 'CLASSROOM',
      });
      expect(dbLinkAfter).toBeNull();
    });
  });

  describe('5. Machine Client Credentials', () => {
    it('generates, hashes, and verifies machine client credentials and scopes', () => {
      const { clientId, clientSecret, credentialRecord } = ServiceAuthManager.generateClientCredentials({
        name: 'Evaluation Backend Worker',
        ownerId: 'admin-1',
        scopes: [
          { service: 'evaluation-service', actions: ['read', 'write'] },
          { service: 'classroom-service', actions: ['read'] },
        ],
      });

      expect(clientId.startsWith('client_')).toBe(true);
      expect(clientSecret.startsWith('sec_')).toBe(true);
      expect(credentialRecord.clientSecretHash).not.toBe(clientSecret);

      const isValid = ServiceAuthManager.verifyCredentials(clientSecret, credentialRecord);
      expect(isValid).toBe(true);

      const isBadValid = ServiceAuthManager.verifyCredentials('wrong_secret', credentialRecord);
      expect(isBadValid).toBe(false);

      expect(ServiceAuthManager.hasScope(credentialRecord, 'evaluation-service', 'write')).toBe(true);
      expect(ServiceAuthManager.hasScope(credentialRecord, 'classroom-service', 'write')).toBe(false);
      expect(ServiceAuthManager.hasScope(credentialRecord, 'classroom-service', 'read')).toBe(true);
    });
  });
});
