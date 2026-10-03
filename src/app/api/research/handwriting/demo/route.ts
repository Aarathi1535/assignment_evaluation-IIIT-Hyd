import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '../../../../../constants/permissions';
import { requireAuth, requireFeature } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import {
    HandwritingDemoAction,
    handwritingDemoService
} from '../../../../../services/handwriting/HandwritingDemoService';

const ACTIONS: HandwritingDemoAction[] = ['load', 'analyze'];

function isDemoAction(value: unknown): value is HandwritingDemoAction {
    return ACTIONS.some((action) => action === value);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const featureCheck = requireFeature('HANDWRITING_CONSISTENCY');
    if (!featureCheck.authorized) {
        return featureCheck.response;
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }
    const permittedRoles = [UserRole.ADMIN, UserRole.PROFESSOR];
    if (!permittedRoles.includes(auth.user.role?.toUpperCase() as UserRole)) {
        return NextResponse.json(
            { success: false, message: 'Forbidden: only Professor or Admin users may run the handwriting research demo', data: null },
            { status: 403 }
        );
    }

    let parsedBody: unknown;
    try {
        parsedBody = await req.json();
    } catch {
        return NextResponse.json(
            { success: false, message: 'Request body must be valid JSON', data: null },
            { status: 400 }
        );
    }

    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
        return NextResponse.json(
            { success: false, message: 'Request body must be a JSON object', data: null },
            { status: 400 }
        );
    }
    const body = parsedBody as Record<string, unknown>;

    if ('candidateStyle' in body || 'expectedResult' in body) {
        return NextResponse.json(
            { success: false, message: 'The demo analyzes the complete answer sheet without an expected-result input', data: null },
            { status: 400 }
        );
    }

    if (!isDemoAction(body.action)) {
        return NextResponse.json(
            { success: false, message: 'action must be load or analyze', data: null },
            { status: 400 }
        );
    }

    try {
        const data = await handwritingDemoService.run(body.action);
        return NextResponse.json(
            { success: true, message: 'Handwriting research demo completed', data },
            { status: 200 }
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
