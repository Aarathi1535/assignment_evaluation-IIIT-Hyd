import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { requireFeature, requirePermission } from '@/lib/apiAuth';
import { connectDB } from '@/lib/db';
import { Permission, UserRole } from '@/constants/permissions';
import { HttpError } from '@/lib/errors';
import ExamRepository from '@/repositories/ExamRepository';
import StudentRosterMappingService from '@/services/StudentRosterMappingService';

/** Search students using the same authorized exam-roster service as the Professor exam UI. */
export async function GET(request: NextRequest): Promise<NextResponse> {
    const featureCheck = requireFeature('HANDWRITING_CONSISTENCY');
    if (!featureCheck.authorized) return featureCheck.response;
    const auth = await requirePermission(Permission.VIEW_COURSES);
    if (!auth.authorized) return auth.response;
    const role = auth.user.role?.toUpperCase();
    if (role !== UserRole.PROFESSOR && role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, message: 'Professor access is required', data: null }, { status: 403 });
    }

    const examId = request.nextUrl.searchParams.get('examId') || '';
    const query = (request.nextUrl.searchParams.get('q') || '').trim().toLocaleLowerCase();
    if (!mongoose.Types.ObjectId.isValid(examId)) {
        return NextResponse.json({ success: false, message: 'A valid examId is required', data: null }, { status: 400 });
    }

    try {
        await connectDB();
        const exam = await ExamRepository.getExamById(examId, auth.user.id, role);
        if (!exam) throw new HttpError('Exam not found or access denied', 404);

        const roster = await StudentRosterMappingService.resolveEligibleExamRoster(exam);
        const hasStudents = roster.students.length > 0;
        const students = roster.students.flatMap(student => {
            const name = student.name || '';
            const email = student.email || '';
            if (query && !`${name} ${email}`.toLocaleLowerCase().includes(query)) return [];
            return [{ id: student._id.toString(), name, email }];
        }).slice(0, 50);

        return NextResponse.json({ success: true, data: { students, hasStudents } });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Could not search students';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json({ success: false, message, data: null }, { status });
    }
}
