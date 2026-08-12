import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import defaultCoverSheetService from '../../../../../services/CoverSheetService';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.EDIT_EXAM);
    if (!auth.authorized) {
        return auth.response;
    }

    const { id } = await context.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json(
            {
                success: false,
                message: 'Invalid Exam ID format',
                data: null
            },
            { status: 400 }
        );
    }

    try {
        await connectDB();

        let body: { studentIds?: string[] } = {};
        const contentType = req.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try {
                body = await req.json();
            } catch {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'Invalid JSON request body',
                        data: null
                    },
                    { status: 400 }
                );
            }
        }

        const auditContext = {
            actingUserId: auth.user.id,
            actingUserRole: auth.user.role,
            ipAddress:
                (req as NextRequest & { ip?: string }).ip ||
                req.headers.get('x-forwarded-for') ||
                req.headers.get('x-real-ip') ||
                undefined
        };

        const pdfBuffer = await defaultCoverSheetService.generateCoverSheets(
            id,
            body,
            auditContext
        );

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="coversheets-${id}.pdf"`,
                'Content-Length': pdfBuffer.length.toString()
            }
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            {
                success: false,
                message,
                data: null
            },
            { status }
        );
    }
}
