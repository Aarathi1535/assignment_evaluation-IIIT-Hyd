import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getConfiguredStorageBucket } from './cloudStorage';
import derivedStorageService from '../services/DerivedStorageService';

export const WATERMARK_VERSION = 'v1';
export const MAX_CONCURRENT_WATERMARK_RENDERS = 2;

export class WatermarkCapacityError extends Error {
    readonly retryAfterSeconds: number;
    constructor(message = 'Service saturated, please retry shortly', retryAfterSeconds = 1) {
        super(message);
        this.name = 'WatermarkCapacityError';
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

let activeRenders = 0;

/**
 * Attempts to acquire one of the concurrent render slots.
 * Throws WatermarkCapacityError if the instance capacity is saturated.
 */
export function tryAcquireWatermarkSlot(): () => void {
    if (activeRenders >= MAX_CONCURRENT_WATERMARK_RENDERS) {
        throw new WatermarkCapacityError('Watermark render capacity reached. Please retry shortly.', 1);
    }
    activeRenders++;
    let released = false;
    return () => {
        if (!released) {
            released = true;
            activeRenders = Math.max(0, activeRenders - 1);
        }
    };
}

/**
 * For testing and introspection.
 */
export function getActiveWatermarkRenderCount(): number {
    return activeRenders;
}

/**
 * For test resets.
 */
export function resetWatermarkConcurrencySlots(): void {
    activeRenders = 0;
}

/**
 * Formats a Date object into IST string: `YYYY-MM-DD HH:mm:ss IST`
 */
export function formatISTDateTime(date: Date): string {
    // IST is UTC + 5:30 (330 minutes)
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(date.getTime() + istOffsetMs);

    const year = istTime.getUTCFullYear();
    const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istTime.getUTCDate()).padStart(2, '0');
    const hours = String(istTime.getUTCHours()).padStart(2, '0');
    const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} IST`;
}

/**
 * Formats a Date object into IST day-granularity string: `YYYY-MM-DD`
 */
export function formatISTDateOnly(date: Date): string {
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(date.getTime() + istOffsetMs);

    const year = istTime.getUTCFullYear();
    const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istTime.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

export interface WatermarkIdentity {
    rollNumber?: string | null;
    timestamp: Date | string;
    traceCode: string;
}

/**
 * Builds the text to burn into the watermark.
 * If roll number is present: `<rollNumber> • <timestamp> • <traceCode>`
 * If roll number is absent: `<timestamp> • <traceCode>`
 * Never prints name, email, or anonymousId.
 */
export function buildWatermarkText(identity: WatermarkIdentity): string {
    const formattedTs =
        typeof identity.timestamp === 'string'
            ? identity.timestamp
            : formatISTDateTime(identity.timestamp);

    const parts: string[] = [];
    if (identity.rollNumber && identity.rollNumber.trim().length > 0) {
        parts.push(identity.rollNumber.trim());
    }
    parts.push(formattedTs);
    parts.push(identity.traceCode.trim());

    return parts.join(' • ');
}

export interface GenerateTraceCodeInput {
    userId: string;
    scriptId: string;
    pageId: string;
    issuedAt: string | number | Date;
    secret?: string;
}

/**
 * Resolves the dedicated HMAC secret safely without hardcoded fallbacks or leaking secrets.
 * Precedence:
 * 1. customSecret (if provided)
 * 2. process.env.WATERMARK_HMAC_SECRET (if configured)
 * If none available, throws Error to fail closed safely.
 * Never falls back to ORIGINAL_STORAGE_HMAC_SECRET or NEXTAUTH_SECRET.
 */
export function resolveWatermarkHmacSecret(customSecret?: string): string {
    if (customSecret && customSecret.trim() !== '') {
        return customSecret;
    }

    const watermarkSecret = process.env.WATERMARK_HMAC_SECRET;
    if (watermarkSecret && watermarkSecret.trim() !== '') {
        return watermarkSecret;
    }

    throw new Error('WATERMARK_HMAC_SECRET is missing or not configured');
}

/**
 * Generates the first 10 hex characters of HMAC(secret, userId|scriptId|pageId|issuedAt).
 * Never exposes the HMAC secret. Fails closed safely if no secret is available.
 */
export function generateTraceCode(input: GenerateTraceCodeInput): string {
    const issuedAtStr =
        input.issuedAt instanceof Date
            ? input.issuedAt.toISOString()
            : String(input.issuedAt);

    const secret = resolveWatermarkHmacSecret(input.secret);
    const payload = `${input.userId}|${input.scriptId}|${input.pageId}|${issuedAtStr}`;
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return hmac.slice(0, 10);
}

/**
 * Applies a tiled diagonal watermark and a footer watermark line to an image buffer.
 * Preserves the input image's exact natural width and height.
 * Encodes output as JPEG quality 80.
 */
export async function applyWatermark(buffer: Buffer, text: string): Promise<Buffer> {
    const img = await loadImage(buffer);
    const width = img.width;
    const height = img.height;

    if (width <= 0 || height <= 0) {
        throw new Error(`Invalid image dimensions: ${width}x${height}`);
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Draw the base image at natural dimensions
    ctx.drawImage(img, 0, 0, width, height);

    // 2. Render tiled diagonal watermark text across the page at ~15% opacity
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#1e293b'; // Slate 800

    const fontSize = Math.max(14, Math.min(28, Math.round(width / 35)));
    ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const angle = -Math.PI / 6; // -30 degrees
    const stepX = Math.max(250, Math.round(fontSize * 18));
    const stepY = Math.max(140, Math.round(fontSize * 8));

    // Diagonal grid covering rotation overshoot
    const diagonal = Math.sqrt(width * width + height * height);
    const startX = -diagonal / 2;
    const endX = width + diagonal / 2;
    const startY = -diagonal / 2;
    const endY = height + diagonal / 2;

    for (let y = startY; y < endY; y += stepY) {
        for (let x = startX; x < endX; x += stepX) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.fillText(text, 0, 0);
            ctx.restore();
        }
    }
    ctx.restore();

    // 3. Render a discreet footer banner at the bottom containing the watermark information
    ctx.save();
    const footerHeight = Math.max(22, Math.round(height * 0.025));
    const footerY = height - footerHeight;

    // Semi-transparent background banner for footer readability
    ctx.fillStyle = 'rgba(241, 245, 249, 0.85)'; // Slate 100 with 85% opacity
    ctx.fillRect(0, footerY, width, footerHeight);

    // Footer text
    ctx.fillStyle = '#334155'; // Slate 700
    const footerFontSize = Math.max(10, Math.min(14, Math.round(footerHeight * 0.55)));
    ctx.font = `500 ${footerFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, footerY + footerHeight / 2);
    ctx.restore();

