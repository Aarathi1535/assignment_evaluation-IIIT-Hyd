import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../lib/db';
import { requireAuth } from '../../../../../../lib/apiAuth';
import studentResultService from '../../../../../../services/StudentResultService';
import DerivedStorageService from '../../../../../../services/DerivedStorageService';
import IngestionPage from '../../../../../../models/IngestionPage';
import Page from '../../../../../../models/Page';
import StudentMapping from '../../../../../../models/StudentMapping';
import { StudentDownloadPolicy } from '../../../../../../models/Exam';
import { HttpError } from '../../../../../../lib/errors';
import { DEFAULT_PAGE_RENDERING_CONFIG } from '../../../../../../services/PageRenderer';
import { writeAuditLog } from '../../../../../../lib/audit';
import {
    applyWatermark,
    buildWatermarkText,
    formatISTDateTime,
    generateTraceCode,
} from '../../../../../../lib/watermark';
import {
    compositePageAnnotations,
} from '../../../../../../services/AnnotationCompositor';
import {
    cloneMarkAnnotation,
    cloneFreehandStroke,
    type SerializedPageAnnotations,
} from '../../../../../../lib/annotationSerialization';
import type { MarkAnnotation } from '../../../../../../lib/stampTool';
import type { FreehandStroke } from '../../../../../../lib/penTool';
import {
    checkStudentExportRateLimit,
    PdfExportCapacityError,
    recordStudentExport,
    tryAcquirePdfExportSlot,
} from '../../../../../../lib/pdfExportGuards';
import { PDFDocument } from 'pdf-lib';

export const dynamic = 'force-dynamic';

const SECURITY_HEADERS = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
} as const;

export const MAX_EXPORT_PAGES = 40;

