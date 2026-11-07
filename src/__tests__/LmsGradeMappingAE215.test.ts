import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import * as apiAuth from '../lib/apiAuth';
import { UserRole } from '../constants/permissions';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import StudentMapping from '../models/StudentMapping';
import {
    GET as lmsExportGET,
    POST as lmsExportPOST
} from '../app/api/analytics/exams/[id]/export/lms/route';
import {
    buildLmsCsv,
    isValidGradeValue,
    isValidLmsIdentifier,
    mapLmsStudentIdsToGrades
} from '../lib/lmsMapping';

describe('AE-215 LMS student-ID to grade mapping', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Validation helpers', () => {
        it('validates LMS student identifiers correctly', () => {
            expect(isValidLmsIdentifier('STU-1001')).toBe(true);
            expect(isValidLmsIdentifier('2026-CS-001')).toBe(true);
            expect(isValidLmsIdentifier('alice@university.edu')).toBe(true);

            // Invalid cases
            expect(isValidLmsIdentifier('')).toBe(false);
            expect(isValidLmsIdentifier('   ')).toBe(false);
            expect(isValidLmsIdentifier(null)).toBe(false);
            expect(isValidLmsIdentifier(undefined)).toBe(false);
            expect(isValidLmsIdentifier(12345)).toBe(false);
            expect(isValidLmsIdentifier('a'.repeat(101))).toBe(false);
            expect(isValidLmsIdentifier('stu\x00dent')).toBe(false); // Null byte / control char
            expect(isValidLmsIdentifier('stu\x07dent')).toBe(false); // Bell char
        });

        it('validates grade values against max marks', () => {
            expect(isValidGradeValue(25, 30)).toBe(true);
            expect(isValidGradeValue(0, 30)).toBe(true);
            expect(isValidGradeValue(30, 30)).toBe(true);

            // Invalid cases
            expect(isValidGradeValue(-1, 30)).toBe(false);
            expect(isValidGradeValue(31, 30)).toBe(false);
            expect(isValidGradeValue(NaN, 30)).toBe(false);
            expect(isValidGradeValue(Infinity, 30)).toBe(false);
            expect(isValidGradeValue('25', 30)).toBe(false);
            expect(isValidGradeValue(null, 30)).toBe(false);
        });
    });

    describe('LMS grade mapping and scoping workflow', () => {
        async function createLmsFixture() {
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

            const professor = await User.create({
                name: 'Professor Course Owner',
                email: `prof-lms-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const otherProfessor = await User.create({
                name: 'Professor Other Course',
                email: `other-prof-lms-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const ta = await User.create({
                name: 'TA Assistant',
                email: `ta-lms-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.TA,
                isActive: true
            });

            // Student A: Alice (enrolled, has finalized grade 25/30)
            const studentA = await User.create({
                name: 'Alice Cooper',
                email: `alice-lms-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Student B: Bob (enrolled, has formula injection name & rollNumber, finalized grade 22/30)
            const studentB = await User.create({
                name: '=SUM(1+1)',
                email: `bob-lms-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Student C: Charlie (enrolled, has unfinalized grade -> unmapped)
            const studentC = await User.create({
                name: 'Charlie Pending',
                email: `charlie-lms-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Student D: Outside Student (enrolled in a different course, NOT this one)
            const studentD = await User.create({
                name: 'Diana Outside',
                email: `diana-outside-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Course A: CS101 (Alice, Bob, Charlie)
            const courseA = await Course.create({
                courseCode: `CS101-${suffix}`,
                courseName: 'Data Structures',
                academicYear: '2026-2027',
                semester: 1,
                professor: professor._id,
                enrolledStudents: [studentA._id, studentB._id, studentC._id],
                teachingAssistants: [ta._id],
                isActive: true
            });

            // Course B: CS999 (Diana only)
            const courseB = await Course.create({
                courseCode: `CS999-${suffix}`,
                courseName: 'Unrelated Course',
                academicYear: '2026-2027',
                semester: 1,
                professor: otherProfessor._id,
                enrolledStudents: [studentD._id],
                teachingAssistants: [],
                isActive: true
            });

            const exam = await Exam.create({
                title: `Midterm Exam ${suffix}`,
                course: courseA._id,
                createdBy: professor._id,
                examDate: new Date('2026-11-01'),
                totalMarks: 30,
                numberOfQuestions: 1,
                status: ExamStatus.PUBLISHED,
                isActive: true
            });

            const rubric = await Rubric.create({
                exam: exam._id,
                createdBy: professor._id,
                scoreStep: 0.5,
                questions: [{
                    questionNumber: 1,
                    maxMarks: 30,
                    criteria: [{ criterionName: 'All', points: 30 }]
                }],
                isActive: true
            });

            // Mappings for Course A
            await StudentMapping.create([
                {
                    exam: exam._id,
                    student: studentA._id,
                    anonymousId: `ANON-A-${suffix}`,
                    rollNumber: 'CS2026-001',
                    isVerified: true
                },
                {
                    exam: exam._id,
                    student: studentB._id,
                    anonymousId: `ANON-B-${suffix}`,
                    rollNumber: '+19999999', // Formula injection candidate
                    isVerified: true
                },
                {
                    exam: exam._id,
                    student: studentC._id,
                    anonymousId: `ANON-C-${suffix}`,
                    rollNumber: 'CS2026-003',
                    isVerified: true
                }
            ]);

            // Scripts & Grades
            const scriptA = await AnswerScript.create({
                exam: exam._id,
                student: studentA._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: scriptA._id,
                rubric: rubric._id,
                gradedBy: professor._id,
                question: 1,
                marksAwarded: [{ criterionName: 'All', score: 25 }],
                totalScore: 25,
                isFinal: true
            });

            const scriptB = await AnswerScript.create({
                exam: exam._id,
                student: studentB._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: scriptB._id,
                rubric: rubric._id,
                gradedBy: professor._id,
                question: 1,
                marksAwarded: [{ criterionName: 'All', score: 22 }],
                totalScore: 22,
                isFinal: true
            });

            const scriptC = await AnswerScript.create({
                exam: exam._id,
                student: studentC._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: scriptC._id,
                rubric: rubric._id,
                gradedBy: professor._id,
                question: 1,
                marksAwarded: [{ criterionName: 'All', score: 10 }],
                totalScore: 10,
                isFinal: false // Not finalized
            });

            return {
                professor,
                otherProfessor,
                ta,
                studentA,
                studentB,
                studentC,
                studentD,
                courseA,
                courseB,
                exam,
                rubric
            };
        }

        it('successfully maps LMS student IDs to internal student records and released grades', async () => {
            const fixture = await createLmsFixture();

            const result = await mapLmsStudentIdsToGrades(fixture.exam, [
                { lmsStudentId: 'CS2026-001' }, // Match Alice by rollNumber
                { lmsStudentId: fixture.studentA.email }, // Match Alice by email (if separate input)
            ]);

            // Alice was mapped from both inputs, but because they resolve to the same student,
            // duplicate student mapping is detected and handled safely!
            expect(result.summary.duplicateCount).toBe(2);
            expect(result.records[0].status).toBe('DUPLICATE_STUDENT');
            expect(result.records[1].status).toBe('DUPLICATE_STUDENT');

            // Unique input test
            const uniqueResult = await mapLmsStudentIdsToGrades(fixture.exam, [
                { lmsStudentId: 'CS2026-001' }, // Alice by rollNumber
                { lmsStudentId: fixture.studentB.email } // Bob by email
            ]);

            expect(uniqueResult.summary.mappedCount).toBe(2);
            expect(uniqueResult.records[0].status).toBe('MAPPED');
            expect(uniqueResult.records[0].studentName).toBe('Alice Cooper');
            expect(uniqueResult.records[0].grade).toBe(25);
            expect(uniqueResult.records[0].maxGrade).toBe(30);

            expect(uniqueResult.records[1].status).toBe('MAPPED');
            expect(uniqueResult.records[1].studentName).toBe('=SUM(1+1)');
            expect(uniqueResult.records[1].grade).toBe(22);
        });

        it('handles duplicate LMS student IDs in the input explicitly', async () => {
            const fixture = await createLmsFixture();

            const result = await mapLmsStudentIdsToGrades(fixture.exam, [
                { lmsStudentId: 'CS2026-001' },
                { lmsStudentId: 'CS2026-001' }, // Duplicate LMS ID
                { lmsStudentId: fixture.studentB.email }
            ]);

            expect(result.summary.duplicateCount).toBe(2);
            expect(result.records[0].status).toBe('DUPLICATE_LMS_ID');
            expect(result.records[0].grade).toBeNull();
            expect(result.records[1].status).toBe('DUPLICATE_LMS_ID');
            expect(result.records[1].grade).toBeNull();

            // The third record is still mapped cleanly
            expect(result.records[2].status).toBe('MAPPED');
            expect(result.records[2].grade).toBe(22);
        });

        it('handles missing, unmapped and invalid student IDs safely', async () => {
            const fixture = await createLmsFixture();

            const result = await mapLmsStudentIdsToGrades(fixture.exam, [
                { lmsStudentId: 'NON_EXISTENT_LMS_ID' }, // Not found in course
                { lmsStudentId: 'CS2026-003' },          // Charlie: enrolled but grade is unfinalized
                { lmsStudentId: '' },                    // Invalid identifier
                { lmsStudentId: 'a'.repeat(150) }        // Exceeds max length
            ]);

            expect(result.summary.missingCount).toBe(1);
            expect(result.records[0].status).toBe('MISSING_IN_COURSE');
            expect(result.records[0].grade).toBeNull();

            expect(result.summary.unmappedCount).toBe(1);
            expect(result.records[1].status).toBe('UNMAPPED');
            expect(result.records[1].studentName).toBe('Charlie Pending');
            expect(result.records[1].grade).toBeNull();

            expect(result.summary.invalidCount).toBe(2);
            expect(result.records[2].status).toBe('INVALID_IDENTIFIER');
            expect(result.records[3].status).toBe('INVALID_IDENTIFIER');
        });

        it('prevents cross-course data exposure: student from another course is rejected', async () => {
            const fixture = await createLmsFixture();

            // Try to look up Diana (studentD from courseB) using Course A's exam
            const result = await mapLmsStudentIdsToGrades(fixture.exam, [
                { lmsStudentId: fixture.studentD._id.toString() },
                { lmsStudentId: fixture.studentD.email }
            ]);

            // Neither entry should be mapped because Diana is NOT in Course A!
            expect(result.summary.mappedCount).toBe(0);
            expect(result.records[0].status).toBe('MISSING_IN_COURSE');
            expect(result.records[0].studentName).toBeUndefined();
            expect(result.records[0].grade).toBeNull();
            expect(result.records[1].status).toBe('MISSING_IN_COURSE');
            expect(result.records[1].studentName).toBeUndefined();
            expect(result.records[1].grade).toBeNull();
        });

        it('generates documented Standard and Canvas LMS CSV formats with formula injection protection', async () => {
            const fixture = await createLmsFixture();

            const result = await mapLmsStudentIdsToGrades(fixture.exam, [
                { lmsStudentId: 'CS2026-001' },
                { lmsStudentId: fixture.studentB.email }
            ]);

            // 1. Standard format
            const standardCsv = buildLmsCsv(result, 'standard');
            expect(standardCsv).toContain('"LMS Student ID","Student Name","Email","Roll Number","Grade","Max Grade","Status","Validation Notes"');
            expect(standardCsv).toContain('Alice Cooper');
            // Formula injection in Bob's name '=SUM(1+1)' must be escaped with single quote
            expect(standardCsv).toContain(`"'=SUM(1+1)"`);
            expect(standardCsv).toContain(`"'+19999999"`);

            // 2. Canvas format
            const canvasCsv = buildLmsCsv(result, 'canvas');
            expect(canvasCsv).toContain('"Student","ID","SIS User ID","SIS Login ID","Section"');
            expect(canvasCsv).toContain('Points Possible');
            expect(canvasCsv).toContain(`30`);
            expect(canvasCsv).toContain(`"'=SUM(1+1)"`);
        });

        it('enforces API authorization and permission boundaries on GET and POST', async () => {
            const fixture = await createLmsFixture();

            // 1. Unauthenticated -> 401
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: false,
                response: NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 }),
                user: null
            });

            const unauthGet = await lmsExportGET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export/lms`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(unauthGet.status).toBe(401);

            const unauthPost = await lmsExportPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export/lms`, {
                    method: 'POST',
                    body: JSON.stringify({ students: [{ lmsStudentId: 'CS2026-001' }] })
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(unauthPost.status).toBe(401);

            // 2. TA -> 403 Forbidden
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

            const taGet = await lmsExportGET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export/lms`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(taGet.status).toBe(403);

            // 3. Non-owning professor -> 404 Not Found
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

            const otherProfGet = await lmsExportGET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export/lms`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(otherProfGet.status).toBe(404);

            // 4. Authorized Professor -> 200 on GET and POST
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

            const ownerGet = await lmsExportGET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export/lms?format=standard`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(ownerGet.status).toBe(200);
            expect(ownerGet.headers.get('content-type')).toContain('text/csv');
            const getCsv = await ownerGet.text();
            expect(getCsv).toContain('Alice Cooper');

            // POST JSON response
            const ownerPost = await lmsExportPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export/lms`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        students: [
                            { lmsStudentId: 'CS2026-001' }
                        ]
                    })
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(ownerPost.status).toBe(200);
            const postBody = await ownerPost.json();
            expect(postBody.success).toBe(true);
            expect(postBody.data.summary.mappedCount).toBe(1);
            expect(postBody.data.records[0].grade).toBe(25);

            // POST with download=true -> returns CSV
            const ownerPostDownload = await lmsExportPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export/lms?download=true`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        students: [
                            { lmsStudentId: 'CS2026-001' }
                        ],
                        format: 'canvas'
                    })
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(ownerPostDownload.status).toBe(200);
            expect(ownerPostDownload.headers.get('content-type')).toContain('text/csv');
            const postCsv = await ownerPostDownload.text();
            expect(postCsv).toContain('SIS User ID');
        });

        it('validates invalid inputs on POST (missing students array, malformed ID)', async () => {
            const fixture = await createLmsFixture();

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

            // 1. Invalid exam ID -> 400
            const badIdRes = await lmsExportPOST(
                new NextRequest('http://localhost/api/analytics/exams/bad-id/export/lms', {
                    method: 'POST',
                    body: JSON.stringify({ students: [] })
                }),
                { params: Promise.resolve({ id: 'bad-id' }) }
            );
            expect(badIdRes.status).toBe(400);

            // 2. Missing students array -> 400
            const missingStudentsRes = await lmsExportPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/export/lms`, {
                    method: 'POST',
                    body: JSON.stringify({})
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(missingStudentsRes.status).toBe(400);
        });
    });
});

