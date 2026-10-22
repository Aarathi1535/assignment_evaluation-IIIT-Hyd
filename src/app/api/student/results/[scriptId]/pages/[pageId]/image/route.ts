import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../../lib/db';
import { requireAuth } from '../../../../../../../../lib/apiAuth';
import studentResultService from '../../../../../../../../services/StudentResultService';
import DerivedStorageService from '../../../../../../../../services/DerivedStorageService';
import IngestionPage from '../../../../../../../../models/IngestionPage';
import StudentMapping from '../../../../../../../../models/StudentMapping';
import { HttpError } from '../../../../../../../../lib/errors';
import { DEFAULT_PAGE_RENDERING_CONFIG } from '../../../../../../../../services/PageRenderer';
import { writeAuditLog } from '../../../../../../../../lib/audit';
import {
    applyWatermark,
    buildRenderCacheKey,
    buildWatermarkText,
    formatISTDateOnly,
    formatISTDateTime,
    generateTraceCode,
    getCachedWatermarkRender,
    storeCachedWatermarkRender,
    tryAcquireWatermarkSlot,
    WATERMARK_VERSION,
    WatermarkCapacityError,
} from '../../../../../../../../lib/watermark';

export const dynamic = 'force-dynamic';

const SECURITY_HEADERS = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
} as const;

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string; pageId: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        auth.response.headers.set('Cache-Control', 'private, no-store');
        auth.response.headers.set('X-Content-Type-Options', 'nosniff');
        return auth.response;
    }

    const { scriptId, pageId } = await context.params;

    if (!pageId || !mongoose.Types.ObjectId.isValid(pageId)) {
        return NextResponse.json(
            { success: false, message: 'Not found' },
            { status: 404, headers: SECURITY_HEADERS }
        );
    }

    try {
        await connectDB();
        // Resolve authenticated user identity only. Never trust query params.
        const authUserId = auth.user.id;
        const authUserRole = auth.user.role;

        const { script } = await studentResultService.verifyStudentScriptAccess(
            scriptId,
            authUserId,
            authUserRole
        );

        // Find page belonging strictly to this answer script and skip duplicates
        const pageIdObj = new mongoose.Types.ObjectId(pageId);
        const ingestionPage = await IngestionPage.findOne({
            _id: pageIdObj,
            answerScript: script._id,
            isDuplicate: { $ne: true },
        }).select('storageKey width height batchId fileId pageNumber');

        if (!ingestionPage || !ingestionPage.storageKey) {
            return NextResponse.json(
                { success: false, message: 'Not found' },
                { status: 404, headers: SECURITY_HEADERS }
            );
        }

        const storageKey = ingestionPage.storageKey;

        // 1. Strict storage-key validation: must reside under batches/{batchId}/derived/... namespace
        // and match getDerivedPageKey convention when batchId/fileId/pageNumber are present
        if (!storageKey.startsWith('batches/') || !storageKey.includes('/derived/')) {
            return NextResponse.json(
                { success: false, message: 'Not found' },
                { status: 404, headers: SECURITY_HEADERS }
            );
        }

        if (ingestionPage.batchId && ingestionPage.fileId && typeof ingestionPage.pageNumber === 'number') {
            const extMatch = storageKey.match(/\.([a-zA-Z0-9]+)$/);
            const format = extMatch ? extMatch[1] : 'png';
            const expectedKey = DerivedStorageService.getDerivedPageKey(
                ingestionPage.batchId,
                ingestionPage.fileId,
                ingestionPage.pageNumber,
                format
            );
            if (storageKey !== expectedKey) {
                return NextResponse.json(
                    { success: false, message: 'Not found' },
                    { status: 404, headers: SECURITY_HEADERS }
                );
            }
        }

        // 2. Strict dimension validation: fail closed on missing, invalid, <= 0, or oversized dimensions
        const width = ingestionPage.width;
        const height = ingestionPage.height;

        if (
            typeof width !== 'number' ||
            typeof height !== 'number' ||
            Number.isNaN(width) ||
            Number.isNaN(height) ||
            width <= 0 ||
            height <= 0
        ) {
            return NextResponse.json(
                { success: false, message: 'Invalid page dimensions' },
                { status: 422, headers: SECURITY_HEADERS }
            );
        }

        const longEdge = Math.max(width, height);
        const totalPixels = width * height;
        if (
            longEdge > DEFAULT_PAGE_RENDERING_CONFIG.maxLongEdge ||
            totalPixels > DEFAULT_PAGE_RENDERING_CONFIG.maxPixels
        ) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Page exceeds maximum allowed dimensions for rendering',
                },
                { status: 422, headers: SECURITY_HEADERS }
            );
        }

        const now = new Date();
        const dayStr = formatISTDateOnly(now);
        const cacheKey = buildRenderCacheKey({
            userId: authUserId,
            pageId,
            day: dayStr,
            width,
            height,
            storageKey,
        });

        // 3. Check cache hit
        const cached = await getCachedWatermarkRender(cacheKey);
        if (cached) {
            return new NextResponse(new Uint8Array(cached.buffer), {
                status: 200,
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Content-Length': cached.buffer.length.toString(),
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                },
            });
        }

        // 4. Cache miss: acquire concurrency slot
        let releaseSlot: (() => void) | null = null;
        try {
            releaseSlot = tryAcquireWatermarkSlot();
        } catch (slotErr) {
            if (slotErr instanceof WatermarkCapacityError) {
                return NextResponse.json(
                    { success: false, message: slotErr.message },
                    {
                        status: 503,
                        headers: {
                            ...SECURITY_HEADERS,
                            'Retry-After': String(slotErr.retryAfterSeconds),
                        },
                    }
                );
            }
            throw slotErr;
        }

        try {
            // Read derived page buffer safely
            const rawBuffer = await DerivedStorageService.readDerivedPage(storageKey);

            // Fetch StudentMapping for exam and student to resolve rollNumber if available
            const studentUserObjId = script.student;
            let rollNumber: string | null = null;
            if (studentUserObjId && script.exam) {
                const mapping = await StudentMapping.findOne({
                    exam: script.exam,
                    student: studentUserObjId,
                }).select('rollNumber');
                if (mapping && mapping.rollNumber) {
                    rollNumber = mapping.rollNumber;
                }
            }

            const issuedAt = now.toISOString();
            const traceCode = generateTraceCode({
                userId: authUserId,
                scriptId,
                pageId,
                issuedAt,
            });

            const watermarkText = buildWatermarkText({
                rollNumber,
                timestamp: formatISTDateTime(now),
                traceCode,
            });

            // Burn watermark into image
            const watermarkedBuffer = await applyWatermark(rawBuffer, watermarkText);

            // Write audit entry: deduplicated per student/page/day (only written upon rendering)
            const clientIp =
                req.headers.get('x-forwarded-for') ||
                req.headers.get('x-real-ip') ||
                undefined;

            const auditSuccess = await writeAuditLog({
                user: authUserId,
                action: 'STUDENT_PAGE_IMAGE_WATERMARKED',
                outcome: 'SUCCESS',
                entityId: pageId,
                entityType: 'IngestionPage',
                ipAddress: clientIp,
                details: {
                    userId: authUserId,
                    scriptId,
                    pageId,
                    traceCode,
                    rollNumber: rollNumber || null,
                    issuedAt,
                    day: dayStr,
                },
            });

            // If audit write fails, do not store to cache so subsequent attempts will not bypass audit
            if (auditSuccess) {
                await storeCachedWatermarkRender(cacheKey, watermarkedBuffer, {
                    pageId,
                    storageKey,
                    width,
                    height,
                    watermarkVersion: WATERMARK_VERSION,
                    userId: authUserId,
                    day: dayStr,
                    issuedAt,
                    traceCode,
                    rollNumber,
                });
            }

            return new NextResponse(new Uint8Array(watermarkedBuffer), {
                status: 200,
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Content-Length': watermarkedBuffer.length.toString(),
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                },
            });
        } finally {
            if (releaseSlot) {
                releaseSlot();
            }
        }
    } catch (error: unknown) {
        if (error instanceof WatermarkCapacityError) {
            return NextResponse.json(
                { success: false, message: error.message },
                {
                    status: 503,
                    headers: {
                        ...SECURITY_HEADERS,
                        'Retry-After': String(error.retryAfterSeconds),
                    },
                }
            );
        }

        const status = error instanceof HttpError ? error.statusCode : 404;
        return NextResponse.json(
            { success: false, message: status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not found' },
            {
                status,
                headers: SECURITY_HEADERS,
            }
        );
    }
}
