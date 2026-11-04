import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { Permission, UserRole } from '../../../../constants/permissions';
import { requirePermission } from '../../../../lib/apiAuth';
import { buildExamAuditLogFilter } from '../../../../lib/auditQueries';
import { connectDB } from '../../../../lib/db';
import AuditLog from '../../../../models/AuditLog';
import Exam from '../../../../models/Exam';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function csvCell(value: unknown): string {
    const raw = value === null || value === undefined ? '' : String(value);
    const spreadsheetSafe = /^[\s\uFEFF]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
}

function auditRow(record: {
    user?: unknown;
    action: string;
    outcome?: string;
    createdAt: Date;
    entityId?: mongoose.Types.ObjectId;
    entityType?: string;
}): string {
    const actor = isRecord(record.user) ? record.user : null;
    return [
        typeof actor?.name === 'string' ? actor.name : 'Unknown user',
        typeof actor?.role === 'string' ? actor.role : 'UNKNOWN',
        record.action,
        record.outcome || '',
        record.createdAt instanceof Date ? record.createdAt.toISOString() : '',
        record.entityType || '',
        record.entityId?.toString() || ''
    ].map(csvCell).join(',') + '\r\n';
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

    const examId = request.nextUrl.searchParams.get('examId');
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
        return NextResponse.json(
            { success: false, message: 'A valid exam ID is required', data: null },
            { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    try {
        await connectDB();
        const examObjectId = new mongoose.Types.ObjectId(examId);
        const examFilter = auth.user.role === UserRole.ADMIN
            ? { _id: examObjectId }
            : { _id: examObjectId, createdBy: auth.user.id };
        if (!await Exam.exists(examFilter)) {
            return NextResponse.json(
                { success: false, message: 'Exam not found', data: null },
                { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
            );
        }

        const cursor = AuditLog.find(buildExamAuditLogFilter(examId))
            .populate('user', '_id name role')
            .sort({ createdAt: 1, _id: 1 })
            .lean()
            .cursor({ batchSize: 100 });
        const encoder = new TextEncoder();
        let headerPending = true;
        const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
                if (headerPending) {
                    headerPending = false;
                    controller.enqueue(encoder.encode(
                        'actor,actor_role,action,outcome,timestamp,target_type,target_id\r\n'
                    ));
                    return;
                }
                try {
                    const record = await cursor.next();
                    if (!record) {
                        await cursor.close();
                        controller.close();
                        return;
                    }
                    controller.enqueue(encoder.encode(auditRow(record)));
                } catch (error) {
                    console.error('Failed while streaming audit CSV:', error);
                    await cursor.close();
                    controller.error(new Error('Audit CSV export failed'));
                }
            },
            async cancel() {
                await cursor.close();
            }
        });

        return new NextResponse(body, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="audit-logs-${examId}.csv"`,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff'
            }
        });
    } catch (error: unknown) {
        console.error('Failed to export audit records:', error);
        return NextResponse.json(
            { success: false, message: 'Could not export audit records', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}
