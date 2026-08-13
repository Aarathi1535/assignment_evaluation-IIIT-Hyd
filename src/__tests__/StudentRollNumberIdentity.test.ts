/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import StudentMapping from '../models/StudentMapping';
import User, { UserRole } from '../models/User';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import Allocation from '../models/Allocation';
import Grade from '../models/Grade';
import AnswerScript from '../models/AnswerScript';
import Rubric from '../models/Rubric';
import ExamService from '../services/ExamService';
import { normalizeRollNumber } from '../utils/studentMappingUtils';
import { NextRequest } from 'next/server';
import { GET as getStudentsRoute } from '../app/api/exams/[id]/students/route';

let mockSessionUser: any = null;

// Mock next-auth to allow dynamic control of session users in RBAC testing
vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => {
            if (!mockSessionUser) return Promise.resolve(null);
            return Promise.resolve({ user: mockSessionUser });
        }),
    };
});

describe('GitHub Issue #40 — Student Roll Number & Roster Identity', () => {
    let profUser: any;
    let otherProfUser: any;
    let student1: any;
    let student2: any;
    let student3: any;
    let taUser: any;
    let course1: any;
    let course2: any;
    let exam1: any;
    let exam2: any;

    beforeAll(async () => {
        await StudentMapping.init();
        await User.init();
        await Exam.init();
        await Course.init();
        await Allocation.init();
        await Grade.init();
        await AnswerScript.init();
        await Rubric.init();
    });

    beforeEach(async () => {
        mockSessionUser = null;

        // Create professors
        profUser = await User.create({
            name: 'Prof Ramanujan',
            email: `prof-ram-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        otherProfUser = await User.create({
            name: 'Prof Aryabhata',
            email: `prof-arya-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // Create students
        student1 = await User.create({
            name: 'Alice Smith',
            email: `alice-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        student2 = await User.create({
            name: 'Bob Jones',
            email: `bob-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        student3 = await User.create({
            name: 'Charlie Brown',
            email: `charlie-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        // Create TA
        taUser = await User.create({
            name: 'TA Dave',
            email: `ta-dave-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.TA,
            isActive: true
        });

        // Create Courses
        course1 = await Course.create({
            courseCode: `CS-401-${Date.now()}`,
            courseName: 'Algorithms',
            semester: 1,
            academicYear: '2026-2027',
            professor: profUser._id,
            teachingAssistants: [taUser._id],
            enrolledStudents: [student1._id, student2._id, student3._id],
            isActive: true
        });

        course2 = await Course.create({
            courseCode: `CS-402-${Date.now()}`,
            courseName: 'Systems',
            semester: 1,
            academicYear: '2026-2027',
            professor: otherProfUser._id,
            teachingAssistants: [],
            enrolledStudents: [student1._id, student2._id],
            isActive: true
        });

        // Create Exams
        exam1 = await Exam.create({
            title: 'Midterm Algorithms',
            course: course1._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 4,
            enrolledStudents: [student1._id, student2._id, student3._id],
            isActive: true
        });

        exam2 = await Exam.create({
            title: 'Midterm Systems',
            course: course2._id,
            createdBy: otherProfUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 3,
            enrolledStudents: [student1._id, student2._id],
            isActive: true
        });
    });

    describe('1. Shared Roll-Number Normalization', () => {
        it('normalizes roll number consistently (stripping internal/external whitespace and converting to uppercase)', () => {
            expect(normalizeRollNumber(' cs 101 ')).toBe('CS101');
            expect(normalizeRollNumber('roll-2026-001')).toBe('ROLL-2026-001');
            expect(normalizeRollNumber('  cs  2026  b   ')).toBe('CS2026B');
            expect(normalizeRollNumber('')).toBeNull();
            expect(normalizeRollNumber('   ')).toBeNull();
            expect(normalizeRollNumber(null)).toBeNull();
            expect(normalizeRollNumber(undefined)).toBeNull();
        });

        it('normalizes identically for storage, uniqueness, and lookup', () => {
            const raw1 = ' cs-2026-042 ';
            const raw2 = 'CS-2026-042';
            const raw3 = '  cs-2026-042';
            expect(normalizeRollNumber(raw1)).toBe(normalizeRollNumber(raw2));
            expect(normalizeRollNumber(raw2)).toBe(normalizeRollNumber(raw3));
            expect(normalizeRollNumber(raw1)).toBe('CS-2026-042');
        });
    });

    describe('2. StudentMapping Model & Partial Unique Index', () => {
        it('accepts rollNumber on StudentMapping and stores normalized value', async () => {
            const mapping = await StudentMapping.create({
                exam: exam1._id,
                student: student1._id,
                anonymousId: 'ANON-SM-1',
                rollNumber: ' cs 101 '
            });

            expect(mapping.rollNumber).toBe('CS101');
            const found = await StudentMapping.findById(mapping._id);
            expect(found?.rollNumber).toBe('CS101');
        });

        it('allows rollNumber to be optional and defaults to null', async () => {
            const mapping = await StudentMapping.create({
                exam: exam1._id,
                student: student1._id,
                anonymousId: 'ANON-SM-OPT'
            });

            expect(mapping.rollNumber).toBeNull();
        });

        it('allows multiple mappings without rollNumber (null) in the same exam without collision', async () => {
            const m1 = await StudentMapping.create({
                exam: exam1._id,
                student: student1._id,
                anonymousId: 'ANON-NO-ROLL-1',
                rollNumber: null
            });

            const m2 = await StudentMapping.create({
                exam: exam1._id,
                student: student2._id,
                anonymousId: 'ANON-NO-ROLL-2',
                rollNumber: null
            });

            const m3 = await StudentMapping.create({
                exam: exam1._id,
                student: student3._id,
                anonymousId: 'ANON-NO-ROLL-3'
            });

            expect(m1._id).toBeDefined();
            expect(m2._id).toBeDefined();
            expect(m3._id).toBeDefined();
        });

        it('rejects duplicate rollNumber in the same exam by the database unique index', async () => {
            await StudentMapping.create({
                exam: exam1._id,
                student: student1._id,
                anonymousId: 'ANON-DUP-1',
                rollNumber: 'ROLL-100'
            });

            await expect(
                StudentMapping.create({
                    exam: exam1._id,
                    student: student2._id,
                    anonymousId: 'ANON-DUP-2',
                    rollNumber: 'roll-100' // normalizes to ROLL-100
                })
            ).rejects.toThrow();
        });

        it('allows the same rollNumber in different exams', async () => {
            const m1 = await StudentMapping.create({
                exam: exam1._id,
                student: student1._id,
                anonymousId: 'ANON-CROSS-1',
                rollNumber: 'ROLL-COMMON'
            });

            const m2 = await StudentMapping.create({
                exam: exam2._id,
                student: student1._id,
                anonymousId: 'ANON-CROSS-2',
                rollNumber: 'ROLL-COMMON'
            });

            expect(m1.rollNumber).toBe('ROLL-COMMON');
            expect(m2.rollNumber).toBe('ROLL-COMMON');
            expect(m1.exam.toString()).not.toBe(m2.exam.toString());
        });
    });

    describe('3. ExamService Enrollment & Safe Conflict Handling', () => {
        it('enrolls students with roll numbers and persists them on StudentMapping', async () => {
            const result = await ExamService.enrollStudents(
                exam1._id.toString(),
                [student1._id.toString(), student2._id.toString()],
                profUser._id.toString(),
                'PROFESSOR',
                {
                    actingUserId: profUser._id.toString(),
                    rollNumbers: {
                        [student1._id.toString()]: ' roll-001 ',
                        [student2._id.toString()]: 'roll-002'
                    }
                }
            );

            expect(result).not.toBeNull();
            expect(result?.length).toBe(2);

            const m1 = result?.find(m => m.student?._id?.toString() === student1._id.toString());
            const m2 = result?.find(m => m.student?._id?.toString() === student2._id.toString());

            expect(m1?.rollNumber).toBe('ROLL-001');
            expect(m2?.rollNumber).toBe('ROLL-002');
        });

        it('converts duplicate roll number collision into a controlled application HttpError (409 Conflict)', async () => {
            // First enroll student 1 with ROLL-DUPLICATE
            await ExamService.enrollStudents(
                exam1._id.toString(),
                [student1._id.toString()],
                profUser._id.toString(),
                'PROFESSOR',
                {
                    actingUserId: profUser._id.toString(),
                    rollNumbers: {
                        [student1._id.toString()]: 'ROLL-DUPLICATE'
                    }
                }
            );

            // Attempting to enroll student 2 with the same roll number must throw HttpError 409
            await expect(
                ExamService.enrollStudents(
                    exam1._id.toString(),
                    [student2._id.toString()],
                    profUser._id.toString(),
                    'PROFESSOR',
                    {
                        actingUserId: profUser._id.toString(),
                        rollNumbers: {
                            [student2._id.toString()]: 'roll-duplicate'
                        }
                    }
                )
            ).rejects.toMatchObject({
                statusCode: 409,
                message: expect.stringContaining('Roll number already exists')
            });
        });
    });

    describe('4. Owner-Scoped Roster Lookup by rollNumber', () => {
        beforeEach(async () => {
            await StudentMapping.create({
                exam: exam1._id,
                student: student1._id,
                anonymousId: 'ANON-LOOKUP-1',
                rollNumber: 'CS-ROLL-77'
            });

            await StudentMapping.create({
                exam: exam2._id,
                student: student2._id,
                anonymousId: 'ANON-LOOKUP-2',
                rollNumber: 'CS-ROLL-88'
            });
        });

        it('successfully retrieves student mapping by rollNumber with case/whitespace insensitivity', async () => {
            const mapping = await ExamService.getStudentMappingByRollNumber(
                exam1._id.toString(),
                '  cs-roll-77  ',
                profUser._id.toString(),
                'PROFESSOR'
            );

            expect(mapping).not.toBeNull();
            expect(mapping?.rollNumber).toBe('CS-ROLL-77');
            expect((mapping?.student as any)?._id?.toString()).toBe(student1._id.toString());
            expect((mapping?.student as any)?.name).toBe('Alice Smith');
        });

        it('returns null when rollNumber is not found in exam roster', async () => {
            const mapping = await ExamService.getStudentMappingByRollNumber(
                exam1._id.toString(),
                'NON_EXISTENT_ROLL',
                profUser._id.toString(),
                'PROFESSOR'
            );

            expect(mapping).toBeNull();
        });

        it('prevents cross-professor access to exam roster lookup (returns null and blocks leak)', async () => {
            // otherProfUser attempts to lookup in exam1 (owned by profUser)
            const mapping = await ExamService.getStudentMappingByRollNumber(
                exam1._id.toString(),
                'CS-ROLL-77',
                otherProfUser._id.toString(),
                'PROFESSOR'
            );

            expect(mapping).toBeNull();
        });
    });

    describe('5. Roster API Endpoints', () => {
        it('exposes rollNumber in GET /api/exams/[id]/students roster response', async () => {
            await StudentMapping.create({
                exam: exam1._id,
                student: student1._id,
                anonymousId: 'ANON-API-1',
                rollNumber: 'CS-2026-ALPHA'
            });

            mockSessionUser = { id: profUser._id.toString(), email: profUser.email, role: 'PROFESSOR' };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/students`);
            const res = await getStudentsRoute(req, { params: Promise.resolve({ id: exam1._id.toString() }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data.length).toBe(1);
            expect(json.data[0].rollNumber).toBe('CS-2026-ALPHA');
            expect(json.data[0].name).toBe('Alice Smith');
        });

        it('supports single student query in GET /api/exams/[id]/students?rollNumber=...', async () => {
            await StudentMapping.create({
                exam: exam1._id,
                student: student2._id,
                anonymousId: 'ANON-API-2',
                rollNumber: 'CS-2026-BETA'
            });

            mockSessionUser = { id: profUser._id.toString(), email: profUser.email, role: 'PROFESSOR' };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/students?rollNumber=cs-2026-beta`);
            const res = await getStudentsRoute(req, { params: Promise.resolve({ id: exam1._id.toString() }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data.rollNumber).toBe('CS-2026-BETA');
            expect(json.data.id).toBe(student2._id.toString());
        });
    });

    describe('6. Anonymous Grading & Identity Separation Protection', () => {
        it('keeps User._id as canonical student identity on AnswerScript and StudentMapping', async () => {
            const mapping = await StudentMapping.create({
                exam: exam1._id,
                student: student1._id,
                anonymousId: 'ANON-CANONICAL-1',
                rollNumber: 'CS-ROLL-001'
            });

            const script = await AnswerScript.create({
                exam: exam1._id,
                student: student1._id,
                candidateStudentId: 'CS-ROLL-001',
                identificationSource: 'QR',
                identificationStatus: 'IDENTIFIED',
                filePath: '/path/to/script.pdf',
                filename: 'script.pdf'
            });

            // Student reference is strictly User ObjectId
            expect(mapping.student.toString()).toBe(student1._id.toString());
            expect(script.student?.toString()).toBe(student1._id.toString());
        });

        it('proves grading-facing domain models (Allocation, Grade, AnswerScript) do not expose rollNumber', async () => {
            const script = await AnswerScript.create({
                exam: exam1._id,
                student: student1._id,
                filePath: '/path/to/script.pdf',
                filename: 'script.pdf'
            });

            const rubric = await Rubric.create({
                exam: exam1._id,
                createdBy: profUser._id,
                questions: [
                    {
                        questionNumber: 1,
                        maxMarks: 50,
                        criteria: [{ criterionName: 'Accuracy', points: 50 }]
                    }
                ]
            });

            const allocation = await Allocation.create({
                exam: exam1._id,
                ta: taUser._id,
                answerScript: script._id,
                allocatedBy: profUser._id
            });

            const grade = await Grade.create({
                answerScript: script._id,
                rubric: rubric._id,
                gradedBy: taUser._id,
                marksAwarded: [{ criterionName: 'Accuracy', score: 45 }],
                totalScore: 45
            });

            // Verify models do not have rollNumber field
            const scriptObj = script.toObject();
            const allocationObj = allocation.toObject();
            const gradeObj = grade.toObject();

            expect(scriptObj).not.toHaveProperty('rollNumber');
            expect(allocationObj).not.toHaveProperty('rollNumber');
            expect(allocationObj).not.toHaveProperty('student'); // TAs grade anonymously
            expect(gradeObj).not.toHaveProperty('rollNumber');
            expect(gradeObj).not.toHaveProperty('student');
        });
    });
});
