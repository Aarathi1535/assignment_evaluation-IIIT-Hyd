import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import zlib from 'node:zlib';
import * as apiAuth from '../lib/apiAuth';
import { UserRole } from '../constants/permissions';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import StudentMapping from '../models/StudentMapping';
import { GET } from '../app/api/analytics/exams/[id]/export/route';
import {
    buildCsv,
    buildXlsx,
    colToLetter,
    sanitizeSpreadsheetCell
} from '../lib/gradeExport';

describe('AE-214 exam grade export (CSV & XLSX)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Spreadsheet utilities & formula injection protection', () => {
        it('prefixes formula injection characters with a single quote', () => {
            expect(sanitizeSpreadsheetCell('=1+1')).toBe("'=1+1");
            expect(sanitizeSpreadsheetCell('+cmd|/C')).toBe("'+cmd|/C");
            expect(sanitizeSpreadsheetCell('-100')).toBe("'-100");
            expect(sanitizeSpreadsheetCell('@SUM(A1:B1)')).toBe("'@SUM(A1:B1)");
            expect(sanitizeSpreadsheetCell('\t=cmd')).toBe("'\t=cmd");
            expect(sanitizeSpreadsheetCell('\r=calc')).toBe("'\r=calc");
            expect(sanitizeSpreadsheetCell('  =padded')).toBe("'  =padded");

            // Benign values
            expect(sanitizeSpreadsheetCell('Alice Smith')).toBe('Alice Smith');
            expect(sanitizeSpreadsheetCell('2026-CS-01')).toBe('2026-CS-01');
            expect(sanitizeSpreadsheetCell(85.5)).toBe('85.5');
            expect(sanitizeSpreadsheetCell(null)).toBe('');
            expect(sanitizeSpreadsheetCell(undefined)).toBe('');
        });

        it('maps 1-based column indices to Excel column letters', () => {
            expect(colToLetter(1)).toBe('A');
            expect(colToLetter(2)).toBe('B');
            expect(colToLetter(26)).toBe('Z');
            expect(colToLetter(27)).toBe('AA');
            expect(colToLetter(28)).toBe('AB');
            expect(colToLetter(52)).toBe('AZ');
            expect(colToLetter(53)).toBe('BA');
        });

        it('generates an empty CSV with only header row when no data rows exist', () => {
            const csv = buildCsv(['Name', 'Score'], []);
            expect(csv).toBe('"Name","Score"\r\n');
        });

        it('generates a valid ZIP/XLSX buffer for empty rows', () => {
            const buffer = buildXlsx(['Name', 'Score'], []);
            expect(buffer.subarray(0, 4).toString('hex')).toBe('504b0304');
        });
    });

    describe('Authorized CSV and XLSX exports API', () => {
        async function createExamFixture() {
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

            const professor = await User.create({
                name: 'Professor Owner',
                email: `prof-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const otherProfessor = await User.create({
                name: 'Professor Other',
                email: `other-prof-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const ta = await User.create({
                name: 'TA Grader',
                email: `ta-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.TA,
                isActive: true
            });

            // Student 1: Normal student
            const student1 = await User.create({
                name: 'Alice Cooper',
                email: `alice-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Student 2: Potential formula injection in name and roll number
            const student2 = await User.create({
                name: '=cmd|"/C calc"!A0',
                email: `bob-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Student 3: Incomplete/unfinalized student (should NOT be exported)
            const student3 = await User.create({
                name: 'Charlie Incomplete',
                email: `charlie-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            const course = await Course.create({
                courseCode: `CS-${suffix}`,
                courseName: 'Data Structures',
                academicYear: '2026-2027',
                semester: 1,
                professor: professor._id,
                enrolledStudents: [student1._id, student2._id, student3._id],
                teachingAssistants: [ta._id],
                isActive: true
            });

            const exam = await Exam.create({
                title: `Midterm Exam ${suffix}`,
                course: course._id,
                createdBy: professor._id,
                examDate: new Date('2026-11-01'),
                totalMarks: 30,
                numberOfQuestions: 2,
                status: ExamStatus.PUBLISHED,
                isActive: true
            });

            const rubric = await Rubric.create({
                exam: exam._id,
                createdBy: professor._id,
                scoreStep: 0.5,
                questions: [
                    {
                        questionNumber: 1,
                        maxMarks: 10,
                        criteria: [{ criterionName: 'Correctness', points: 10 }]
                    },
                    {
                        questionNumber: 2,
                        maxMarks: 20,
                        criteria: [{ criterionName: 'Efficiency', points: 20 }]
                    }
                ],
                isActive: true
            });

            // Student 1 mappings & script
            await StudentMapping.create({
                exam: exam._id,
                student: student1._id,
                anonymousId: `ANON-1-${suffix}`,
                rollNumber: 'CS2026001',
                isVerified: true
            });

            const script1 = await AnswerScript.create({
                exam: exam._id,
                student: student1._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });

            await Grade.create([
                {
                    answerScript: script1._id,
                    rubric: rubric._id,
                    gradedBy: professor._id,
                    question: 1,
                    marksAwarded: [{ criterionName: 'Correctness', score: 8 }],
                    totalScore: 8,
                    isFinal: true
                },
                {
                    answerScript: script1._id,
                    rubric: rubric._id,
                    gradedBy: professor._id,
                    question: 2,
                    marksAwarded: [{ criterionName: 'Efficiency', score: 17 }],
                    totalScore: 17,
                    isFinal: true
                }
            ]);

            // Student 2 mappings & script (formula injection values)
            await StudentMapping.create({
                exam: exam._id,
                student: student2._id,
                anonymousId: `ANON-2-${suffix}`,
                rollNumber: '+9999999',
                isVerified: true
            });

            const script2 = await AnswerScript.create({
                exam: exam._id,
                student: student2._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });

            await Grade.create([
                {
                    answerScript: script2._id,
                    rubric: rubric._id,
                    gradedBy: professor._id,
                    question: 1,
                    marksAwarded: [{ criterionName: 'Correctness', score: 9 }],
                    totalScore: 9,
                    isFinal: true
                },
                {
                    answerScript: script2._id,
                    rubric: rubric._id,
                    gradedBy: professor._id,
                    question: 2,
                    marksAwarded: [{ criterionName: 'Efficiency', score: 15 }],
                    totalScore: 15,
                    isFinal: true
                }
            ]);

            // Student 3: Not finalized (isFinal: false) -> Should NOT appear in export
            const script3 = await AnswerScript.create({
                exam: exam._id,
                student: student3._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });

            await Grade.create({
                answerScript: script3._id,
                rubric: rubric._id,
                gradedBy: professor._id,
                question: 1,
                marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
                totalScore: 5,
                isFinal: false
            });

            return { professor, otherProfessor, ta, student1, student2, student3, exam, course, rubric };
        }

        it('exports published exam grades to valid CSV with question breakdown and student identifiers', async () => {
            const fixture = await createExamFixture();

            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                response: null,
                user: {
                    id: fixture.professor._id.toString(),
                    email: fixture.professor.email,
                    name: fixture.professor.name,
                    role: UserRole.PROFESSOR
                }
            });

            const response = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export?format=csv`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
            expect(response.headers.get('content-disposition')).toBe(`attachment; filename="exam-${fixture.exam._id}-grades.csv"`);
            expect(response.headers.get('cache-control')).toBe('private, no-store');
            expect(response.headers.get('x-content-type-options')).toBe('nosniff');

            const csv = await response.text();
            const lines = csv.trim().split('\r\n');

            // Header verification
            expect(lines[0]).toBe('"Student ID","Roll Number","Student Name","Email","Anonymous ID","Q1","Q2","Total Score","Max Marks","Percentage"');

            // Data rows verification
            expect(csv).toContain('Alice Cooper');
            expect(csv).toContain('CS2026001');
            expect(csv).toContain(fixture.student1.email);
            // Alice Cooper: Q1=8, Q2=17, Total=25, Max=30, Percentage=83.33
            expect(csv).toContain('25,30,83.33');

            // Student 3 (unfinalized) must NOT be exported
            expect(csv).not.toContain('Charlie Incomplete');
            expect(csv).not.toContain(fixture.student3.email);
        });

        it('protects against CSV and spreadsheet formula injection', async () => {
            const fixture = await createExamFixture();

            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                response: null,
                user: {
                    id: fixture.professor._id.toString(),
                    email: fixture.professor.email,
                    name: fixture.professor.name,
                    role: UserRole.PROFESSOR
                }
            });

            const response = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export?format=csv`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );

            expect(response.status).toBe(200);
            const csv = await response.text();

            // Formula injection in name: =cmd|"/C calc"!A0 should be escaped with leading single quote
            expect(csv).toContain(`"'=cmd|""/C calc""!A0"`);
            // Formula injection in roll number: +9999999 should be escaped with leading single quote
            expect(csv).toContain(`"'+9999999"`);
        });

        it('exports published exam grades to valid XLSX format', async () => {
            const fixture = await createExamFixture();

            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                response: null,
                user: {
                    id: fixture.professor._id.toString(),
                    email: fixture.professor.email,
                    name: fixture.professor.name,
                    role: UserRole.PROFESSOR
                }
            });

            const response = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export?format=xlsx`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            expect(response.headers.get('content-disposition')).toBe(`attachment; filename="exam-${fixture.exam._id}-grades.xlsx"`);

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Valid ZIP magic header: PK\x03\x04
            expect(buffer.subarray(0, 4).toString('hex')).toBe('504b0304');

            // Read the zip entries and verify OpenXML structure
            const zipContent = buffer.toString('binary');
            expect(zipContent).toContain('[Content_Types].xml');
            expect(zipContent).toContain('xl/workbook.xml');
            expect(zipContent).toContain('xl/worksheets/sheet1.xml');

            // Uncompress sheet1.xml to verify data & injection escaping
            // Search for local file header for xl/worksheets/sheet1.xml
            const filename = 'xl/worksheets/sheet1.xml';
            const offset = buffer.indexOf(filename);
            expect(offset).toBeGreaterThan(0);

            // Find data right after filename (offset + filename.length)
            const headerStart = offset - 30;
            const compSize = buffer.readUInt32LE(headerStart + 18);
            const dataStart = offset + filename.length;
            const compressedSheet = buffer.subarray(dataStart, dataStart + compSize);
            const sheetXml = zlib.inflateRawSync(compressedSheet).toString('utf8');

            expect(sheetXml).toContain('Alice Cooper');
            expect(sheetXml).toContain('&apos;=cmd|&quot;/C calc&quot;!A0'); // Escaped formula injection in XML
            expect(sheetXml).toContain('&apos;+9999999');
            expect(sheetXml).not.toContain('Charlie Incomplete');
        });

        it('enforces authentication and role authorization', async () => {
            const fixture = await createExamFixture();

            // 1. Unauthenticated -> 401
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: false,
                response: NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 }),
                user: null
            });

            const unauthResponse = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export?format=csv`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(unauthResponse.status).toBe(401);

            // 2. TA role -> 403 Forbidden
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                response: null,
                user: {
                    id: fixture.ta._id.toString(),
                    email: fixture.ta.email,
                    name: fixture.ta.name,
                    role: UserRole.TA
                }
            });

            const taResponse = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export?format=csv`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(taResponse.status).toBe(403);

            // 3. Student role -> 403 Forbidden
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                response: null,
                user: {
                    id: fixture.student1._id.toString(),
                    email: fixture.student1.email,
                    name: fixture.student1.name,
                    role: UserRole.STUDENT
                }
            });

            const studentResponse = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export?format=csv`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(studentResponse.status).toBe(403);

            // 4. Non-owning professor -> 404 (or 403)
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                response: null,
                user: {
                    id: fixture.otherProfessor._id.toString(),
                    email: fixture.otherProfessor.email,
                    name: fixture.otherProfessor.name,
                    role: UserRole.PROFESSOR
                }
            });

            const otherProfResponse = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export?format=csv`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(otherProfResponse.status).toBe(404);
        });

        it('validates export inputs: invalid ID, unpublished exam, invalid format', async () => {
            const fixture = await createExamFixture();

            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                response: null,
                user: {
                    id: fixture.professor._id.toString(),
                    email: fixture.professor.email,
                    name: fixture.professor.name,
                    role: UserRole.PROFESSOR
                }
            });

            // 1. Invalid MongoDB ObjectId format -> 400
            const invalidIdResponse = await GET(
                new NextRequest('http://localhost/api/analytics/exams/not-an-id/export?format=csv'),
                { params: Promise.resolve({ id: 'not-an-id' }) }
            );
            expect(invalidIdResponse.status).toBe(400);

            // 2. Non-existent exam ID -> 404
            const randomId = new mongoose.Types.ObjectId().toString();
            const notFoundResponse = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${randomId}/export?format=csv`),
                { params: Promise.resolve({ id: randomId }) }
            );
            expect(notFoundResponse.status).toBe(404);

            // 3. Unpublished exam (DRAFT) -> 409
            await Exam.findByIdAndUpdate(fixture.exam._id, { status: ExamStatus.DRAFT });
            const unpublishedResponse = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export?format=csv`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(unpublishedResponse.status).toBe(409);

            // Restore status to PUBLISHED
            await Exam.findByIdAndUpdate(fixture.exam._id, { status: ExamStatus.PUBLISHED });

            // 4. Invalid export format -> 400
            const badFormatResponse = await GET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export?format=json`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(badFormatResponse.status).toBe(400);
        });
    });
});

