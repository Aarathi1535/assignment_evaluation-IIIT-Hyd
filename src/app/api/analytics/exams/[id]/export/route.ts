import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { Permission, UserRole } from '../../../../../../constants/permissions';
import { requirePermission } from '../../../../../../lib/apiAuth';
import { connectDB } from '../../../../../../lib/db';
import { ExamStatus } from '../../../../../../models/Exam';
import ExamRepository from '../../../../../../repositories/ExamRepository';
import { buildCsv, buildXlsx, getExamGradeExportData } from '../../../../../../lib/gradeExport';
import { buildLmsCsv, mapLmsStudentIdsToGrades } from '../../../../../../lib/lmsMapping';

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
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

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json(
            { success: false, message: 'Invalid exam ID', data: null },
            { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    const formatParam = request.nextUrl.searchParams.get('format') || 'csv';
    const format = formatParam.toLowerCase();
    if (format !== 'csv' && format !== 'xlsx' && format !== 'lms' && format !== 'canvas') {
        return NextResponse.json(
            { success: false, message: 'Invalid export format. Supported formats: csv, xlsx, lms, canvas', data: null },
            { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    try {
        await connectDB();
        const exam = await ExamRepository.getExamById(id, auth.user.id, auth.user.role);
        if (!exam) {
            return NextResponse.json(
                { success: false, message: 'Exam not found', data: null },
                { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
            );
        }

        if (!exam.isActive || exam.status !== ExamStatus.PUBLISHED) {
            return NextResponse.json(
                { success: false, message: 'Grade export is available only for published exams', data: null },
                { status: 409, headers: { 'Cache-Control': 'private, no-store' } }
            );
        }

        if (format === 'lms' || format === 'canvas') {
            const lmsResult = await mapLmsStudentIdsToGrades(exam);
            const csvContent = buildLmsCsv(lmsResult, format === 'canvas' ? 'canvas' : 'standard');
            return new NextResponse(csvContent, {
                status: 200,
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="exam-${id}-lms-${format}.csv"`,
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff'
                }
            });
        }

        const exportData = await getExamGradeExportData(exam);

        if (format === 'xlsx') {
            const buffer = buildXlsx(exportData.headers, exportData.rows);
            return new NextResponse(new Uint8Array(buffer), {
                status: 200,
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': `attachment; filename="exam-${id}-grades.xlsx"`,
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff'
                }
            });
        }

        const csvContent = buildCsv(exportData.headers, exportData.rows);
        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="exam-${id}-grades.csv"`,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff'
            }
        });
    } catch (error: unknown) {
        console.error('Failed to export exam grades:', error);
        return NextResponse.json(
            { success: false, message: 'Could not export exam grades', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}

