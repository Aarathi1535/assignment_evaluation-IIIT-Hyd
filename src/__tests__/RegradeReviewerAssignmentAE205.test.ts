import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import RegradeRequest, { RegradeDecisionOutcome, RegradeStatus } from '../models/RegradeRequest';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import DerivedStorageService from '../services/DerivedStorageService';

let mockSessionUser: { id: string; role: UserRole } | null = null;

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => (
            mockSessionUser ? { user: mockSessionUser } : null
        ))
    };
});

describe('AE-205 regrade reviewer assignment', () => {
    let assignReviewer: typeof import('../app/api/professor/regrade-requests/[id]/assignment/route').PATCH;
    let patchDecision: typeof import('../app/api/professor/regrade-requests/[id]/route').PATCH;
    let getRequests: typeof import('../app/api/professor/regrade-requests/route').GET;
    let getPages: typeof import('../app/api/scripts/[id]/pages/route').GET;
    let getImage: typeof import('../app/api/ingest/[id]/pages/[pageId]/image/route').GET;

    beforeAll(async () => {
        assignReviewer = (await import('../app/api/professor/regrade-requests/[id]/assignment/route')).PATCH;
        patchDecision = (await import('../app/api/professor/regrade-requests/[id]/route')).PATCH;
        getRequests = (await import('../app/api/professor/regrade-requests/route')).GET;
        getPages = (await import('../app/api/scripts/[id]/pages/route')).GET;
        getImage = (await import('../app/api/ingest/[id]/pages/[pageId]/image/route')).GET;
        await RegradeRequest.init();

        vi.spyOn(DerivedStorageService, 'openDerivedPage').mockResolvedValue({
            stream: Readable.from([Buffer.from('fake-derived-image')]),
            size: 19
        });
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    async function createFixture() {
        const suffix = `${Date.now()}-${Math.random()}`;
        const professor = await User.create({
            name: 'Professor Owner',
            email: `owner-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        const ta = await User.create({
            name: 'Assigned TA',
            email: `ta-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        const otherTa = await User.create({
            name: 'Unassigned TA',
            email: `other-ta-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        const student = await User.create({
            name: 'Student Example',
            email: `student-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true
        });
        const course = await Course.create({
            courseCode: `CS-${suffix}`,
            courseName: 'Algorithms',
            academicYear: '2026',
            semester: 1,
            professor: professor._id,
            enrolledStudents: [student._id],
            teachingAssistants: [ta._id],
            isActive: true
        });
        const exam = await Exam.create({
            title: 'Midterm',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date(),
            totalMarks: 10,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            isActive: true
        });
        const script = await AnswerScript.create({
            exam: exam._id,
            student: student._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });
        const regrade = await RegradeRequest.create({
            exam: exam._id,
            answerScript: script._id,
            questionNumber: 1,
            student: student._id,
            reason: 'Please review the question score.',
            status: RegradeStatus.OPEN
        });
        const batch = await Batch.create({
            batchId: `batch-${suffix}`,
            exam: exam._id,
            uploadedBy: professor._id,
            totalFiles: 1,
            status: BatchStatus.DONE
        });
        const page = await IngestionPage.create({
            batchId: batch.batchId,
            job: new mongoose.Types.ObjectId(),
            fileId: `file-${suffix}`,
            pageNumber: 1,
            fileIndex: 0,
            storageKey: `derived/pages/${batch.batchId}/p1.png`,
            answerScript: script._id,
            status: PageProcessingStatus.PROCESSED
        });
        return { professor, ta, otherTa, student, course, exam, script, regrade, batch, page };
    }

    function assign(id: string, reviewerId: string) {
        return assignReviewer(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${id}/assignment`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ reviewerId })
            }),
            { params: Promise.resolve({ id }) }
        );
    }

    it('assigns only an eligible course TA and records assignment history and audit event', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        const response = await assign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        const payload = await response.json();
        const saved = await RegradeRequest.findById(fixture.regrade._id);
        const audit = await AuditLog.findOne({
            entityId: fixture.regrade._id,
            action: 'REGRADE_REVIEWER_ASSIGNED'
        });

        expect(response.status).toBe(200);
        expect(payload.data.assignedTo).toMatchObject({
            id: fixture.ta._id.toString(),
            name: fixture.ta.name
        });
        expect(saved?.assignedTo?.toString()).toBe(fixture.ta._id.toString());
        expect(saved?.assignmentHistory).toHaveLength(1);
        expect(audit?.details).toMatchObject({
            previousAssignee: null,
            assignedTo: fixture.ta._id.toString()
        });
    });

    it('rejects reviewers outside the course and leaves the request unassigned', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        const response = await assign(fixture.regrade._id.toString(), fixture.otherTa._id.toString());
        const saved = await RegradeRequest.findById(fixture.regrade._id);

        expect(response.status).toBe(400);
        expect(saved?.assignedTo).toBeNull();
        expect(saved?.assignmentHistory).toHaveLength(0);
    });

    it('limits the reviewer queue and answer pages to the assigned TA', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        const assignment = await assign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        expect(assignment.status).toBe(200);

        mockSessionUser = { id: fixture.ta._id.toString(), role: UserRole.TA };
        const queue = await getRequests(new NextRequest('http://localhost:3000/api/professor/regrade-requests'));
        const queuePayload = await queue.json();
        const pages = await getPages(
            new NextRequest(`http://localhost:3000/api/scripts/${fixture.script._id}/pages`),
            { params: Promise.resolve({ id: fixture.script._id.toString() }) }
        );

        expect(queue.status).toBe(200);
        expect(queuePayload.data.requests).toHaveLength(1);
        expect(queuePayload.data.requests[0].id).toBe(fixture.regrade._id.toString());
        expect(pages.status).toBe(200);
        expect((await pages.json()).data).toHaveLength(1);

        mockSessionUser = { id: fixture.otherTa._id.toString(), role: UserRole.TA };
        const unassignedQueue = await getRequests(new NextRequest('http://localhost:3000/api/professor/regrade-requests'));
        const deniedPages = await getPages(
            new NextRequest(`http://localhost:3000/api/scripts/${fixture.script._id}/pages`),
            { params: Promise.resolve({ id: fixture.script._id.toString() }) }
        );

        expect(unassignedQueue.status).toBe(200);
        expect((await unassignedQueue.json()).data.requests).toHaveLength(0);
        expect(deniedPages.status).toBe(403);
    });

    it('rejects student attempting to assign reviewers with 403 Forbidden', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.student._id.toString(), role: UserRole.STUDENT };

        const response = await assign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        expect(response.status).toBe(403);
    });

    it('blocks assigning a TA who was the original grader for this question', async () => {
        const fixture = await createFixture();
        const rubric = await Rubric.create({
            exam: fixture.exam._id,
            createdBy: fixture.professor._id,
            scoreStep: 1,
            questions: [{ questionNumber: 1, maxMarks: 10, criteria: [{ criterionName: 'Acc', points: 10 }] }],
            isActive: true
        });
        await Grade.create({
            answerScript: fixture.script._id,
            rubric: rubric._id,
            gradedBy: fixture.ta._id, // TA originally graded this!
            question: 1,
            totalScore: 7,
            isFinal: true
        });

        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        const response = await assign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.message).toContain('Reviewer cannot be the original grader');
    });

    it('revokes reviewer access to answer pages when the regrade is resolved', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        await assign(fixture.regrade._id.toString(), fixture.ta._id.toString());

        // While OPEN, TA can access pages
        mockSessionUser = { id: fixture.ta._id.toString(), role: UserRole.TA };
        const openPages = await getPages(
            new NextRequest(`http://localhost:3000/api/scripts/${fixture.script._id}/pages`),
            { params: Promise.resolve({ id: fixture.script._id.toString() }) }
        );
        expect(openPages.status).toBe(200);

        // Resolve regrade request
        await RegradeRequest.updateOne(
            { _id: fixture.regrade._id },
            { $set: { status: RegradeStatus.RESOLVED, isOpen: false } }
        );

        // Once RESOLVED, access must be revoked (403 Forbidden)
        const resolvedPages = await getPages(
            new NextRequest(`http://localhost:3000/api/scripts/${fixture.script._id}/pages`),
            { params: Promise.resolve({ id: fixture.script._id.toString() }) }
        );
        expect(resolvedPages.status).toBe(403);
    });

    it('revokes reviewer access to answer pages when TA is removed from course staff', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        await assign(fixture.regrade._id.toString(), fixture.ta._id.toString());

        // Remove TA from course teaching assistants
        await Course.updateOne(
            { _id: fixture.course._id },
            { $set: { teachingAssistants: [] } }
        );

        // Even though regrade request assignedTo is still TA, TA is no longer course staff
        mockSessionUser = { id: fixture.ta._id.toString(), role: UserRole.TA };
        const removedPages = await getPages(
            new NextRequest(`http://localhost:3000/api/scripts/${fixture.script._id}/pages`),
            { params: Promise.resolve({ id: fixture.script._id.toString() }) }
        );
        expect(removedPages.status).toBe(403);
    });

    it('enforces image-route authorization: assigned reviewer TA can access while OPEN, revoked when resolved, course inactive, or TA removed', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        await assign(fixture.regrade._id.toString(), fixture.ta._id.toString());

        // 1. While regrade is OPEN and course is active, assigned reviewer TA can access image
        mockSessionUser = { id: fixture.ta._id.toString(), role: UserRole.TA };
        const openImage = await getImage(
            new NextRequest(`http://localhost:3000/api/ingest/${fixture.batch.batchId}/pages/${fixture.page._id}/image`),
            { params: Promise.resolve({ id: fixture.batch.batchId, pageId: fixture.page._id.toString() }) }
        );
        expect(openImage.status).toBe(200);

        // 2. Unassigned TA receives 404
        mockSessionUser = { id: fixture.otherTa._id.toString(), role: UserRole.TA };
        const unassignedImage = await getImage(
            new NextRequest(`http://localhost:3000/api/ingest/${fixture.batch.batchId}/pages/${fixture.page._id}/image`),
            { params: Promise.resolve({ id: fixture.batch.batchId, pageId: fixture.page._id.toString() }) }
        );
        expect(unassignedImage.status).toBe(404);

        // 3. When course is inactive (course.isActive: false), reviewer and professor access to pages, image, and decide is denied with 404
        await Course.updateOne(
            { _id: fixture.course._id },
            { $set: { isActive: false } }
        );
        mockSessionUser = { id: fixture.ta._id.toString(), role: UserRole.TA };
        const inactivePages = await getPages(
            new NextRequest(`http://localhost:3000/api/scripts/${fixture.script._id}/pages`),
            { params: Promise.resolve({ id: fixture.script._id.toString() }) }
        );
        expect(inactivePages.status).toBe(404);

        const inactiveImage = await getImage(
            new NextRequest(`http://localhost:3000/api/ingest/${fixture.batch.batchId}/pages/${fixture.page._id}/image`),
            { params: Promise.resolve({ id: fixture.batch.batchId, pageId: fixture.page._id.toString() }) }
        );
        expect(inactiveImage.status).toBe(404);

        const inactiveDecide = await patchDecision(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${fixture.regrade._id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ outcome: RegradeDecisionOutcome.REJECTED, reason: 'Course is inactive' })
            }),
            { params: Promise.resolve({ id: fixture.regrade._id.toString() }) }
        );
        expect(inactiveDecide.status).toBe(404);

        // Also for professor when course is inactive:
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        const profInactivePages = await getPages(
            new NextRequest(`http://localhost:3000/api/scripts/${fixture.script._id}/pages`),
            { params: Promise.resolve({ id: fixture.script._id.toString() }) }
        );
        expect(profInactivePages.status).toBe(404);

        const profInactiveImage = await getImage(
            new NextRequest(`http://localhost:3000/api/ingest/${fixture.batch.batchId}/pages/${fixture.page._id}/image`),
            { params: Promise.resolve({ id: fixture.batch.batchId, pageId: fixture.page._id.toString() }) }
        );
        expect(profInactiveImage.status).toBe(404);

        const profInactiveDecide = await patchDecision(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${fixture.regrade._id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ outcome: RegradeDecisionOutcome.REJECTED, reason: 'Course is inactive' })
            }),
            { params: Promise.resolve({ id: fixture.regrade._id.toString() }) }
        );
        expect(profInactiveDecide.status).toBe(404);

        // Re-activate course
        await Course.updateOne(
            { _id: fixture.course._id },
            { $set: { isActive: true } }
        );
        mockSessionUser = { id: fixture.ta._id.toString(), role: UserRole.TA };

        // 4. When regrade request is RESOLVED, reviewer image access is revoked
        await RegradeRequest.updateOne(
            { _id: fixture.regrade._id },
            { $set: { status: RegradeStatus.RESOLVED, isOpen: false } }
        );
        const resolvedImage = await getImage(
            new NextRequest(`http://localhost:3000/api/ingest/${fixture.batch.batchId}/pages/${fixture.page._id}/image`),
            { params: Promise.resolve({ id: fixture.batch.batchId, pageId: fixture.page._id.toString() }) }
        );
        expect(resolvedImage.status).toBe(404);

        // 5. When TA is removed from course staff, image access is revoked
        await RegradeRequest.updateOne(
            { _id: fixture.regrade._id },
            { $set: { status: RegradeStatus.OPEN, isOpen: true } }
        );
        await Course.updateOne(
            { _id: fixture.course._id },
            { $set: { teachingAssistants: [] } }
        );
        const removedImage = await getImage(
            new NextRequest(`http://localhost:3000/api/ingest/${fixture.batch.batchId}/pages/${fixture.page._id}/image`),
            { params: Promise.resolve({ id: fixture.batch.batchId, pageId: fixture.page._id.toString() }) }
        );
        expect(removedImage.status).toBe(404);
    });
});
