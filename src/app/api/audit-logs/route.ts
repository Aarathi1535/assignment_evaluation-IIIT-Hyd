import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { Permission, UserRole } from '../../../constants/permissions';
import { requirePermission } from '../../../lib/apiAuth';
import { buildExamAuditLogFilter } from '../../../lib/auditQueries';
import { connectDB } from '../../../lib/db';
import AuditLog from '../../../models/AuditLog';
import Exam from '../../../models/Exam';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeDetails(value: unknown): unknown {
    if (value instanceof mongoose.Types.ObjectId) {
        return value.toString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Buffer.isBuffer(value)) {
        return '[binary data omitted]';
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeDetails);
    }
    if (!isRecord(value)) {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !/(password|secret|token|ipaddress|storage(path|key)|file(path|name))/i.test(key))
            .map(([key, item]) => [key, sanitizeDetails(item)])
    );
}

export async function GET(request: NextRequest) {
    const auth = await requirePermission(Permission.VIEW_ALL_SUBMISSIONS);
    if (!auth.authorized) {
        return auth.response;
    }
    if (auth.user.role !== UserRole.ADMIN && auth.user.role !== UserRole.PROFESSOR) {
        return NextResponse.json(
            { success: false, message: 'Forbidden', data: null },
            { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    const search = request.nextUrl.searchParams;
    const examId = search.get('examId');
    const userId = search.get('userId');
    const page = Number(search.get('page') || 1);
    const requestedLimit = Number(search.get('limit') || DEFAULT_PAGE_SIZE);

    if ((examId && !mongoose.Types.ObjectId.isValid(examId)) ||
        (userId && !mongoose.Types.ObjectId.isValid(userId)) ||
        !Number.isSafeInteger(page) || page < 1 ||
        !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
        return NextResponse.json(
            { success: false, message: 'Invalid audit query parameters', data: null },
            { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
    if (auth.user.role === UserRole.PROFESSOR && !examId) {
        return NextResponse.json(
            { success: false, message: 'An exam ID is required', data: null },
            { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    try {
        await connectDB();

        let examObjectId: mongoose.Types.ObjectId | undefined;
        if (examId) {
            examObjectId = new mongoose.Types.ObjectId(examId);
            const examFilter = auth.user.role === UserRole.ADMIN
                ? { _id: examObjectId }
                : { _id: examObjectId, createdBy: auth.user.id };
            const examExists = await Exam.exists(examFilter);
            if (!examExists) {
                return NextResponse.json(
                    { success: false, message: 'Exam not found', data: null },
                    { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
                );
            }
        }

        const filters: Record<string, unknown>[] = [];
        if (examId) {
            filters.push(buildExamAuditLogFilter(examId));
        }
        if (userId) {
            filters.push({ user: new mongoose.Types.ObjectId(userId) });
        }
        const query = filters.length > 0 ? { $and: filters } : {};
        const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);
        const [records, total] = await Promise.all([
            AuditLog.find(query)
                .populate('user', '_id name role')
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            AuditLog.countDocuments(query)
        ]);

        const logs = records.map(record => {
            const actor = isRecord(record.user) ? record.user : null;
            return {
                id: record._id.toString(),
                actor: actor ? {
                    id: actor._id?.toString?.() || '',
                    name: typeof actor.name === 'string' ? actor.name : 'Unknown user',
                    role: typeof actor.role === 'string' ? actor.role : 'UNKNOWN'
                } : {
                    id: record.user?.toString?.() || '',
                    name: 'Unknown user',
                    role: 'UNKNOWN'
                },
                action: record.action,
                outcome: record.outcome || null,
                timestamp: record.createdAt,
                target: record.entityId ? {
                    id: record.entityId.toString(),
                    type: record.entityType || 'Unknown'
                } : null,
                details: sanitizeDetails(record.details ?? null)
            };
        });

        return NextResponse.json(
            {
                success: true,
                data: {
                    logs,
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            },
            { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
        );
    } catch (error: unknown) {
        console.error('Failed to retrieve audit records:', error);
        return NextResponse.json(
            { success: false, message: 'Could not retrieve audit records', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}