    // 4. Return JPEG at approximately quality 80
    return canvas.toBuffer('image/jpeg', 80);
}

export interface WatermarkCacheMetadata {
    pageId: string;
    storageKey: string;
    width: number;
    height: number;
    watermarkVersion: string;
    userId: string;
    day: string;
    issuedAt: string;
    traceCode: string;
    rollNumber?: string | null;
}

/**
 * Builds deterministic storage key for student cached render:
 * `student-renders/${userId}/${pageId}/${day}_${WATERMARK_VERSION}_${width}x${height}_${keyHash}.jpg`
 * Uses sha256 hash (first 16 hex chars) of the storage key to avoid character-replacement collisions.
 */
export function buildRenderCacheKey(params: {
    userId: string;
    pageId: string;
    day: string;
    width: number;
    height: number;
    storageKey: string;
}): string {
    const keyHash = crypto.createHash('sha256').update(params.storageKey).digest('hex').slice(0, 16);
    return `student-renders/${params.userId}/${params.pageId}/${params.day}_${WATERMARK_VERSION}_${params.width}x${params.height}_${keyHash}.jpg`;
}

/**
 * Retrieves a cached watermark render and its metadata if present.
 */
export async function getCachedWatermarkRender(cacheKey: string): Promise<{
    buffer: Buffer;
    metadata: WatermarkCacheMetadata;
} | null> {
    const metaKey = `${cacheKey}.meta.json`;
    const bucket = getConfiguredStorageBucket();

    if (bucket) {
        try {
            const [exists] = await bucket.file(cacheKey).exists();
            if (!exists) return null;
            const [buffer] = await bucket.file(cacheKey).download();
            const [metaBuf] = await bucket.file(metaKey).download();
            const metadata = JSON.parse(metaBuf.toString('utf-8')) as WatermarkCacheMetadata;
            return { buffer, metadata };
        } catch {
            return null;
        }
    }

    const storageRoot = derivedStorageService.getStorageRoot();
    const diskPath = path.join(storageRoot, cacheKey);
    const metaPath = path.join(storageRoot, metaKey);

    try {
        if (!fs.existsSync(diskPath) || !fs.existsSync(metaPath)) {
            return null;
        }
        const buffer = await fs.promises.readFile(diskPath);
        const metaStr = await fs.promises.readFile(metaPath, 'utf-8');
        const metadata = JSON.parse(metaStr) as WatermarkCacheMetadata;
        return { buffer, metadata };
    } catch {
        return null;
    }
}

/**
 * Stores a cached watermark render and its metadata.
 */
export async function storeCachedWatermarkRender(
    cacheKey: string,
    buffer: Buffer,
    metadata: WatermarkCacheMetadata
): Promise<void> {
    const metaKey = `${cacheKey}.meta.json`;
    const metaBuffer = Buffer.from(JSON.stringify(metadata), 'utf-8');
    const bucket = getConfiguredStorageBucket();

    if (bucket) {
        await bucket.file(cacheKey).save(buffer, {
            resumable: false,
            metadata: { contentType: 'image/jpeg' },
        });
        await bucket.file(metaKey).save(metaBuffer, {
            resumable: false,
            metadata: { contentType: 'application/json' },
        });
        return;
    }

    const storageRoot = derivedStorageService.getStorageRoot();
    const diskPath = path.join(storageRoot, cacheKey);
    const metaPath = path.join(storageRoot, metaKey);

    await fs.promises.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.promises.writeFile(diskPath, buffer);
    await fs.promises.writeFile(metaPath, metaBuffer);
}
