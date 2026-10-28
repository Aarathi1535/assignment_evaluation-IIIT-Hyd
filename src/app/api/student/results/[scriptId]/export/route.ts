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
    WatermarkCapacityError,
} from '../../../../../../lib/watermark';
import {
    compositePageAnnotations,
} from '../../../../../../services/AnnotationCompositor';
import { getStudentPageAnnotations } from '../../../../../../lib/studentAnnotations';
import {
    checkStudentExportRateLimit,
    ExportTimeoutError,
    getExportDeadlineMs,
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
        // DISABLED means no official PDF download is available. It cannot prevent viewing, screenshots,
        // screen capture, or saving visible images; that is why viewer images remain watermarked.
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

        // 4. Instance-wide concurrency capacity (1 export slot + 1 shared watermark render slot)
        try {
            releaseSlot = tryAcquirePdfExportSlot();
        } catch (slotErr) {
            if (
                slotErr instanceof PdfExportCapacityError ||
                slotErr instanceof WatermarkCapacityError
            ) {
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

        // 5. Total export deadline setup (~60 seconds budget)
        const deadline = Date.now() + getExportDeadlineMs();

        // 6. Fetch script pages in expected page order (skipping duplicate ingestion pages)
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

        // 7. Enforce maximum 40 pages per export
        if (scriptPages.length > MAX_EXPORT_PAGES) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Export exceeds maximum allowed page count (${MAX_EXPORT_PAGES} pages)`,
                },
                { status: 422, headers: SECURITY_HEADERS }
            );
        }

        // 8. Resolve student roll number if available
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

        // Consistent issuance timestamp across all exported pages for exact audit traceability
        const now = new Date();
        const istTimestamp = formatISTDateTime(now);
        const issuedAt = now.toISOString();
        const traceCodes: Array<{ pageId: string; traceCode: string }> = [];

        // 9. Build PDF document using pdf-lib
        // NOTE: The complete PDF is held in memory in Node.js before delivery (`pdfDoc.save()`)
        // rather than streamed over HTTP chunk-by-chunk. Memory consumption is strictly bounded by
        // MAX_EXPORT_PAGES (40), per-page dimension limits, lossless PNG compositing, 60s deadline,
        // and shared render concurrency slots.
        const pdfDoc = await PDFDocument.create();

        for (const page of scriptPages) {
            // Check overall export deadline boundary before processing page
            if (Date.now() >= deadline) {
                throw new ExportTimeoutError('PDF export timed out. Please retry shortly.', 5);
            }

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

            // Check deadline before storage read & compositing
            if (Date.now() >= deadline) {
                throw new ExportTimeoutError('PDF export timed out. Please retry shortly.', 5);
            }

            // Read original derived page safely
            const rawBuffer = await DerivedStorageService.readDerivedPage(storageKey);

            // Fetch annotations for this exact physical page using shared viewer helper
            // Guarantees 100% parity with what the student sees in the viewer and prevents
            // cross-file mark collisions from repeating pageNumber across files
            const pageAnnotationsToComposite =
                (await getStudentPageAnnotations(script._id, page._id)) || {
                    annotations: [],
                    strokes: [],
                };

            // Composite vector annotations onto source image
            // Uses format: 'png' to avoid unnecessary double JPEG compression artifacts,
            // producing a clean lossless intermediate before final JPEG watermarking
            const annotatedBuffer = await compositePageAnnotations(
                rawBuffer,
                pageAnnotationsToComposite,
                { format: 'png' }
            );

            // Generate watermark trace code and text
            const pageIdStr = page._id.toString();
            const traceCode = generateTraceCode({
                userId: auth.user.id,
                scriptId,
                pageId: pageIdStr,
                issuedAt,
            });
            traceCodes.push({ pageId: pageIdStr, traceCode });

            const watermarkText = buildWatermarkText({
                rollNumber,
                timestamp: istTimestamp,
                traceCode,
            });

            // Burn watermark into annotated image (single JPEG encoding at quality 80)
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

        // 10. Write audit log entry (must succeed before returning PDF bytes)
        // Records exact issuedAt timestamp and per-page traceCodes for complete traceability
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
                issuedAt,
                traceCodes,
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
        if (
            error instanceof PdfExportCapacityError ||
            error instanceof WatermarkCapacityError ||
            error instanceof ExportTimeoutError
        ) {
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