interface ScriptPageRecord {
    _id: mongoose.Types.ObjectId;
    pageNumber: number;
    storageKey: string;
    batchId?: string;
    fileId?: string;
    width?: number;
    height?: number;
    metadata?: Record<string, unknown>;
}

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        auth.response.headers.set('Cache-Control', 'private, no-store');
        auth.response.headers.set('X-Content-Type-Options', 'nosniff');
        return auth.response;
    }

    const { scriptId } = await context.params;

    let releaseSlot: (() => void) | null = null;

    try {
        await connectDB();

        // 1. Authenticated identity & verify access via studentResultService
        // Rejects non-students (TA/Professor) with 403, and unreleased/non-existent/unowned scripts with 404
        const { script, exam } = await studentResultService.verifyStudentScriptAccess(
            scriptId,
            auth.user.id,
            auth.user.role
        );

        // 2. Exam download policy evaluation
        // Missing, null, unknown, or DISABLED policies must fail closed with generic 403
        const effectivePolicy =
            exam.studentDownloadPolicy === StudentDownloadPolicy.WATERMARKED
                ? StudentDownloadPolicy.WATERMARKED
                : StudentDownloadPolicy.DISABLED;

        if (effectivePolicy !== StudentDownloadPolicy.WATERMARKED) {
            return NextResponse.json(
                { success: false, message: 'Forbidden' },
                { status: 403, headers: SECURITY_HEADERS }
            );
        }

        // 3. Per-student rate limit (~5 exports per hour)
        const rateLimit = checkStudentExportRateLimit(auth.user.id);
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { success: false, message: 'Rate limit exceeded' },
                {
                    status: 429,
                    headers: {
                        ...SECURITY_HEADERS,
                        'Retry-After': String(rateLimit.retryAfterSeconds ?? 3600),
                    },
                }
            );
        }

        // 4. Instance-wide concurrency capacity (max 1 PDF export at a time)
        try {
            releaseSlot = tryAcquirePdfExportSlot();
        } catch (slotErr) {
            if (slotErr instanceof PdfExportCapacityError) {
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

        // 5. Fetch script pages in expected page order (skipping duplicate ingestion pages)
        const ingestionPages = await IngestionPage.find({
            answerScript: script._id,
            isDuplicate: { $ne: true },
        })
            .sort({ fileIndex: 1, pageNumber: 1 })
            .lean();

        let scriptPages: ScriptPageRecord[] = [];

        if (ingestionPages.length > 0) {
            scriptPages = ingestionPages.map((p) => ({
                _id: p._id as mongoose.Types.ObjectId,
                pageNumber: p.pageNumber,
                storageKey: p.storageKey,
                batchId: p.batchId,
                fileId: p.fileId,
                width: p.width,
                height: p.height,
                metadata: p.metadata as Record<string, unknown>,
            }));
        } else {
            const standardPages = await Page.find({
                answerScript: script._id,
                isActive: true,
            })
                .sort({ pageNumber: 1 })
                .lean();

            scriptPages = standardPages.map((p) => ({
                _id: p._id as mongoose.Types.ObjectId,
                pageNumber: p.pageNumber,
                storageKey: p.imagePath,
            }));
        }

        if (scriptPages.length === 0) {
            return NextResponse.json(
                { success: false, message: 'Not found' },
                { status: 404, headers: SECURITY_HEADERS }
            );
        }

        // 6. Enforce maximum 40 pages per export
        if (scriptPages.length > MAX_EXPORT_PAGES) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Export exceeds maximum allowed page count (${MAX_EXPORT_PAGES} pages)`,
                },
                { status: 422, headers: SECURITY_HEADERS }
            );
        }

        // 7. Resolve student roll number if available
        let rollNumber: string | null = null;
        if (script.student && script.exam) {
            const mapping = await StudentMapping.findOne({
                exam: script.exam,
                student: script.student,
            }).select('rollNumber');
            if (mapping && mapping.rollNumber) {
                rollNumber = mapping.rollNumber;
            }
        }

        const now = new Date();
        const istTimestamp = formatISTDateTime(now);
        const issuedAt = now.toISOString();

        // 8. Build PDF document using pdf-lib
        const pdfDoc = await PDFDocument.create();

        for (const page of scriptPages) {
            const storageKey = page.storageKey;

            // Strict storage-key validation
            if (!storageKey || !storageKey.startsWith('batches/') || !storageKey.includes('/derived/')) {
                return NextResponse.json(
                    { success: false, message: 'Invalid page storage' },
                    { status: 422, headers: SECURITY_HEADERS }
                );
            }

            if (page.batchId && page.fileId && typeof page.pageNumber === 'number') {
                const extMatch = storageKey.match(/\.([a-zA-Z0-9]+)$/);
                const format = extMatch ? extMatch[1] : 'png';
                const expectedKey = DerivedStorageService.getDerivedPageKey(
                    page.batchId,
                    page.fileId,
                    page.pageNumber,
                    format
                );
                if (storageKey !== expectedKey) {
                    return NextResponse.json(
                        { success: false, message: 'Invalid page storage' },
                        { status: 422, headers: SECURITY_HEADERS }
                    );
                }
            }

            // Dimensions validation
            const metaWidth = (page.metadata as Record<string, unknown> | undefined)?.width;
            const metaHeight = (page.metadata as Record<string, unknown> | undefined)?.height;
            const width =
                typeof page.width === 'number' && page.width > 0
                    ? page.width
                    : typeof metaWidth === 'number' && metaWidth > 0
                    ? metaWidth
                    : undefined;
            const height =
                typeof page.height === 'number' && page.height > 0
                    ? page.height
                    : typeof metaHeight === 'number' && metaHeight > 0
                    ? metaHeight
                    : undefined;

            if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
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

            // Read original derived page safely
            const rawBuffer = await DerivedStorageService.readDerivedPage(storageKey);

            // Fetch annotations for this page
            let rawAnnotations = (page.metadata?.annotations as SerializedPageAnnotations) || null;
            if (!rawAnnotations) {
                const stdPage = await Page.findOne({
                    answerScript: script._id,
                    pageNumber: page.pageNumber,
                    isActive: true,
                }).select('annotations');
                if (stdPage?.annotations) {
                    rawAnnotations = stdPage.annotations as SerializedPageAnnotations;
                }
            }

            // Sanitize annotations with strict allowlist projection
            const rawAnnotationList = Array.isArray(rawAnnotations?.annotations)
                ? rawAnnotations.annotations
                : [];
            const sanitizedAnnotations = rawAnnotationList
                .map((a: unknown) => {
                    const raw =
                        a && typeof (a as { toObject?: () => Record<string, unknown> }).toObject === 'function'
                            ? (a as { toObject: () => Record<string, unknown> }).toObject()
                            : ((a as Record<string, unknown>) || {});
                    const type = (raw.type as string) || (raw.tool as string);
                    const normalized = {
                        ...raw,
                        type,
                        pageKey: raw.pageKey ?? page._id.toString(),
                    };
                    return cloneMarkAnnotation(normalized as MarkAnnotation);
                })
                .filter((a) => a && ['check', 'cross', 'highlight', 'text'].includes(a.type));

            const rawStrokeList = Array.isArray(rawAnnotations?.strokes) ? rawAnnotations.strokes : [];
            const sanitizedStrokes = rawStrokeList
                .map((s: unknown) => {
                    const raw =
                        s && typeof (s as { toObject?: () => Record<string, unknown> }).toObject === 'function'
                            ? (s as { toObject: () => Record<string, unknown> }).toObject()
                            : ((s as Record<string, unknown>) || {});
                    const normalized = {
                        ...raw,
                        pageKey: raw.pageKey ?? page._id.toString(),
                    };
                    return cloneFreehandStroke(normalized as FreehandStroke);
                })
                .filter(
                    (s): s is FreehandStroke =>
                        Boolean(s) &&
                        Array.isArray(s?.points) &&
                        s.points.length >= 2 &&
                        s.points.every((pt) => typeof pt === 'number' && !Number.isNaN(pt))
                );

            const pageAnnotationsToComposite: SerializedPageAnnotations = {
                pageNumber: page.pageNumber,
                annotations: sanitizedAnnotations,
                strokes: sanitizedStrokes,
            };

            // Composite vector annotations onto source image
            const annotatedBuffer = await compositePageAnnotations(
                rawBuffer,
                pageAnnotationsToComposite,
                { format: 'jpeg', quality: 90 }
            );

            // Generate watermark trace code and text
            const traceCode = generateTraceCode({
                userId: auth.user.id,
                scriptId,
                pageId: page._id.toString(),
                issuedAt,
            });

            const watermarkText = buildWatermarkText({
                rollNumber,
                timestamp: istTimestamp,
                traceCode,
            });

            // Burn watermark into annotated image
            const watermarkedJpg = await applyWatermark(annotatedBuffer, watermarkText);

            // Embed into PDF page maintaining natural dimensions
            const imageBytes = new Uint8Array(watermarkedJpg);
            const embeddedImage = await pdfDoc.embedJpg(imageBytes);
            const pdfPage = pdfDoc.addPage([embeddedImage.width, embeddedImage.height]);
            pdfPage.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: embeddedImage.width,
                height: embeddedImage.height,
            });
        }

        const pdfBytes = await pdfDoc.save();

        // 9. Write audit log entry (must succeed before returning PDF bytes)
        const clientIp =
            req.headers.get('x-forwarded-for') ||
            req.headers.get('x-real-ip') ||
            undefined;

        const auditSuccess = await writeAuditLog({
            user: auth.user.id,
            action: 'STUDENT_PDF_EXPORT',
            outcome: 'SUCCESS',
            entityId: script._id,
            entityType: 'AnswerScript',
            ipAddress: clientIp,
            details: {
                scriptId,
                examId: exam._id.toString(),
                pageCount: scriptPages.length,
                hasRollNumber: Boolean(rollNumber),
            },
        });

        if (!auditSuccess) {
            return NextResponse.json(
                { success: false, message: 'Export failed' },
                { status: 500, headers: SECURITY_HEADERS }
            );
        }

        // Record successful export for per-student rate limit
        recordStudentExport(auth.user.id);

        return new NextResponse(new Uint8Array(pdfBytes), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="graded-script-${scriptId}.pdf"`,
                'Content-Length': pdfBytes.length.toString(),
                ...SECURITY_HEADERS,
            },
        });
    } catch (error: unknown) {
        if (error instanceof PdfExportCapacityError) {
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

        const status = error instanceof HttpError ? error.statusCode : 500;
        const message =
            status === 401
                ? 'Unauthorized'
                : status === 403
                ? 'Forbidden'
                : status === 404
                ? 'Not found'
                : status === 422
                ? error instanceof Error
                    ? error.message
                    : 'Unprocessable Entity'
                : 'Export failed';

        return NextResponse.json(
            { success: false, message },
            {
                status: status >= 400 && status < 600 ? status : 500,
                headers: SECURITY_HEADERS,
            }
        );
    } finally {
        if (releaseSlot) {
            releaseSlot();
        }
    }
}
