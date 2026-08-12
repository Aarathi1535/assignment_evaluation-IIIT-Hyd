import mongoose from 'mongoose';
import { PDFDocument, PageSizes, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import * as zxing from '@zxing/library';
import ExamRepository from '../repositories/ExamRepository';
import Exam, { IExam } from '../models/Exam';
import Course, { ICourse } from '../models/Course';
import User, { IUser } from '../models/User';
import StudentMapping from '../models/StudentMapping';
import { HttpError } from '../lib/errors';
import { writeAuditLog } from '../lib/audit';

export interface AuditContext {
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

export interface GenerateCoverSheetsOptions {
    studentIds?: string[];
}

export class CoverSheetService {
    /**
     * Generates a printable A4 PDF containing one cover sheet per enrolled student.
     * Each page contains a scannable QR code encoding `examId:studentId`.
     * 
     * Security & Design Decision:
     * QR payloads in AE-052 use the deterministic, unsigned format `${examId}:${studentId}`.
     * Unsigned payloads are an intentional design decision to allow transparent decoding
     * and inspection by cover sheet detectors without requiring external cryptographic key
     * distribution or HMAC validation at the scanning stage.
     */
    async generateCoverSheets(
        examId: string,
        options: GenerateCoverSheetsOptions = {},
        context: AuditContext
    ): Promise<Buffer> {
        if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }

        // 1. Owner authorization check (deny-by-default: unauthorized returns 404)
        const authorizedExam = await ExamRepository.getExamById(
            examId,
            context.actingUserId,
            context.actingUserRole
        );

        if (!authorizedExam) {
            throw new HttpError('Exam not found', 404);
        }

        const exam = await Exam.findById(examId);
        if (!exam || !exam.isActive) {
            throw new HttpError('Exam not found', 404);
        }

        // 2. Fetch associated course for display metadata
        let course: ICourse | null = null;
        if (exam.course) {
            course = await Course.findById(exam.course);
        }

        // 3. Aggregate all enrolled student IDs for the exam
        const enrolledStudentIdSet = new Set<string>();

        if (exam.enrolledStudents && Array.isArray(exam.enrolledStudents)) {
            for (const sId of exam.enrolledStudents) {
                if (sId) enrolledStudentIdSet.add(sId.toString());
            }
        }

        const mappings = await StudentMapping.find({ exam: exam._id });
        for (const m of mappings) {
            if (m.student) enrolledStudentIdSet.add(m.student.toString());
        }

        if (course?.enrolledStudents && Array.isArray(course.enrolledStudents)) {
            for (const sId of course.enrolledStudents) {
                if (sId) enrolledStudentIdSet.add(sId.toString());
            }
        }

        // 4. Validate requested student IDs or resolve all enrolled students
        let targetStudentIds: string[] = [];

        if (options.studentIds !== undefined) {
            if (!Array.isArray(options.studentIds) || options.studentIds.length === 0) {
                throw new HttpError('studentIds array must not be empty if provided', 400);
            }

            for (const reqId of options.studentIds) {
                if (!mongoose.Types.ObjectId.isValid(reqId)) {
                    throw new HttpError(`Invalid student ID format: ${reqId}`, 400);
                }
                if (!enrolledStudentIdSet.has(reqId)) {
                    throw new HttpError(`Student ${reqId} is not enrolled in this exam roster`, 400);
                }
            }

            targetStudentIds = Array.from(new Set(options.studentIds));
        } else {
            targetStudentIds = Array.from(enrolledStudentIdSet);
        }

        if (targetStudentIds.length === 0) {
            throw new HttpError('No enrolled students found for this exam', 400);
        }

        // 5. Configurable request generation limit
        const maxLimit = parseInt(process.env.MAX_COVER_SHEETS_PER_REQUEST || '100', 10);
        if (targetStudentIds.length > maxLimit) {
            throw new HttpError(
                `Requested cover sheet count (${targetStudentIds.length}) exceeds the maximum limit of ${maxLimit} per request`,
                400
            );
        }

        // 6. Fetch full active user documents for target students
        const targetStudents = await User.find({
            _id: { $in: targetStudentIds.map(id => new mongoose.Types.ObjectId(id)) },
            isActive: true
        });

        if (targetStudents.length === 0) {
            throw new HttpError('No active enrolled student records found', 400);
        }

        // Sort students deterministically by name / id
        targetStudents.sort((a, b) => a.name.localeCompare(b.name) || a._id.toString().localeCompare(b._id.toString()));

        // 7. Generate printable A4 PDF (exactly 1 page per student)
        const pdfBuffer = await this.renderCoverSheetsPdf(exam, course, targetStudents);

        // 8. Audit log
        if (context.actingUserId) {
            await writeAuditLog({
                user: context.actingUserId,
                action: 'COVER_SHEETS_GENERATED',
                outcome: 'SUCCESS',
                entityType: 'Exam',
                entityId: examId,
                details: {
                    examId,
                    studentCount: targetStudents.length,
                    studentIds: targetStudents.map(s => s._id.toString())
                }
            });
        }

        return pdfBuffer;
    }

    /**
     * Internal renderer producing standard A4 pages with scannable QR codes.
     */
    private async renderCoverSheetsPdf(
        exam: IExam,
        course: ICourse | null,
        students: IUser[]
    ): Promise<Buffer> {
        const pdfDoc = await PDFDocument.create();
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontMono = await pdfDoc.embedFont(StandardFonts.CourierBold);

        const writer = new zxing.QRCodeWriter();
        const hints = new Map<zxing.EncodeHintType, unknown>();
        hints.set(zxing.EncodeHintType.MARGIN, 2);

        for (const student of students) {
            // A4 page dimensions in points: 595.28 x 841.89
            const page = pdfDoc.addPage(PageSizes.A4);
            const { width, height } = page.getSize();

            // Contract payload: examId:studentId (strictly User._id)
            const payload = `${exam._id.toString()}:${student._id.toString()}`;

            // Generate high-contrast QR PNG
            const qrMatrix = writer.encode(payload, zxing.BarcodeFormat.QR_CODE, 150, 150, hints);
            const canvasSize = 400;
            const canvas = createCanvas(canvasSize, canvasSize);
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvasSize, canvasSize);

            const qrW = qrMatrix.getWidth();
            const qrH = qrMatrix.getHeight();
            const cellSize = Math.floor(canvasSize / qrW);
            const offset = Math.floor((canvasSize - cellSize * qrW) / 2);

            ctx.fillStyle = '#000000';
            for (let x = 0; x < qrW; x++) {
                for (let y = 0; y < qrH; y++) {
                    if (qrMatrix.get(x, y)) {
                        ctx.fillRect(offset + x * cellSize, offset + y * cellSize, cellSize, cellSize);
                    }
                }
            }

            const qrPngBuffer = canvas.toBuffer('image/png');
            const qrImage = await pdfDoc.embedPng(qrPngBuffer);

            // --- PAGE DRAWING ---
            const margin = 40;
            const contentWidth = width - margin * 2;

            // Outer border
            page.drawRectangle({
                x: margin,
                y: margin,
                width: contentWidth,
                height: height - margin * 2,
                borderWidth: 1.5,
                borderColor: rgb(0.15, 0.2, 0.3),
                color: rgb(0.99, 0.99, 1.0)
            });

            // Header banner
            page.drawRectangle({
                x: margin,
                y: height - margin - 65,
                width: contentWidth,
                height: 65,
                color: rgb(0.1, 0.18, 0.35)
            });

            page.drawText('EXAMINATION COVER SHEET', {
                x: margin + 20,
                y: height - margin - 35,
                size: 18,
                font: fontBold,
                color: rgb(1, 1, 1)
            });

            page.drawText('Automated Assignment Evaluation System', {
                x: margin + 20,
                y: height - margin - 52,
                size: 10,
                font: fontRegular,
                color: rgb(0.85, 0.9, 1.0)
            });

            // Exam Info Section
            let cursorY = height - margin - 90;

            page.drawText('EXAM DETAILS', {
                x: margin + 20,
                y: cursorY,
                size: 11,
                font: fontBold,
                color: rgb(0.1, 0.18, 0.35)
            });

            cursorY -= 18;
            page.drawText(`Exam Title:`, { x: margin + 20, y: cursorY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
            page.drawText(`${exam.title}`, { x: margin + 110, y: cursorY, size: 10, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });

            if (course) {
                cursorY -= 15;
                page.drawText(`Course:`, { x: margin + 20, y: cursorY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
                page.drawText(`${course.courseCode} - ${course.courseName}`, { x: margin + 110, y: cursorY, size: 10, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
            }

            cursorY -= 15;
            const examDateStr = exam.examDate ? new Date(exam.examDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
            page.drawText(`Exam Date:`, { x: margin + 20, y: cursorY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
            page.drawText(`${examDateStr}`, { x: margin + 110, y: cursorY, size: 10, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });

            page.drawText(`Total Marks:`, { x: margin + 280, y: cursorY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
            page.drawText(`${exam.totalMarks}`, { x: margin + 355, y: cursorY, size: 10, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });

            // Student Info Box
            cursorY -= 35;
            page.drawRectangle({
                x: margin + 15,
                y: cursorY - 60,
                width: contentWidth - 30,
                height: 75,
                color: rgb(0.94, 0.96, 0.99),
                borderColor: rgb(0.75, 0.82, 0.92),
                borderWidth: 1
            });

            page.drawText('CANDIDATE IDENTIFICATION', {
                x: margin + 25,
                y: cursorY + 2,
                size: 10,
                font: fontBold,
                color: rgb(0.1, 0.18, 0.35)
            });

            cursorY -= 16;
            page.drawText(`Student Name:`, { x: margin + 25, y: cursorY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
            page.drawText(`${student.name}`, { x: margin + 120, y: cursorY, size: 10, font: fontBold, color: rgb(0.0, 0.25, 0.6) });

            cursorY -= 15;
            page.drawText(`Student ID:`, { x: margin + 25, y: cursorY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
            page.drawText(`${student._id.toString()}`, { x: margin + 120, y: cursorY, size: 10, font: fontMono, color: rgb(0.1, 0.1, 0.1) });

            cursorY -= 15;
            page.drawText(`Email:`, { x: margin + 25, y: cursorY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
            page.drawText(`${student.email}`, { x: margin + 120, y: cursorY, size: 10, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });

            // QR Code Center Section
            const qrDisplaySize = 220;
            const qrX = (width - qrDisplaySize) / 2;
            const qrY = cursorY - 265;

            page.drawRectangle({
                x: qrX - 10,
                y: qrY - 10,
                width: qrDisplaySize + 20,
                height: qrDisplaySize + 20,
                color: rgb(1, 1, 1),
                borderColor: rgb(0.7, 0.75, 0.85),
                borderWidth: 1.5
            });

            page.drawImage(qrImage, {
                x: qrX,
                y: qrY,
                width: qrDisplaySize,
                height: qrDisplaySize
            });

            page.drawText(`SCAN IDENTIFIER: ${payload}`, {
                x: margin + 20,
                y: qrY - 25,
                size: 8,
                font: fontMono,
                color: rgb(0.4, 0.45, 0.5)
            });

            // Instructions Box
            const instrY = margin + 25;
            page.drawRectangle({
                x: margin + 15,
                y: instrY,
                width: contentWidth - 30,
                height: 110,
                color: rgb(0.98, 0.98, 0.98),
                borderColor: rgb(0.85, 0.85, 0.85),
                borderWidth: 1
            });

            page.drawText('IMPORTANT SUBMISSION INSTRUCTIONS', {
                x: margin + 25,
                y: instrY + 92,
                size: 9,
                font: fontBold,
                color: rgb(0.7, 0.15, 0.15)
            });

            const instructions = [
                '1. This cover sheet MUST remain as PAGE 1 of your submitted physical or digital assignment.',
                '2. Do NOT fold, staple through, write on, or obscure the QR code in any way.',
                '3. Answers must begin on Page 2 and follow sequential numbering.',
                '4. Each scanned booklet must contain only ONE candidate\'s cover sheet and answer pages.'
            ];

            let instLineY = instrY + 74;
            for (const line of instructions) {
                page.drawText(line, {
                    x: margin + 25,
                    y: instLineY,
                    size: 8,
                    font: fontRegular,
                    color: rgb(0.25, 0.25, 0.25)
                });
                instLineY -= 14;
            }
        }

        const savedBytes = await pdfDoc.save();
        return Buffer.from(savedBytes);
    }
}

export const defaultCoverSheetService = new CoverSheetService();
export default defaultCoverSheetService;
