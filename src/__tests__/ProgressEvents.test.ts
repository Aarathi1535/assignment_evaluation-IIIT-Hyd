/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AuditLog from '../models/AuditLog';
import AllocationService from '../services/AllocationService';
import ProgressEventService, { ProgressUpdateEvent } from '../services/ProgressEventService';
import { HttpError } from '../lib/errors';

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

describe('AE-102: Cross-Instance Live Progress Updates', () => {
    let streamGET: any;

    let prof: any;
    let admin: any;
    let ta1: any;
    let ta2: any;
    let student1: any;
    let student2: any;

    let course: any;
    let exam1: any;
    let exam2: any;

    let script1: any;
    let script2: any;
    let script3: any;

    let alloc1: any;
    let alloc2: any;
    let alloc3: any;

    beforeAll(async () => {
        streamGET = (await import('../app/api/exams/[id]/progress/stream/route')).GET;

        await User.init();
        await Course.init();
        await Exam.init();
        await AnswerScript.init();
        await Allocation.init();
        await AuditLog.init();
    });

    afterAll(async () => {
        ProgressEventService.clearListeners();
        await ProgressEventService.stopChangeStream();
    });

    beforeEach(async () => {
        ProgressEventService.clearListeners();
        mockSessionUser = null;

        await AuditLog.deleteMany({});
        await Allocation.deleteMany({});
        await AnswerScript.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        prof = await User.create({
            name: 'Prof. McGonagall',
            email: 'mcgonagall@hogwarts.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        admin = await User.create({
            name: 'Admin Albus',
            email: 'albus@hogwarts.edu',
            password: 'password123',
            role: UserRole.ADMIN,
            isActive: true
        });

        ta1 = await User.create({
            name: 'Hermione Granger',
            email: 'hermione@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        ta2 = await User.create({
            name: 'Ron Weasley',
            email: 'ron@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        student1 = await User.create({
            name: 'Harry Potter',
            email: 'harry@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        student2 = await User.create({
            name: 'Draco Malfoy',
            email: 'draco@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: 'TRANS101',
            courseName: 'Transfiguration 101',
            semester: 1,
            academicYear: '2026-2027',
            professor: prof._id,
            teachingAssistants: [ta1._id, ta2._id],
            enrolledStudents: [student1._id, student2._id],
            isActive: true
        });

        exam1 = await Exam.create({
            title: 'Midterm Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 3,
            isActive: true
        });

        exam2 = await Exam.create({
            title: 'Final Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 3,
            isActive: true
        });

        script1 = await AnswerScript.create({
            exam: exam1._id,
            student: student1._id,
            filePath: '/scans/trans/script1.pdf',
            filename: 'script1.pdf',
            startPageNumber: 1,
            endPageNumber: 4,
            pageCount: 4,
            candidateStudentId: 'ROLL-001',
            isActive: true
        });

        script2 = await AnswerScript.create({
            exam: exam1._id,
            student: student2._id,
            filePath: '/scans/trans/script2.pdf',
            filename: 'script2.pdf',
            startPageNumber: 1,
            endPageNumber: 4,
            pageCount: 4,
            candidateStudentId: 'ROLL-002',
            isActive: true
        });

        script3 = await AnswerScript.create({
            exam: exam2._id,
            student: student1._id,
            filePath: '/scans/trans/script3.pdf',
            filename: 'script3.pdf',
            startPageNumber: 1,
            endPageNumber: 4,
            pageCount: 4,
            candidateStudentId: 'ROLL-003',
            isActive: true
        });

        alloc1 = await Allocation.create({
            exam: exam1._id,
            answerScript: script1._id,
            ta: ta1._id,
            allocatedBy: prof._id,
            rule: AllocationRule.EQUAL,
            status: AllocationStatus.IN_PROGRESS
        });

        alloc2 = await Allocation.create({
            exam: exam1._id,
            answerScript: script2._id,
            ta: ta2._id,
            allocatedBy: prof._id,
            rule: AllocationRule.EQUAL,
            status: AllocationStatus.IN_PROGRESS
        });

        alloc3 = await Allocation.create({
            exam: exam2._id,
            answerScript: script3._id,
            ta: ta1._id,
            allocatedBy: prof._id,
            rule: AllocationRule.EQUAL,
            status: AllocationStatus.IN_PROGRESS
        });
    });

    describe('1. Shared Event Propagation & Service Layer', () => {
        it('emits a progress update event upon successful markCompleted transition', async () => {
            const receivedEvents: ProgressUpdateEvent[] = [];
            const unsubscribe = ProgressEventService.subscribe(exam1._id.toString(), (event) => {
                receivedEvents.push(event);
            });

            await AllocationService.markCompleted(alloc1._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            expect(receivedEvents.length).toBe(1);
            const event = receivedEvents[0];

            expect(event.examId).toBe(exam1._id.toString());
            expect(event.taId).toBe(ta1._id.toString());
            expect(event.taProgress.name).toBe('Hermione Granger');
            expect(event.taProgress.graded).toBe(1);
            expect(event.taProgress.total).toBe(1);

            expect(event.examProgress.examId).toBe(exam1._id.toString());
            expect(event.examProgress.graded).toBe(1);
            expect(event.examProgress.total).toBe(2);

            unsubscribe();
        });

        it('strictly isolates events by examId', async () => {
            const exam1Events: ProgressUpdateEvent[] = [];
            const exam2Events: ProgressUpdateEvent[] = [];

            const unsub1 = ProgressEventService.subscribe(exam1._id.toString(), (event) => {
                exam1Events.push(event);
            });
            const unsub2 = ProgressEventService.subscribe(exam2._id.toString(), (event) => {
                exam2Events.push(event);
            });

            // Complete allocation in exam1
            await AllocationService.markCompleted(alloc1._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            expect(exam1Events.length).toBe(1);
            expect(exam1Events[0].examId).toBe(exam1._id.toString());
            expect(exam2Events.length).toBe(0);

            // Complete allocation in exam2
            await AllocationService.markCompleted(alloc3._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            expect(exam1Events.length).toBe(1);
            expect(exam2Events.length).toBe(1);
            expect(exam2Events[0].examId).toBe(exam2._id.toString());

            unsub1();
            unsub2();
        });

        it('identifies the affected TA and reflects accurate graded/total values', async () => {
            const receivedEvents: ProgressUpdateEvent[] = [];
            const unsub = ProgressEventService.subscribe(exam1._id.toString(), (event) => {
                receivedEvents.push(event);
            });

            // Hermione completes her script
            await AllocationService.markCompleted(alloc1._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            expect(receivedEvents[0].taId).toBe(ta1._id.toString());
            expect(receivedEvents[0].taProgress.graded).toBe(1);
            expect(receivedEvents[0].taProgress.total).toBe(1);

            // Ron completes his script (backup operator override by Professor)
            await AllocationService.markCompleted(alloc2._id.toString(), {
                actingUserId: prof._id.toString(),
                actingUserRole: UserRole.PROFESSOR
            });

            expect(receivedEvents.length).toBe(2);
            expect(receivedEvents[1].taId).toBe(ta2._id.toString());
            expect(receivedEvents[1].taProgress.name).toBe('Ron Weasley');
            expect(receivedEvents[1].taProgress.graded).toBe(1);
            expect(receivedEvents[1].taProgress.total).toBe(1);
            expect(receivedEvents[1].examProgress.graded).toBe(2);
            expect(receivedEvents[1].examProgress.total).toBe(2);

            unsub();
        });

        it('does NOT expose student PII in the event payload', async () => {
            let capturedEvent: ProgressUpdateEvent | null = null;
            const unsub = ProgressEventService.subscribe(exam1._id.toString(), (event) => {
                capturedEvent = event;
            });

            await AllocationService.markCompleted(alloc1._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            expect(capturedEvent).not.toBeNull();
            const jsonString = JSON.stringify(capturedEvent);

            expect(jsonString).not.toContain('Harry');
            expect(jsonString).not.toContain('Potter');
            expect(jsonString).not.toContain('harry@hogwarts.edu');
            expect(jsonString).not.toContain('ROLL-001');
            expect(jsonString).not.toContain('script1.pdf');
            expect(jsonString).not.toContain('answerScript');
            expect(jsonString).not.toContain('student');

            // TA identity is permitted for professor progress view
            expect(jsonString).toContain('Hermione Granger');

            unsub();
        });

        it('supports multiple independent consumers receiving the same event', async () => {
            const consumer1Events: ProgressUpdateEvent[] = [];
            const consumer2Events: ProgressUpdateEvent[] = [];

            // Simulating two separate container listeners or client connections
            const unsub1 = ProgressEventService.subscribe(exam1._id.toString(), (e) => consumer1Events.push(e));
            const unsub2 = ProgressEventService.subscribe(exam1._id.toString(), (e) => consumer2Events.push(e));

            await AllocationService.markCompleted(alloc1._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            expect(consumer1Events.length).toBe(1);
            expect(consumer2Events.length).toBe(1);
            expect(consumer1Events[0]).toEqual(consumer2Events[0]);

            unsub1();
            unsub2();
        });

        it('does not emit an event when completion fails or is rejected', async () => {
            const events: ProgressUpdateEvent[] = [];
            const unsub = ProgressEventService.subscribe(exam1._id.toString(), (e) => events.push(e));

            const student3 = await User.create({
                name: 'Neville Longbottom',
                email: 'neville@hogwarts.edu',
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            const pendingScript = await AnswerScript.create({
                exam: exam1._id,
                student: student3._id,
                filePath: '/scans/trans/pending.pdf',
                filename: 'pending.pdf',
                startPageNumber: 9,
                endPageNumber: 12,
                pageCount: 4,
                candidateStudentId: 'ROLL-004',
                isActive: true
            });

            const pendingAlloc = await Allocation.create({
                exam: exam1._id,
                answerScript: pendingScript._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.PENDING
            });

            await expect(
                AllocationService.markCompleted(pendingAlloc._id.toString(), {
                    actingUserId: ta1._id.toString(),
                    actingUserRole: UserRole.TA
                })
            ).rejects.toThrow(HttpError);

            expect(events.length).toBe(0);

            await expect(
                AllocationService.markCompleted(alloc1._id.toString(), {
                    actingUserId: ta2._id.toString(),
                    actingUserRole: UserRole.TA
                })
            ).rejects.toThrow(HttpError);

            expect(events.length).toBe(0);

            await expect(
                AllocationService.markCompleted('60c72b2f9b1d8a001f8e9999', {
                    actingUserId: prof._id.toString(),
                    actingUserRole: UserRole.PROFESSOR
                })
            ).rejects.toThrow(HttpError);

            expect(events.length).toBe(0);

            unsub();
        });

        it('does NOT emit duplicate events on repeated completion (idempotency / 409 Conflict)', async () => {
            const events: ProgressUpdateEvent[] = [];
            const unsub = ProgressEventService.subscribe(exam1._id.toString(), (e) => events.push(e));

            // First completion succeeds
            await AllocationService.markCompleted(alloc1._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });
            expect(events.length).toBe(1);

            // Second completion throws 409 Conflict
            await expect(
                AllocationService.markCompleted(alloc1._id.toString(), {
                    actingUserId: ta1._id.toString(),
                    actingUserRole: UserRole.TA
                })
            ).rejects.toThrow('Allocation is already completed');

            expect(events.length).toBe(1);

            unsub();
        });
    });

    describe('2. Server-Sent Events (SSE) Route Handler (/api/exams/[id]/progress/stream)', () => {
        it('allows authorized Professor to connect to the SSE progress stream', async () => {
            mockSessionUser = {
                id: prof._id.toString(),
                role: UserRole.PROFESSOR,
                email: prof.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress/stream`);
            const res = await streamGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('text/event-stream');
            expect(res.headers.get('cache-control')).toContain('no-cache');

            // Read the initial event from the stream
            const reader = res.body!.getReader();
            const { value } = await reader.read();
            const decoded = new TextDecoder().decode(value);

            expect(decoded).toContain('event: initial');
            expect(decoded).toContain(exam1._id.toString());
            expect(decoded).toContain('total');
            expect(decoded).toContain('graded');

            reader.releaseLock();
            await res.body!.cancel();
        });

        it('allows authorized Admin to connect to the SSE progress stream', async () => {
            mockSessionUser = {
                id: admin._id.toString(),
                role: UserRole.ADMIN,
                email: admin.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress/stream`);
            const res = await streamGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('text/event-stream');

            await res.body!.cancel();
        });

        it('rejects unauthorized TA connection with 403 Forbidden', async () => {
            mockSessionUser = {
                id: ta1._id.toString(),
                role: UserRole.TA,
                email: ta1.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress/stream`);
            const res = await streamGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.message).toContain('Forbidden');
        });

        it('rejects unauthorized Student connection with 403 Forbidden', async () => {
            mockSessionUser = {
                id: student1._id.toString(),
                role: UserRole.STUDENT,
                email: student1.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress/stream`);
            const res = await streamGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(403);
        });

        it('rejects invalid Exam ID format with 400 Bad Request', async () => {
            mockSessionUser = {
                id: prof._id.toString(),
                role: UserRole.PROFESSOR,
                email: prof.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/invalid-id/progress/stream`);
            const res = await streamGET(req, {
                params: Promise.resolve({ id: 'invalid-id' })
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.message).toContain('Invalid ID format');
        });

        it('returns 404 Not Found for non-existent exam', async () => {
            mockSessionUser = {
                id: prof._id.toString(),
                role: UserRole.PROFESSOR,
                email: prof.email
            };

            const nonExistentId = '60c72b2f9b1d8a001f8e9999';
            const req = new NextRequest(`http://localhost:3000/api/exams/${nonExistentId}/progress/stream`);
            const res = await streamGET(req, {
                params: Promise.resolve({ id: nonExistentId })
            });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.message).toContain('Exam not found');
        });

        it('streams live progress event to connected client when allocation completes', async () => {
            mockSessionUser = {
                id: prof._id.toString(),
                role: UserRole.PROFESSOR,
                email: prof.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress/stream`);
            const res = await streamGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(200);
            const reader = res.body!.getReader();

            // Read initial event
            const initial = await reader.read();
            const initialText = new TextDecoder().decode(initial.value);
            expect(initialText).toContain('event: initial');

            // Trigger allocation completion in the background
            await AllocationService.markCompleted(alloc1._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            // Read events until progress is received (in standalone test env, live_updates_unavailable may precede it)
            let combinedText = '';
            while (!combinedText.includes('event: progress')) {
                const chunk = await reader.read();
                if (chunk.done) break;
                combinedText += new TextDecoder().decode(chunk.value);
            }

            expect(combinedText).toContain('event: progress');
            expect(combinedText).toContain(exam1._id.toString());
            expect(combinedText).toContain(ta1._id.toString());
            expect(combinedText).toContain('Hermione Granger');

            reader.releaseLock();
            await res.body!.cancel();
        });
    });

    describe('3. Change Stream Degradation & Observability (AE-102 Feedback J2)', () => {
        it('activates degraded mode when change stream initialization fails and emits degraded event', async () => {
            const unavailablePromise = new Promise<any>((resolve) => {
                ProgressEventService.subscribeLiveUpdatesUnavailable(resolve);
            });

            await ProgressEventService.startChangeStream();
            const unavailableEvent = await unavailablePromise;

            expect(ProgressEventService.isDegradedMode()).toBe(true);
            expect(unavailableEvent).not.toBeNull();
            expect(unavailableEvent.message).toBe('Live updates unavailable — refresh to see progress.');
        });

        it('degraded notification strictly contains NO student PII, TA data, or internal MongoDB errors', async () => {
            const unavailablePromise = new Promise<any>((resolve) => {
                ProgressEventService.subscribeLiveUpdatesUnavailable(resolve);
            });

            await ProgressEventService.startChangeStream();
            const capturedEvent = await unavailablePromise;

            expect(capturedEvent).not.toBeNull();
            const json = JSON.stringify(capturedEvent);

            expect(json).toBe('{"message":"Live updates unavailable — refresh to see progress."}');
            expect(json).not.toContain('MongoServerError');
            expect(json).not.toContain('replica');
            expect(json).not.toContain('changeStream');
            expect(json).not.toContain('Harry');
            expect(json).not.toContain('Hermione');
            expect(json).not.toContain('graded');
        });

        it('does not emit duplicate degraded events for multiple subscribers or repeated start calls', async () => {
            let sub1Count = 0;
            let sub2Count = 0;

            const unsub1 = ProgressEventService.subscribeLiveUpdatesUnavailable(() => { sub1Count++; });
            const unsub2 = ProgressEventService.subscribeLiveUpdatesUnavailable(() => { sub2Count++; });

            // Trigger initial degradation
            await ProgressEventService.startChangeStream();
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(sub1Count).toBe(1);
            expect(sub2Count).toBe(1);

            // Repeated start calls should not re-trigger degraded event
            await ProgressEventService.startChangeStream();
            await ProgressEventService.startChangeStream();
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(sub1Count).toBe(1);
            expect(sub2Count).toBe(1);

            unsub1();
            unsub2();
        });

        it('SSE route forwards event: live_updates_unavailable when connected in degraded mode', async () => {
            mockSessionUser = {
                id: prof._id.toString(),
                role: UserRole.PROFESSOR,
                email: prof.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress/stream`);
            const res = await streamGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(200);
            const reader = res.body!.getReader();

            // Read initial event
            const initial = await reader.read();
            const initialText = new TextDecoder().decode(initial.value);
            expect(initialText).toContain('event: initial');

            // Wait for / read live_updates_unavailable event
            const degraded = await reader.read();
            const degradedText = new TextDecoder().decode(degraded.value);
            expect(degradedText).toContain('event: live_updates_unavailable');
            expect(degradedText).toContain('Live updates unavailable — refresh to see progress.');
            expect(degradedText).not.toContain('MongoServerError');

            reader.releaseLock();
            await res.body!.cancel();
        });

        it('allows in-process fallback events to continue working when in degraded mode', async () => {
            mockSessionUser = {
                id: prof._id.toString(),
                role: UserRole.PROFESSOR,
                email: prof.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress/stream`);
            const res = await streamGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            const reader = res.body!.getReader();

            // Read initial event
            const initial = await reader.read();
            expect(new TextDecoder().decode(initial.value)).toContain('event: initial');

            // Read degraded event
            const degraded = await reader.read();
            expect(new TextDecoder().decode(degraded.value)).toContain('event: live_updates_unavailable');

            // Now perform in-process allocation completion
            await AllocationService.markCompleted(alloc1._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            // Read streamed progress event (fallback still delivers local updates)
            const progress = await reader.read();
            const progressText = new TextDecoder().decode(progress.value);
            expect(progressText).toContain('event: progress');
            expect(progressText).toContain(exam1._id.toString());
            expect(progressText).toContain('Hermione Granger');

            reader.releaseLock();
            await res.body!.cancel();
        });

        it('cleans up SSE listeners on stream abort/cancel', async () => {
            mockSessionUser = {
                id: prof._id.toString(),
                role: UserRole.PROFESSOR,
                email: prof.email
            };

            const controller = new AbortController();
            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress/stream`, {
                signal: controller.signal
            });

            const res = await streamGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            const reader = res.body!.getReader();
            await reader.read(); // initial

            // Abort client connection
            controller.abort();
            reader.releaseLock();
            await res.body!.cancel();

            // Completing an allocation should succeed without issues
            await expect(
                AllocationService.markCompleted(alloc1._id.toString(), {
                    actingUserId: ta1._id.toString(),
                    actingUserRole: UserRole.TA
                })
            ).resolves.toBeDefined();
        });
    });
});
