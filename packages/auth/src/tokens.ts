import crypto from 'crypto';
import { PlatformUserClaims, ServiceAudience, PlatformRole } from './types';
import { KeyManager } from './jwks';

export interface SignTokenOptions {
  sub: string;
  role: PlatformRole;
  email: string;
  name: string;
  audience: ServiceAudience | string;
  expiresInSeconds?: number; // Default 900 (15 min)
  courseIds?: string[];
  permissions?: string[];
  issuer?: string;
}

export interface VerifyTokenOptions {
  expectedAudience?: ServiceAudience | string;
  expectedIssuer?: string;
  publicKeyPem?: string;
}

export class TokenVerificationError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code: string = 'INVALID_TOKEN', statusCode: number = 401) {
    super(message);
    this.name = 'TokenVerificationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// In-memory revocation set for testing and immediate invalidation
const revokedJtis = new Set<string>();

export function revokeTokenJti(jti: string): void {
  revokedJtis.add(jti);
}

export function isTokenJtiRevoked(jti: string): boolean {
  return revokedJtis.has(jti);
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Signs an RS256 JWT using the platform private key.
 */
export function signPlatformToken(options: SignTokenOptions): string {
  const { privateKey, kid } = KeyManager.ensureKeyPair();
  const issuer = options.issuer || process.env.PLATFORM_ISSUER || 'https://auth.iiit.ac.in';
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (options.expiresInSeconds ?? 900); // 15 mins default
  const jti = crypto.randomUUID();

  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  };

  const payload: PlatformUserClaims = {
    sub: options.sub,
    iss: issuer,
    aud: options.audience,
    role: options.role,
    email: options.email,
    name: options.name,
    exp,
    iat: now,
    jti,
    courseIds: options.courseIds || [],
    permissions: options.permissions || [],
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${signingInput}.${signature}`;
}

/**
 * Verifies an RS256 JWT using the platform public key, enforcing audience and expiration.
 */
export function verifyPlatformToken(token: string, options: VerifyTokenOptions = {}): PlatformUserClaims {
  if (!token || typeof token !== 'string') {
    throw new TokenVerificationError('Token is missing or not a string', 'TOKEN_MISSING');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenVerificationError('Invalid token format', 'MALFORMED_TOKEN');
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  let header: { alg?: string; kid?: string };
  let payload: PlatformUserClaims;

  try {
    header = JSON.parse(base64UrlDecode(headerEncoded));
    payload = JSON.parse(base64UrlDecode(payloadEncoded));
  } catch {
    throw new TokenVerificationError('Could not decode token header or payload', 'MALFORMED_TOKEN');
  }

  if (header.alg !== 'RS256') {
    throw new TokenVerificationError(`Unsupported token algorithm: ${header.alg}`, 'UNSUPPORTED_ALGORITHM');
  }

  // Cryptographic signature check
  const publicKey = options.publicKeyPem || KeyManager.getPublicKeyPem();
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();

  let signatureBase64 = signatureEncoded.replace(/-/g, '+').replace(/_/g, '/');
  while (signatureBase64.length % 4) {
    signatureBase64 += '=';
  }

  const isValid = verifier.verify(publicKey, signatureBase64, 'base64');
  if (!isValid) {
    throw new TokenVerificationError('Token signature verification failed', 'INVALID_SIGNATURE');
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new TokenVerificationError('Token has expired', 'TOKEN_EXPIRED');
  }

  // Check revocation
  if (payload.jti && isTokenJtiRevoked(payload.jti)) {
    throw new TokenVerificationError('Token has been revoked', 'TOKEN_REVOKED');
  }

  // Check audience match
  if (options.expectedAudience && payload.aud !== options.expectedAudience) {
    throw new TokenVerificationError(
      `Audience mismatch: expected '${options.expectedAudience}' but token is issued for '${payload.aud}'`,
      'AUDIENCE_MISMATCH',
      403 // Forbidden: token was issued for a different service
    );
  }

  // Check issuer match
  if (options.expectedIssuer && payload.iss !== options.expectedIssuer) {
    throw new TokenVerificationError(
      `Issuer mismatch: expected '${options.expectedIssuer}' but got '${payload.iss}'`,
      'ISSUER_MISMATCH',
      403
    );
  }

  return payload;
}
