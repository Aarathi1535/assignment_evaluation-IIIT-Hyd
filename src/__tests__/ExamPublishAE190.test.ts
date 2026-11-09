/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Rubric from '../models/Rubric';
import ScriptFlag, { FlagReason, FlagStatus } from '../models/ScriptFlag';
import AuditLog from '../models/AuditLog';
import StudentResultService from '../services/StudentResultService';
import { NextRequest } from 'next/server';

let mockSessionUser: any = null;

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

describe('AE-190: Professor Publish Action Per Exam', () => {
    let publishPOST: any;
    let prof: any;
    let ta: any;
    let student: any;
    let course: any;
    let rubric: any;
    let exam: any;
    let script: any;

    beforeAll(async () => {
        publishPOST = (await import('../app/api/exams/[id]/publish/route')).POST;
    });

    beforeEach(async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'true';

        // Clean collections
        await Course.deleteMany({});
        await Exam.deleteMany({});
        await User.deleteMany({});
        await AnswerScript.deleteMany({});
        await Grade.deleteMany({});
        await Allocation.deleteMany({});
        await Rubric.deleteMany({});
        await ScriptFlag.deleteMany({});
        await AuditLog.collection.deleteMany({});

        // Create users
        prof = await User.create({
            name: 'Prof Turing',
            email: 'turing@iiit.ac.in',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        ta = await User.create({
            name: 'TA Alan',
            email: 'ta@iiit.ac.in',
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true,
        });

        student = await User.create({
            name: 'Student Alice',
            email: 'alice@students.iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        course = await Course.create({
            courseCode: 'CS101',
            courseName: 'Intro to Algorithms',
            semester: 1,
            academicYear: '2026',
            professor: prof._id,
            teachingAssistants: [ta._id],
            enrolledStudents: [student._id],
            isActive: true,
        });

        exam = await Exam.create({
            title: 'Midterm Algorithms',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-10-15'),
            totalMarks: 50,
            status: ExamStatus.REVIEW_PENDING,
            numberOfQuestions: 1,
            isActive: true,
        });

        rubric = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 50,
                    criteria: [{ criterionName: 'Correctness', points: 50 }],
                },
            ],
            isActive: true,
        });

        exam.rubric = rubric._id;
        await exam.save();

        script = await AnswerScript.create({
            exam: exam._id,
            student: student._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            hasIdentificationConflict: false,
            needsManualId: false,
            isActive: true,
        });

        await Allocation.create({
            exam: exam._id,
            ta: ta._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED,
        });

        await Grade.create({
            answerScript: script._id,
            gradedBy: ta._id,
            question: undefined,
            totalScore: 45,
            isFinal: true,
            rubric: rubric._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 45 }],
        });
    });

    it('1. Professor can publish results for an exam and audit log is persisted', async () => {
        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const res = await publishPOST(req, { params: Promise.resolve({ id: exam._id.toString() }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.message).toBe('Exam results published successfully');
        expect(body.data.status).toBe(ExamStatus.PUBLISHED);

        // Verify database persistence
        const dbExam = await Exam.findById(exam._id);
        expect(dbExam!.status).toBe(ExamStatus.PUBLISHED);
        expect(dbExam!.publishedBy?.toString()).toBe(prof._id.toString());
        expect(dbExam!.publishedAt).toBeInstanceOf(Date);

        // Verify audit log
        const audit = await AuditLog.findOne({
            action: 'EXAM_PUBLISHED',
            entityId: exam._id,
        });
        expect(audit).not.toBeNull();
        expect(audit!.user.toString()).toBe(prof._id.toString());
        expect(audit!.outcome).toBe('SUCCESS');
        expect(audit!.details).toHaveProperty('publishedBy');
        expect(audit!.details).toHaveProperty('publishedAt');
    });

    it('2. Students cannot access results before publication and can access after publication', async () => {
        // Step A: Before publication, results list excludes the unpublished exam
        const preResults = await StudentResultService.getStudentResults(student._id.toString(), UserRole.STUDENT);
        expect(preResults.length).toBe(0);

        // Direct script access also rejects before publication
        await expect(
            StudentResultService.verifyStudentScriptAccess(script._id.toString(), student._id.toString(), UserRole.STUDENT)
        ).rejects.toThrow();

        // Step B: Publish exam as professor
        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };
        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const res = await publishPOST(req, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(res.status).toBe(200);

        // Step C: After publication, results become RELEASED with actual scores
        const postResults = await StudentResultService.getStudentResults(student._id.toString(), UserRole.STUDENT);
        expect(postResults.length).toBe(1);
        expect(postResults[0].status).toBe('RELEASED');
        expect(postResults[0].total).toBe(45);
        expect(postResults[0].maxMarks).toBe(50);

        // Direct script access succeeds after publication
        const access = await StudentResultService.verifyStudentScriptAccess(script._id.toString(), student._id.toString(), UserRole.STUDENT);
        expect(access.script._id.toString()).toBe(script._id.toString());
    });

    it('3. Repeated publish requests are handled safely without duplicate side effects', async () => {
        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };

        const req1 = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const res1 = await publishPOST(req1, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(res1.status).toBe(200);

        const dbExam1 = await Exam.findById(exam._id);
        const originalPublishedAt = dbExam1!.publishedAt;

        // Second publish call
        const req2 = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const res2 = await publishPOST(req2, { params: Promise.resolve({ id: exam._id.toString() }) });
        const body2 = await res2.json();

        expect(res2.status).toBe(200);
        expect(body2.success).toBe(true);

        // Ensure publishedAt was not overwritten
        const dbExam2 = await Exam.findById(exam._id);
        expect(dbExam2!.publishedAt?.getTime()).toBe(originalPublishedAt?.getTime());

        // Ensure no duplicate audit log for the second call
        const auditCount = await AuditLog.countDocuments({
            action: 'EXAM_PUBLISHED',
            entityId: exam._id,
        });
        expect(auditCount).toBe(1);
    });

    it('4. Rejects publication by unauthorized users (Student and TA)', async () => {
        // Attempt as Student
        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
        const reqStudent = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const resStudent = await publishPOST(reqStudent, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(resStudent.status).toBe(403);

        // Attempt as TA
        mockSessionUser = { id: ta._id.toString(), role: UserRole.TA };
        const reqTa = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const resTa = await publishPOST(reqTa, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(resTa.status).toBe(403);
    });

    it('5. Prevents publication when an OPEN flag exists (AE-164)', async () => {
        // Create an OPEN flag
        const flag: any = await ScriptFlag.create({
            exam: exam._id,
            answerScript: script._id,
            raisedBy: ta._id,
            reason: FlagReason.ILLEGIBLE,
            status: FlagStatus.OPEN,
            note: 'Cannot read page 2',
        });

        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };
        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const res = await publishPOST(req, { params: Promise.resolve({ id: exam._id.toString() }) });
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.success).toBe(false);
        expect(body.message).toContain('open flag(s) that must be resolved or escalated first');

        // Status should still be REVIEW_PENDING
        const dbExam = await Exam.findById(exam._id);
        expect(dbExam!.status).toBe(ExamStatus.REVIEW_PENDING);

        // After resolving the flag, publication succeeds
        flag.status = FlagStatus.RESOLVED;
        await flag.save();

        const req2 = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const res2 = await publishPOST(req2, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(res2.status).toBe(200);
        const dbExamResolved = await Exam.findById(exam._id);
        expect(dbExamResolved!.status).toBe(ExamStatus.PUBLISHED);
    });

    it('6. Rejects invalid ID and non-existent exam', async () => {
        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };

        // Invalid ID format
        const reqInvalid = new NextRequest(`http://localhost:3000/api/exams/invalid-id/publish`, {
            method: 'POST',
        });
        const resInvalid = await publishPOST(reqInvalid, { params: Promise.resolve({ id: 'invalid-id' }) });
        expect(resInvalid.status).toBe(400);

        // Non-existent exam
        const nonExistentId = '666666666666666666666666';
        const reqNotFound = new NextRequest(`http://localhost:3000/api/exams/${nonExistentId}/publish`, {
            method: 'POST',
        });
        const resNotFound = await publishPOST(reqNotFound, { params: Promise.resolve({ id: nonExistentId }) });
        expect(resNotFound.status).toBe(404);
    });

    it('7. Enforces professor ownership: other professor receives 404, status unchanged, no audit row', async () => {
        const otherProf = await User.create({
            name: 'Prof Other',
            email: 'otherprof@iiit.ac.in',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        mockSessionUser = { id: otherProf._id.toString(), role: UserRole.PROFESSOR };
        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const res = await publishPOST(req, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(res.status).toBe(404);

        // Exam status remains unchanged
        const dbExam = await Exam.findById(exam._id);
        expect(dbExam!.status).toBe(ExamStatus.REVIEW_PENDING);

        // No audit row written for this attempt
        const auditRows = await AuditLog.find({ entityId: exam._id, action: 'EXAM_PUBLISHED' });
        expect(auditRows.length).toBe(0);
    });

    it('8. Rejects publication with 409 Conflict if exam is not in REVIEW_PENDING status', async () => {
        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };

        const testStatuses = [ExamStatus.DRAFT, ExamStatus.SCHEDULED, ExamStatus.SCANNING, ExamStatus.EVALUATING];
        for (const status of testStatuses) {
            exam.status = status;
            await exam.save();

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
                method: 'POST',
            });
            const res = await publishPOST(req, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.message).toContain('Only exams in \'REVIEW_PENDING\' status can be published');

            const dbExam = await Exam.findById(exam._id);
            expect(dbExam!.status).toBe(status);
        }
    });

    it('9. Prevents unpublish bypass and delegates PUT /api/exams/[id] status to publishExam', async () => {
        const examPUT = (await import('../app/api/exams/[id]/route')).PUT;
        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };

        // DRAFT -> PUBLISHED must fail invalid transition
        const draftExam = await Exam.create({
            title: 'Draft Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            numberOfQuestions: 5,
            status: ExamStatus.DRAFT,
            isActive: true,
        });
        const reqDraft = new NextRequest(`http://localhost:3000/api/exams/${draftExam._id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: ExamStatus.PUBLISHED }),
            headers: { 'Content-Type': 'application/json' },
        });
        const resDraft = await examPUT(reqDraft, { params: Promise.resolve({ id: draftExam._id.toString() }) });
        expect(resDraft.status).toBe(400);
        const bodyDraft = await resDraft.json();
        expect(bodyDraft.message).toContain('Invalid status transition');

        // REVIEW_PENDING -> PUBLISHED via PUT safely delegates to publishExam (sets publishedBy & audit)
        const reqPending = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: ExamStatus.PUBLISHED }),
            headers: { 'Content-Type': 'application/json' },
        });
        const resPending = await examPUT(reqPending, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(resPending.status).toBe(200);

        const publishedExam = await Exam.findById(exam._id);
        expect(publishedExam!.status).toBe(ExamStatus.PUBLISHED);
        expect(publishedExam!.publishedBy?.toString()).toBe(prof._id.toString());
        expect(publishedExam!.publishedAt).toBeDefined();

        const auditRows = await AuditLog.find({ entityId: exam._id, action: 'EXAM_PUBLISHED' });
        expect(auditRows.length).toBe(1);

        // PUBLISHED -> REVIEW_PENDING via PUT must be rejected pointing to unpublish route
        const reqUnpublish = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: ExamStatus.REVIEW_PENDING }),
            headers: { 'Content-Type': 'application/json' },
        });
        const resUnpublish = await examPUT(reqUnpublish, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(resUnpublish.status).toBe(400);
        const bodyUnpublish = await resUnpublish.json();
        expect(bodyUnpublish.message).toContain('Direct status update to REVIEW_PENDING from PUBLISHED is not allowed');
    });

    it('10. Atomic publication: concurrent publish requests create only one EXAM_PUBLISHED audit row', async () => {
        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };

        const makeReq = () => new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });

        // 3 concurrent requests
        const results = await Promise.all([
            publishPOST(makeReq(), { params: Promise.resolve({ id: exam._id.toString() }) }),
            publishPOST(makeReq(), { params: Promise.resolve({ id: exam._id.toString() }) }),
            publishPOST(makeReq(), { params: Promise.resolve({ id: exam._id.toString() }) }),
        ]);

        // All should succeed (one won atomic transition, other two were handled or idempotent)
        for (const res of results) {
            expect(res.status).toBe(200);
        }

        const dbExam = await Exam.findById(exam._id);
        expect(dbExam!.status).toBe(ExamStatus.PUBLISHED);

        // Exactly one EXAM_PUBLISHED audit log row
        const auditRows = await AuditLog.find({ entityId: exam._id, action: 'EXAM_PUBLISHED' });
        expect(auditRows.length).toBe(1);
    });

    it('11. Rejects exam publication if exam totalMarks does not match rubric total marks', async () => {
        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };

        const testExam = await Exam.create({
            title: 'Mismatched Marks Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-10-15'),
            totalMarks: 40, // Exam says 40
            status: ExamStatus.REVIEW_PENDING,
            numberOfQuestions: 1,
            isActive: true,
        });

        // Rubric has 50 marks total
        await Rubric.create({
            exam: testExam._id,
            createdBy: prof._id,
            scoreStep: 1,
            questions: [{
                questionNumber: 1,
                maxMarks: 50,
                criteria: [{ criterionName: 'Correctness', points: 50 }]
            }],
            isActive: true
        });

        const req = new NextRequest(`http://localhost:3000/api/exams/${testExam._id}/publish`, {
            method: 'POST',
        });
        const res = await publishPOST(req, { params: Promise.resolve({ id: testExam._id.toString() }) });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.message).toContain('does not match rubric total');

        // Status should remain REVIEW_PENDING
        const untouchedExam = await Exam.findById(testExam._id);
        expect(untouchedExam!.status).toBe(ExamStatus.REVIEW_PENDING);
    });
});
