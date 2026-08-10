import crypto from 'crypto';
import { IBindingMetadata } from '../models/Batch';

export interface HmacSealResult {
    hmac: string;
    keyId: string;
    metadata: IBindingMetadata;
}

/**
 * Returns the configured HMAC secret for a given key ID (supporting key rotation).
 * Defaults to the active key ID and secret if not explicitly provided.
 */
export function getHmacSecret(keyId?: string): { secret: string; keyId: string } {
    const activeKeyId = process.env.ORIGINAL_STORAGE_KEY_ID || 'v1';
    const activeSecret = process.env.ORIGINAL_STORAGE_HMAC_SECRET;

    if (!activeSecret || activeSecret.trim() === '') {
        throw new Error('ORIGINAL_STORAGE_HMAC_SECRET is missing or not configured');
    }

    // If keyId is not provided or matches the active keyId, return the active secret and keyId
    if (!keyId || keyId === activeKeyId) {
        return { secret: activeSecret, keyId: activeKeyId };
    }

    // Historical keyId requested: lookup ORIGINAL_STORAGE_HMAC_SECRET_<KEYID>
    const rotatedSecretVar = `ORIGINAL_STORAGE_HMAC_SECRET_${keyId.toUpperCase().replace(/-/g, '_')}`;
    const rotatedSecret = process.env[rotatedSecretVar];
    if (rotatedSecret && rotatedSecret.trim() !== '') {
        return { secret: rotatedSecret, keyId };
    }

    // Do NOT fall back to active secret when historical key secret is unavailable
    throw new Error(`HMAC secret for key ID "${keyId}" is unavailable or not configured (${rotatedSecretVar})`);
}

/**
 * Produces a deterministic canonical byte sequence for binding metadata.
 * Ensures consistent serialization across write and verify operations.
 */
export function serializeBindingMetadata(meta: IBindingMetadata): string {
    // Canonical format: batchId:<batchId>|seq:<seq>|uploader:<uploader>|ts:<ts>
    return `batchId=${meta.batchId}&seq=${meta.sequenceNumber}&uploader=${meta.uploader}&ts=${meta.timestamp}`;
}

/**
 * Computes an HMAC seal covering both the file content and binding metadata.
 */
export function generateHmacSeal(
    content: Buffer,
    metadata: IBindingMetadata,
    customKeyId?: string,
    customSecret?: string
): HmacSealResult {
    let secret = customSecret;
    let keyId = customKeyId || process.env.ORIGINAL_STORAGE_KEY_ID || 'v1';

    if (!secret) {
        const resolved = getHmacSecret(keyId);
        secret = resolved.secret;
        keyId = resolved.keyId;
    }

    const canonicalMeta = serializeBindingMetadata(metadata);
    const hmacInstance = crypto.createHmac('sha256', secret);

    // Update with file content
    hmacInstance.update(content);
    // Update with binding metadata delimiter and canonical metadata string
    hmacInstance.update(Buffer.from('\x00--METADATA_BINDING--\x00', 'utf-8'));
    hmacInstance.update(Buffer.from(canonicalMeta, 'utf-8'));

    const hmac = hmacInstance.digest('hex');

    return {
        hmac,
        keyId,
        metadata
    };
}

/**
 * Verifies that the given content and binding metadata match the expected HMAC seal
 * using a constant-time comparison.
 */
export function verifyHmacSeal(
    content: Buffer,
    metadata: IBindingMetadata,
    expectedHmac: string,
    keyId?: string,
    customSecret?: string
): { valid: boolean; reason?: string } {
    if (!expectedHmac || typeof expectedHmac !== 'string') {
        return { valid: false, reason: 'Expected HMAC is missing or invalid' };
    }

    let secret = customSecret;
    const resolvedKeyId = keyId || process.env.ORIGINAL_STORAGE_KEY_ID || 'v1';

    if (!secret) {
        try {
            const resolved = getHmacSecret(resolvedKeyId);
            secret = resolved.secret;
        } catch (err) {
            return {
                valid: false,
                reason: err instanceof Error ? err.message : 'HMAC secret resolution failed'
            };
        }
    }

    const { hmac: computedHmac } = generateHmacSeal(content, metadata, resolvedKeyId, secret);

    try {
        const computedBuffer = Buffer.from(computedHmac, 'hex');
        const expectedBuffer = Buffer.from(expectedHmac, 'hex');

        if (computedBuffer.length !== expectedBuffer.length) {
            return { valid: false, reason: 'HMAC length mismatch' };
        }

        const isMatch = crypto.timingSafeEqual(computedBuffer, expectedBuffer);
        if (!isMatch) {
            return { valid: false, reason: 'HMAC signature verification failed (tamper detected)' };
        }

        return { valid: true };
    } catch {
        return { valid: false, reason: 'HMAC verification error' };
    }
}
