import AuditLog from '../models/AuditLog';
import mongoose from 'mongoose';
import { isDuplicateKeyError } from './errors';

export interface AuditLogParams {
    user: string | mongoose.Types.ObjectId;
    action: string;
    outcome?: 'SUCCESS' | 'FAILURE';
    entityId?: string | mongoose.Types.ObjectId;
    entityType?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    session?: mongoose.ClientSession;
}

function parseUserObjectId(user: string | mongoose.Types.ObjectId): mongoose.Types.ObjectId | undefined {
    if (!user) {
        return undefined;
    }
    if (user instanceof mongoose.Types.ObjectId) {
        return user;
    }
    if (mongoose.Types.ObjectId.isValid(user)) {
        return new mongoose.Types.ObjectId(user);
    }
    return undefined;
}

/**
 * Retains only the first IP address from an x-forwarded-for chain.
 */
function sanitizeIpAddress(ip?: string): string | undefined {
    if (!ip || typeof ip !== 'string') {
        return undefined;
    }
    const trimmed = ip.trim();
    if (!trimmed) {
        return undefined;
    }
    const firstIp = trimmed.split(',')[0].trim();
    return firstIp || undefined;
}

/**
 * Truncates feedback strings in audit metadata to max 2,000 characters
 * and adds an explicit [TRUNCATED] indicator, safely avoiding circular references
 * while preserving repeated objects across sibling snapshot branches.
 */
export function sanitizeAuditFeedback(value: unknown, activePath = new Set<object>(), depth = 0): unknown {
    if (typeof value === 'string') {
        if (value.length > 2000) {
            return value.slice(0, 1985) + '... [TRUNCATED]';
        }
        return value;
    }
    if (depth > 6) {
        return '[DEPTH_LIMIT_EXCEEDED]';
    }
    if (value && typeof value === 'object') {
        if (value instanceof mongoose.Types.ObjectId || value instanceof Date || value instanceof RegExp) {
            return value;
        }
        if (activePath.has(value)) {
            return undefined;
        }
        activePath.add(value);
        try {
            if (Array.isArray(value)) {
                return value.map((item) => sanitizeAuditFeedback(item, activePath, depth + 1));
            }

            const rawObj = typeof (value as { toObject?: () => unknown }).toObject === 'function'
                ? (value as { toObject: () => unknown }).toObject()
                : value;

            if (!rawObj || typeof rawObj !== 'object') {
                return rawObj;
            }

            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(rawObj as Record<string, unknown>)) {
                if (k.startsWith('$') || k === '_doc') continue;
                result[k] = sanitizeAuditFeedback(v, activePath, depth + 1);
            }
            return result;
        } finally {
            activePath.delete(value);
        }
    }
    return value;
}

/**
 * Writes an audit log entry.
 * When session is provided, operations are scoped to that transaction and errors are re-thrown.
 * When session is absent, best-effort logging is preserved and errors are swallowed.
 */
export async function writeAuditLog(params: AuditLogParams): Promise<void> {
    try {
        const userId = parseUserObjectId(params.user);
        if (!userId) {
            // Omit the audit log entry if actor ID is invalid or unavailable
            return;
        }

        // Sanitize details by replacing raw database error info with a user-friendly message
        let sanitizedDetails = params.details;
        if (sanitizedDetails && typeof sanitizedDetails === 'object') {
            const detailsObj = { ...sanitizedDetails };
            for (const key of Object.keys(detailsObj)) {
                if (isDuplicateKeyError(detailsObj[key])) {
                    detailsObj[key] = 'Conflict: Duplicate key error';
                }
            }
            sanitizedDetails = sanitizeAuditFeedback(detailsObj) as Record<string, unknown>;
        }

        const sanitizedIp = sanitizeIpAddress(params.ipAddress);

        const auditDoc = {
            user: userId,
            action: params.action,
            outcome: params.outcome,
            entityId: params.entityId,
            entityType: params.entityType,
            details: sanitizedDetails,
            ipAddress: sanitizedIp
        };

        if (params.session) {
            const entry = new AuditLog(auditDoc);
            await entry.save({ session: params.session });
        } else {
            await AuditLog.create(auditDoc);
        }
    } catch (error) {
        if (params.session) {
            throw error;
        }
        console.error('Failed to write audit log:', error);
    }
}
