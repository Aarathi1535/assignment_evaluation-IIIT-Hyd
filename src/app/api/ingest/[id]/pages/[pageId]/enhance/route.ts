import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../../../lib/db';
import pageIngestionService from '../../../../../../../services/PageIngestionService';
import { requirePermission } from '../../../../../../../lib/apiAuth';
import { Permission } from '../../../../../../../constants/permissions';
import { HttpError } from '../../../../../../../lib/errors';

export async function PUT(
    req: NextRequest,
    context: { params: Promise<{ id: string; pageId: string }> }
) {
    const auth = await requirePermission(Permission.CREATE_BATCH);
    if (!auth.authorized) {
        return auth.response;
    }

    const { id: batchId, pageId } = await context.params;

    if (!batchId || !pageId) {
        return NextResponse.json(
            { success: false, message: 'Invalid batch ID or page ID', data: null },
            { status: 400 }
        );
    }

    try {
        const body = await req.json();
        const { deskewAngle, orientation, brightness, contrast } = body;

        // At least one parameter must be present, but all can be 0 or normal values
        if (deskewAngle === undefined && orientation === undefined && brightness === undefined && contrast === undefined) {
            return NextResponse.json(
                { success: false, message: 'Missing enhancement parameters', data: null },
                { status: 400 }
            );
        }

        const params = {
            deskewAngle: deskewAngle !== undefined ? Number(deskewAngle) : undefined,
            orientation: orientation !== undefined ? Number(orientation) : undefined,
            brightness: brightness !== undefined ? Number(brightness) : undefined,
            contrast: contrast !== undefined ? Number(contrast) : undefined,
        };

        if ((params.deskewAngle !== undefined && isNaN(params.deskewAngle)) ||
            (params.orientation !== undefined && isNaN(params.orientation)) ||
            (params.brightness !== undefined && isNaN(params.brightness)) ||
            (params.contrast !== undefined && isNaN(params.contrast))) {
            return NextResponse.json(
                { success: false, message: 'Invalid enhancement parameters', data: null },
                { status: 400 }
            );
        }

        await connectDB();
        
        // Pass X-Forwarded-For or remote IP for audit logs
        const ipAddress = req.headers.get('x-forwarded-for') || undefined;

        const result = await pageIngestionService.updateEnhancementParams(pageId, params, auth.user.id, ipAddress);

        return NextResponse.json(
            {
                success: true,
                message: 'Enhancement parameters updated successfully',
                data: result.pageRecord
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        
        if (message.includes('not found') || message.includes('Missing')) {
            return NextResponse.json({ success: false, message, data: null }, { status: 404 });
        }
        
        return NextResponse.json(
            { success: false, message, data: null },
            { status }
        );
    }
}
