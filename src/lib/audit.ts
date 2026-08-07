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
 * Writes an audit log entry.
 * Ensures that if writing the audit log fails, it is caught and logged,
 * preventing any interruption to the main operation.
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
            let modified = false;
            for (const key of Object.keys(detailsObj)) {
                if (isDuplicateKeyError(detailsObj[key])) {
                    detailsObj[key] = 'Conflict: Duplicate key error';
                    modified = true;
                }
            }
            if (modified) {
                sanitizedDetails = detailsObj;
            }
        }

        await AuditLog.create({
            user: userId,
            action: params.action,
            outcome: params.outcome,
            entityId: params.entityId,
            entityType: params.entityType,
            details: sanitizedDetails,
            ipAddress: params.ipAddress
        });
    } catch (error) {
        console.error('Failed to write audit log:', error);
    }
}
