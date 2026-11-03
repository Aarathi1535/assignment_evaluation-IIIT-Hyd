import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import ClassroomSession from '../models/ClassroomSession';
import ClassroomParticipant from '../models/ClassroomParticipant';
import ClassroomQuestion from '../models/ClassroomQuestion';
import ClassroomSubmission from '../models/ClassroomSubmission';
import classroomSessionService from '../services/ClassroomSessionService';
import ClassroomEventService, { ClassroomRealtimeEvent } from '../services/ClassroomEventService';
import { generateQRCodeSvg, generateJoinCode } from '../lib/classroomQr';

describe('Classroom Activity MVP - Complete Workflow', () => {
    let professorId: mongoose.Types.ObjectId;
    let studentId: mongoose.Types.ObjectId;

    // Minimal 1x1 valid PNG buffer (magic bytes: 89 50 4E 47)
    const validPngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
    ]);

    beforeEach(async () => {
        professorId = new mongoose.Types.ObjectId('000000000000000000000101');
        studentId = new mongoose.Types.ObjectId('000000000000000000000102');

        await ClassroomSession.deleteMany({});
        await ClassroomParticipant.deleteMany({});
        await ClassroomQuestion.deleteMany({});
        await ClassroomSubmission.deleteMany({});
        ClassroomEventService.reset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('1. Generates unique 6-character join code and SVG QR code', () => {
        const code1 = generateJoinCode();
        const code2 = generateJoinCode();

        expect(code1).toMatch(/^[A-Z2-9]{6}$/);
        expect(code2).toMatch(/^[A-Z2-9]{6}$/);
        // Excludes ambiguous 0, O, 1, I
        expect(code1).not.toMatch(/[01OI]/);

        const qrSvg = generateQRCodeSvg('/classroom/session/ABC234', 240);
        expect(qrSvg).toContain('<svg');
        expect(qrSvg).toContain('viewBox=');
        expect(qrSvg).toContain('</svg>');
    });

    it('2. Professor creates classroom session and activity with question, reference answer, and time limit', async () => {
        const context = {
            actingUserId: professorId.toString(),
            actingUserRole: 'PROFESSOR'
        };

        const result = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Data Structures: AVL Tree Rotations',
                questionPrompt: 'Insert key 45 into the given AVL tree and sketch the balanced tree.',
                referenceAnswer: 'Root 30, Left 20, Right 45 after right-left rotation.',
                timeLimit: 120
            },
            context
        );

        expect(result.session).toBeDefined();
        expect(result.activity).toBeDefined();
        expect(result.joinCode).toHaveLength(6);
        expect(result.qrCodeSvg).toContain('<svg');

        // Verify session in DB
        const dbSession = await ClassroomSession.findById(result.session._id);
        expect(dbSession).toBeDefined();
        expect(dbSession?.title).toBe('Data Structures: AVL Tree Rotations');
        expect(dbSession?.joinCode).toBe(result.joinCode);
        expect(dbSession?.status).toBe('ACTIVE');

        // Verify activity in DB
        const dbActivity = await ClassroomQuestion.findById(result.activity._id);
        expect(dbActivity).toBeDefined();
        expect(dbActivity?.title).toBe('Data Structures: AVL Tree Rotations');
        expect(dbActivity?.questionPrompt).toContain('Insert key 45');
        expect(dbActivity?.referenceAnswer).toContain('Root 30, Left 20');
        expect(dbActivity?.timeLimit).toBe(120);
        expect(dbActivity?.status).toBe('ACTIVE');
        expect(dbActivity?.expiresAt).toBeDefined();
    });

    it('3. Rejects session creation if caller is not a Professor', async () => {
        const context = {
            actingUserId: studentId.toString(),
            actingUserRole: 'STUDENT'
        };

        await expect(
            classroomSessionService.createSessionAndActivity(
                {
                    title: 'Illegal Session',
                    questionPrompt: 'Unauthorized prompt',
                    referenceAnswer: 'Ref'
                },
                context
            )
        ).rejects.toThrow(/Forbidden: Only professors/);
    });

    it('4. Students join using join code and classroom-specific participant identity', async () => {
        const profContext = {
            actingUserId: professorId.toString(),
            actingUserRole: 'PROFESSOR'
        };

        const { joinCode } = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Operating Systems: Deadlock Detection',
                questionPrompt: 'Draw the Resource Allocation Graph and check for cycle.',
                referenceAnswer: 'Cycle exists: P1 -> R1 -> P2 -> R2 -> P1, Deadlock present.'
            },
            profContext
        );

        // Student joins with classroom-specific name
        const joinRes = await classroomSessionService.joinSession(joinCode, 'Roll 20261001 - Aarathi');

        expect(joinRes.participant).toBeDefined();
        expect(joinRes.participant.id).toMatch(/^part_/);
        expect(joinRes.participant.token).toMatch(/^tok_/);
        expect(joinRes.participant.name).toBe('Roll 20261001 - Aarathi');
        expect(joinRes.session.joinCode).toBe(joinCode);
        expect(joinRes.activeActivity?.questionPrompt).toContain('Draw the Resource Allocation Graph');

        // Security check: reference answer is NOT exposed to joining student before publication
        expect((joinRes.activeActivity as Record<string, unknown>).referenceAnswer).toBeUndefined();

        // Verify participant stored in DB
        const dbPart = await classroomSessionService.getParticipantByToken(joinRes.participant.token);
        expect(dbPart).toBeDefined();
        expect(dbPart?.name).toBe('Roll 20261001 - Aarathi');
    });

    it('5. Students upload an image of their handwritten answer with validation and storage security', async () => {
        const profContext = {
            actingUserId: professorId.toString(),
            actingUserRole: 'PROFESSOR'
        };

        const { joinCode } = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Algorithm Design',
                questionPrompt: 'Write the recurrence relation for Merge Sort.',
                referenceAnswer: 'T(n) = 2T(n/2) + O(n), gives O(n log n).'
            },
            profContext
        );

        const joinRes = await classroomSessionService.joinSession(joinCode, 'Student Bob');

        // Valid image submission
        const submission = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: joinCode,
            participantId: joinRes.participant.id,
            studentName: joinRes.participant.name,
            fileBuffer: validPngBuffer,
            originalFilename: 'answer.png',
            mimeType: 'image/png'
        });

        expect(submission).toBeDefined();
        expect(submission.imagePath).toContain('classroom-uploads');
        expect(submission.status).toBe('SUBMITTED');
        expect(submission.studentName).toBe('Student Bob');

        // Verify totalSubmissions count incremented
        const session = await ClassroomSession.findOne({ joinCode });
        const activity = await ClassroomQuestion.findById(session?.currentActivity);
        expect(activity?.totalSubmissions).toBe(1);

        // Reject invalid mime type / fake buffer
        await expect(
            classroomSessionService.submitHandwrittenAnswer({
                sessionCode: joinCode,
                participantId: 'part_fake',
                studentName: 'Hacker',
                fileBuffer: Buffer.from('NOT_AN_IMAGE'),
                originalFilename: 'hack.exe',
                mimeType: 'application/x-msdownload'
            })
        ).rejects.toThrow(/Invalid image format/);
    });

    it('6. Professor extends timer and closes submissions manually or automatically', async () => {
        const profContext = {
            actingUserId: professorId.toString(),
            actingUserRole: 'PROFESSOR'
        };

        const { joinCode } = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Network Topologies',
                questionPrompt: 'Compare Star and Ring topologies in terms of fault tolerance.',
                referenceAnswer: 'Star topology fails if central hub fails, Ring requires dual-ring.',
                timeLimit: 60
            },
            profContext
        );

        // Extend timer by 90 seconds
        const extended = await classroomSessionService.extendTimer(joinCode, 90, profContext);
        expect(extended.expiresAt).toBeDefined();

        // Close submissions manually
        const closed = await classroomSessionService.closeSubmissions(joinCode, profContext);
        expect(closed.status).toBe('CLOSED');
        expect(closed.closedAt).toBeDefined();

        // Subsequent submission is rejected because submissions are closed
        await expect(
            classroomSessionService.submitHandwrittenAnswer({
                sessionCode: joinCode,
                participantId: 'part_late',
                studentName: 'Late Student',
                fileBuffer: validPngBuffer,
                originalFilename: 'late.png',
                mimeType: 'image/png'
            })
        ).rejects.toThrow(/Submissions are currently closed/);
    });

    it('7. Professor reviews submissions and marks each correct or incorrect', async () => {
        const profContext = {
            actingUserId: professorId.toString(),
            actingUserRole: 'PROFESSOR'
        };

        const { joinCode, activity } = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Database Normalization',
                questionPrompt: 'Find candidate keys of R(A, B, C, D) with F={AB->C, C->D, D->A}.',
                referenceAnswer: 'Candidate keys are AB, BC, BD.'
            },
            profContext
        );

        // Student 1 submits
        const s1 = await classroomSessionService.joinSession(joinCode, 'Alice');
        const sub1 = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: joinCode,
            participantId: s1.participant.id,
            studentName: s1.participant.name,
            fileBuffer: validPngBuffer,
            originalFilename: 'alice.png',
            mimeType: 'image/png'
        });

        // Student 2 submits
        const s2 = await classroomSessionService.joinSession(joinCode, 'Bob');
        const sub2 = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: joinCode,
            participantId: s2.participant.id,
            studentName: s2.participant.name,
            fileBuffer: validPngBuffer,
            originalFilename: 'bob.png',
            mimeType: 'image/png'
        });

        // Professor marks Alice correct
        const reviewedAlice = await classroomSessionService.reviewSubmission(
            sub1._id.toString(),
            true,
            'Clear derivation',
            profContext
        );
        expect(reviewedAlice.isCorrect).toBe(true);
        expect(reviewedAlice.status).toBe('REVIEWED');

        // Professor marks Bob incorrect
        const reviewedBob = await classroomSessionService.reviewSubmission(
            sub2._id.toString(),
            false,
            'Missing candidate key BD',
            profContext
        );
        expect(reviewedBob.isCorrect).toBe(false);
        expect(reviewedBob.status).toBe('REVIEWED');

        // Question tracks updated correct and incorrect counts
        const updatedAct = await ClassroomQuestion.findById(activity._id);
        expect(updatedAct?.correctCount).toBe(1);
        expect(updatedAct?.incorrectCount).toBe(1);
    });

    it('8. Professor publishes results: reveals correct answer and aggregate statistics', async () => {
        const profContext = {
            actingUserId: professorId.toString(),
            actingUserRole: 'PROFESSOR'
        };

        const { joinCode, activity } = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Computer Architecture: Pipelining',
                questionPrompt: 'Calculate speedup with 5-stage pipeline for 100 instructions.',
                referenceAnswer: 'Speedup = (100 * 5) / (5 + 99) = 500 / 104 ≈ 4.8x'
            },
            profContext
        );

        // Three students submit
        const s1 = await classroomSessionService.joinSession(joinCode, 'Student 1');
        const sub1 = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: joinCode,
            participantId: s1.participant.id,
            studentName: s1.participant.name,
            fileBuffer: validPngBuffer,
            mimeType: 'image/png'
        });

        const s2 = await classroomSessionService.joinSession(joinCode, 'Student 2');
        const sub2 = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: joinCode,
            participantId: s2.participant.id,
            studentName: s2.participant.name,
            fileBuffer: validPngBuffer,
            mimeType: 'image/png'
        });

        // Review submissions: 2 correct
        await classroomSessionService.reviewSubmission(sub1._id.toString(), true, null, profContext);
        await classroomSessionService.reviewSubmission(sub2._id.toString(), true, null, profContext);

        // Professor publishes results
        const publishedResults = await classroomSessionService.publishResults(joinCode, profContext);

        expect(publishedResults.referenceAnswer).toContain('Speedup = (100 * 5)');
        expect(publishedResults.totalSubmissions).toBe(2);
        expect(publishedResults.correctCount).toBe(2);
        expect(publishedResults.incorrectCount).toBe(0);
        expect(publishedResults.successRate).toBe(100);

        // Verify publicly accessible via getPublishedResults
        const publicResults = await classroomSessionService.getPublishedResults(activity._id.toString());
        expect(publicResults).toBeDefined();
        expect(publicResults?.referenceAnswer).toBe(publishedResults.referenceAnswer);
        expect(publicResults?.totalSubmissions).toBe(2);
    });

    it('9. Dispatches real-time SSE events throughout the lifecycle', async () => {
        const profContext = {
            actingUserId: professorId.toString(),
            actingUserRole: 'PROFESSOR'
        };

        const receivedEvents: ClassroomRealtimeEvent[] = [];
        const unsubscribe = ClassroomEventService.subscribe((event) => {
            receivedEvents.push(event);
        });

        const { joinCode } = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Real-time Event Verification',
                questionPrompt: 'Is real-time dispatch working?',
                referenceAnswer: 'Yes, event bus dispatches on transitions.'
            },
            profContext
        );

        expect(receivedEvents.some(e => e.type === 'QUESTION_ACTIVATED')).toBe(true);

        const student = await classroomSessionService.joinSession(joinCode, 'Tester');
        expect(receivedEvents.some(e => e.type === 'SESSION_JOINED')).toBe(true);

        const sub = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: joinCode,
            participantId: student.participant.id,
            studentName: student.participant.name,
            fileBuffer: validPngBuffer,
            mimeType: 'image/png'
        });
        expect(receivedEvents.some(e => e.type === 'SUBMISSION_RECEIVED')).toBe(true);

        await classroomSessionService.reviewSubmission(sub._id.toString(), true, null, profContext);
        expect(receivedEvents.some(e => e.type === 'SUBMISSION_REVIEWED')).toBe(true);

        await classroomSessionService.publishResults(joinCode, profContext);
        expect(receivedEvents.some(e => e.type === 'ACTIVITY_PUBLISHED')).toBe(true);

        unsubscribe();
    });
});
