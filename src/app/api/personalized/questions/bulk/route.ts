import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import bulkQuestionImportService, {
    ValidatedBulkQuestionItem
} from '../../../../../services/BulkQuestionImportService';
import Course from '../../../../../models/Course';
import { requireAuth, requireFeature } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';

export async function POST(req: NextRequest) {
    const featureCheck = requireFeature('PERSONALIZED_ASSESSMENT');
    if (!featureCheck.authorized) {
        return (
            featureCheck.response ??
            NextResponse.json(
                { success: false, message: 'Personalized assessment feature is disabled', data: null },
                { status: 404 }
            )
        );
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
        return NextResponse.json(
            { success: false, message: 'Forbidden: Only professors or admins can import questions', data: null },
            { status: 403 }
        );
    }

    try {
        await connectDB();

        let courseId = '';
        let action: 'preview' | 'commit' = 'preview';
        let defaultTopic = 'General';
        let content = '';
        let filename = '';
        let directItems: ValidatedBulkQuestionItem[] | null = null;

        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            const formData = await req.formData();
            courseId = (formData.get('courseId') as string) || '';
            action = ((formData.get('action') as string) || 'preview') as 'preview' | 'commit';
            defaultTopic = (formData.get('defaultTopic') as string) || 'General';

            const file = formData.get('file');
            if (file && file instanceof File) {
                filename = file.name;
                content = await file.text();
            }
        } else {
            let body: Record<string, unknown> = {};
            try {
                body = await req.json();
            } catch {
                return NextResponse.json(
                    { success: false, message: 'Invalid JSON request body', data: null },
                    { status: 400 }
                );
            }

            courseId = (body.courseId as string) || '';
            action = ((body.action as string) || 'preview') as 'preview' | 'commit';
            defaultTopic = (body.defaultTopic as string) || 'General';
            content = (body.content as string) || '';
            filename = (body.filename as string) || '';

            if (Array.isArray(body.items)) {
                directItems = body.items as ValidatedBulkQuestionItem[];
            }
        }

        if (!courseId) {
            return NextResponse.json(
                { success: false, message: 'courseId is required', data: null },
                { status: 400 }
            );
        }

        // Verify course existence and ownership
        const course = await Course.findById(courseId);
        if (!course) {
            return NextResponse.json(
                { success: false, message: 'Course not found', data: null },
                { status: 404 }
            );
        }

        if (auth.user.role === 'PROFESSOR' && course.professor.toString() !== auth.user.id) {
            return NextResponse.json(
                { success: false, message: 'Forbidden: You are not authorized to manage questions for this course', data: null },
                { status: 403 }
            );
        }

        const auditCtx = {
            actingUserId: auth.user.id,
            actingUserRole: auth.user.role,
            ipAddress: req.headers.get('x-forwarded-for') || undefined
        };

        // 1. ACTION: PREVIEW & VALIDATE
        if (action === 'preview') {
            if (!content && !directItems) {
                return NextResponse.json(
                    { success: false, message: 'File or content string is required for question preview', data: null },
                    { status: 400 }
                );
            }

            const rawQuestions = content
                ? bulkQuestionImportService.parseContent(content, filename)
                : directItems || [];

            const preview = await bulkQuestionImportService.validateQuestions(
                rawQuestions,
                courseId,
                defaultTopic
            );

            return NextResponse.json(
                {
                    success: true,
                    message: `${preview.totalFound} questions found (${preview.validCount} valid, ${preview.invalidCount} invalid, ${preview.duplicateCount} duplicate)`,
                    data: preview
                },
                { status: 200 }
            );
        }

        // 2. ACTION: COMMIT IMPORT
        if (action === 'commit') {
            let itemsToCommit: ValidatedBulkQuestionItem[] = [];

            if (directItems && Array.isArray(directItems) && directItems.length > 0) {
                itemsToCommit = directItems;
            } else if (content) {
                const rawQuestions = bulkQuestionImportService.parseContent(content, filename);
                const preview = await bulkQuestionImportService.validateQuestions(
                    rawQuestions,
                    courseId,
                    defaultTopic
                );
                itemsToCommit = preview.items;
            } else {
                return NextResponse.json(
                    { success: false, message: 'No questions provided to import', data: null },
                    { status: 400 }
                );
            }

            const result = await bulkQuestionImportService.commitImport(
                courseId,
                auth.user.id,
                itemsToCommit,
                auditCtx
            );

            return NextResponse.json(
                {
                    success: true,
                    message: `Successfully imported ${result.importedCount} questions with PENDING organization status`,
                    data: result
                },
                { status: 201 }
            );
        }

        return NextResponse.json(
            { success: false, message: `Unsupported action "${action}". Must be preview or commit`, data: null },
            { status: 400 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            { success: false, message, data: null },
            { status }
        );
    }
}
