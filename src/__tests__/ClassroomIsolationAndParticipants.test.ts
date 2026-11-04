import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import classroomSessionService from '../services/ClassroomSessionService';
import ClassroomAssessmentService from '../services/ClassroomAssessmentService';
import ClassroomSession from '../models/ClassroomSession';
import ClassroomQuestion from '../models/ClassroomQuestion';
import ClassroomParticipant from '../models/ClassroomParticipant';
import ClassroomSubmission from '../models/ClassroomSubmission';
import ClassroomEventService from '../services/ClassroomEventService';
import { NextRequest } from 'next/server';

// Mock requireAuth and next-auth
let currentAuthUser: { id: string; role: string; name?: string; email?: string } | null = null;

vi.mock('@/lib/apiAuth', () => ({
    requireAuth: vi.fn(async () => {
        if (!currentAuthUser) {
            return {
                authorized: false,
                response: new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                })
            };
        }
        return {
            authorized: true,
            user: currentAuthUser
        };
    })
}));

vi.mock('next-auth', () => ({
    getServerSession: vi.fn(async () => {
        if (!currentAuthUser) return null;
        return {
            user: currentAuthUser
        };
    })
}));

describe('Classroom Activity Regression Suite: Professor Isolation & Accurate Participant Count', () => {
    let profAId: string;
    let profBId: string;
    let student1Id: string;
    let student2Id: string;

    const validPngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
        ...new Array(40).fill(0x00)
    ]);

    beforeEach(async () => {
        profAId = new mongoose.Types.ObjectId().toString();
        profBId = new mongoose.Types.ObjectId().toString();
        student1Id = new mongoose.Types.ObjectId().toString();
        student2Id = new mongoose.Types.ObjectId().toString();

        await ClassroomSubmission.deleteMany({});
        await ClassroomParticipant.deleteMany({});
        await ClassroomQuestion.deleteMany({});
        await ClassroomSession.deleteMany({});
        ClassroomEventService.reset();
        currentAuthUser = null;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('1. Professor Session & Question Isolation at Service Level', () => {
        it('prevents Professor B from accessing Professor A session via getSessionByCode', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Prof A Operating Systems',
                    questionPrompt: 'Explain Deadlock avoidance algorithms',
                    timeLimit: 120
                },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            // Professor A can access it
            const ownerAccess = await classroomSessionService.getSessionByCode(
                session.joinCode,
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );
            expect(ownerAccess).toBeDefined();
            expect(ownerAccess?.title).toBe('Prof A Operating Systems');

            // Professor B is denied with 403
            await expect(
                classroomSessionService.getSessionByCode(
                    session.joinCode,
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this classroom session/);
        });

        it('prevents Professor B from controlling Professor A session lifecycle (close, extend, publish)', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Prof A Network Security',
                    questionPrompt: 'Describe Diffie-Hellman Key Exchange',
                    timeLimit: 180
                },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            // Professor B cannot close
            await expect(
                classroomSessionService.closeSubmissions(
                    session.joinCode,
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this classroom session/);

            // Professor B cannot extend timer
            await expect(
                classroomSessionService.extendTimer(
                    session.joinCode,
                    60,
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this classroom session/);

            // Professor B cannot publish results
            await expect(
                classroomSessionService.publishResults(
                    session.joinCode,
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this classroom session/);
        });

        it('prevents Professor B from viewing, updating, or deleting Professor A questions', async () => {
            const questionA = await ClassroomAssessmentService.createQuestion(
                {
                    title: 'Algorithms Question A',
                    questionPrompt: 'What is the runtime of QuickSelect in average case?',
                    type: 'SHORT_ANSWER',
                    maxMarks: 5
                },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            // Professor B cannot get question by ID
            await expect(
                ClassroomAssessmentService.getQuestionById(
                    questionA._id.toString(),
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this question/);

            // Professor B cannot update question
            await expect(
                ClassroomAssessmentService.updateQuestion(
                    questionA._id.toString(),
                    { title: 'Hacked Title' },
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this question/);

            // Professor B cannot delete question
            await expect(
                ClassroomAssessmentService.deleteQuestion(
                    questionA._id.toString(),
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You can only delete your own questions/);

            // Professor A can get and update question
            const fetched = await ClassroomAssessmentService.getQuestionById(
                questionA._id.toString(),
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );
            expect(fetched?.title).toBe('Algorithms Question A');
        });

        it('prevents Professor B from accessing or reviewing submissions belonging to Professor A', async () => {
            const { session, activity } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Calculus Session',
                    questionPrompt: 'Compute derivative of sin(x)*exp(x)',
                    referenceAnswer: 'cos(x)*exp(x) + sin(x)*exp(x)',
                    timeLimit: 120
                },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            const { participant } = await classroomSessionService.joinSession(session.joinCode, 'Student Alice');

            const submission = await classroomSessionService.submitHandwrittenAnswer({
                sessionCode: session.joinCode,
                participantId: participant.id,
                studentName: 'Student Alice',
                fileBuffer: validPngBuffer,
                originalFilename: 'answer.png',
                mimeType: 'image/png',
                answerText: 'cos(x)*exp(x) + sin(x)*exp(x)'
            });

            // Professor B cannot fetch all submissions for activity
            await expect(
                classroomSessionService.getActivitySubmissions(
                    activity._id.toString(),
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this classroom session/);

            // Professor B cannot fetch all submissions via ClassroomAssessmentService
            await expect(
                ClassroomAssessmentService.getQuestionSubmissions(
                    activity._id.toString(),
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You can only view submissions for your own questions/);

            // Professor B cannot get single submission by ID
            await expect(
                ClassroomAssessmentService.getSubmissionById(
                    submission._id.toString(),
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own the session or question for this submission/);

            // Professor B cannot review submission
            await expect(
                classroomSessionService.reviewSubmission(
                    submission._id.toString(),
                    true,
                    'Good job',
                    { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own the session for this submission/);

            // Professor A can review successfully
            const reviewed = await classroomSessionService.reviewSubmission(
                submission._id.toString(),
                true,
                'Verified correct',
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );
            expect(reviewed.status).toBe('REVIEWED');
            expect(reviewed.isCorrect).toBe(true);
        });

        it('isolates active questions: Professor A and Professor B can have simultaneous active questions', async () => {
            // Professor A creates active question
            const qA = await ClassroomAssessmentService.createQuestion(
                {
                    title: 'Active Question Prof A',
                    questionPrompt: 'Question for Prof A class',
                    type: 'MULTIPLE_CHOICE',
                    options: ['Opt1', 'Opt2'],
                    correctOptionIndex: 0,
                    isActive: true
                },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            // Professor B creates active question
            const qB = await ClassroomAssessmentService.createQuestion(
                {
                    title: 'Active Question Prof B',
                    questionPrompt: 'Question for Prof B class',
                    type: 'MULTIPLE_CHOICE',
                    options: ['ChoiceA', 'ChoiceB'],
                    correctOptionIndex: 1,
                    isActive: true
                },
                { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
            );

            // Verify both questions remain ACTIVE in DB
            const checkA = await ClassroomQuestion.findById(qA._id);
            const checkB = await ClassroomQuestion.findById(qB._id);
            expect(checkA?.isActive).toBe(true);
            expect(checkB?.isActive).toBe(true);

            // Professor A gets only Question A
            const activeForA = await ClassroomAssessmentService.getActiveQuestion({
                actingUserId: profAId,
                actingUserRole: 'PROFESSOR'
            });
            expect(String(activeForA?._id)).toBe(qA._id.toString());
            expect(activeForA?.title).toBe('Active Question Prof A');

            // Professor B gets only Question B
            const activeForB = await ClassroomAssessmentService.getActiveQuestion({
                actingUserId: profBId,
                actingUserRole: 'PROFESSOR'
            });
            expect(String(activeForB?._id)).toBe(qB._id.toString());
            expect(activeForB?.title).toBe('Active Question Prof B');

            // Question deck listing is also strictly isolated
            const questionsForA = await ClassroomAssessmentService.getQuestions({
                actingUserId: profAId,
                actingUserRole: 'PROFESSOR'
            });
            expect(questionsForA).toHaveLength(1);
            expect(questionsForA[0]._id.toString()).toBe(qA._id.toString());

            const questionsForB = await ClassroomAssessmentService.getQuestions({
                actingUserId: profBId,
                actingUserRole: 'PROFESSOR'
            });
            expect(questionsForB).toHaveLength(1);
            expect(questionsForB[0]._id.toString()).toBe(qB._id.toString());
        });
    });

    describe('2. Accurate Unique Participant Count & Duplicate Prevention', () => {
        it('accurately counts unique participants and prevents duplicate joins or reconnects', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Database Systems Activity',
                    questionPrompt: 'Normalize the given schema to BCNF',
                    timeLimit: 120
                },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            expect(session.participantCount).toBe(0);

            // Student 1 joins
            const join1 = await classroomSessionService.joinSession(session.joinCode, 'Alice Smith', student1Id);
            expect(join1.session.participantCount).toBe(1);

            // Student 2 joins
            const join2 = await classroomSessionService.joinSession(session.joinCode, 'Bob Jones', student2Id);
            expect(join2.session.participantCount).toBe(2);

            // Student 3 joins without user ID
            const join3 = await classroomSessionService.joinSession(session.joinCode, 'Charlie Brown');
            expect(join3.session.participantCount).toBe(3);

            // Verify in database
            const docCount = await ClassroomParticipant.countDocuments({ session: session._id });
            expect(docCount).toBe(3);

            // --- Reconnect scenarios: Count must NOT increase ---

            // Scenario A: Student 1 reconnects passing their existing token
            const reconnectToken = await classroomSessionService.joinSession(
                session.joinCode,
                'Alice Smith',
                undefined,
                join1.participant.token
            );
            expect(reconnectToken.session.participantCount).toBe(3);
            expect(reconnectToken.participant.token).toBe(join1.participant.token);

            // Scenario B: Student 2 refreshes and rejoins with same userId
            const reconnectUser = await classroomSessionService.joinSession(
                session.joinCode,
                'Bob Jones',
                student2Id
            );
            expect(reconnectUser.session.participantCount).toBe(3);
            expect(reconnectUser.participant.token).toBe(join2.participant.token);

            // Scenario C: Student 3 refreshes with same name (case-insensitive "charlie brown")
            const reconnectName = await classroomSessionService.joinSession(
                session.joinCode,
                '   charlie brown   '
            );
            expect(reconnectName.session.participantCount).toBe(3);
            expect(reconnectName.participant.id).toBe(join3.participant.id);

            // Final DB verify: still exactly 3 documents
            const finalCount = await ClassroomParticipant.countDocuments({ session: session._id });
            expect(finalCount).toBe(3);

            const reloadedSession = await ClassroomSession.findById(session._id);
            expect(reloadedSession?.participantCount).toBe(3);
        });

        it('maintains strict participant isolation across multiple concurrent sessions', async () => {
            // Professor A creates Session 1
            const { session: session1 } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Prof A Session 1',
                    questionPrompt: 'Question 1'
                },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            // Professor B creates Session 2
            const { session: session2 } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Prof B Session 2',
                    questionPrompt: 'Question 2'
                },
                { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
            );

            // 3 students join Session 1
            await classroomSessionService.joinSession(session1.joinCode, 'Student S1_A');
            await classroomSessionService.joinSession(session1.joinCode, 'Student S1_B');
            await classroomSessionService.joinSession(session1.joinCode, 'Student S1_C');

            // 2 students join Session 2 (even one with the same name "Student S1_A")
            await classroomSessionService.joinSession(session2.joinCode, 'Student S1_A');
            await classroomSessionService.joinSession(session2.joinCode, 'Student S2_B');

            // Verify Session 1 count is strictly 3
            const count1 = await ClassroomParticipant.countDocuments({ session: session1._id });
            expect(count1).toBe(3);

            // Verify Session 2 count is strictly 2
            const count2 = await ClassroomParticipant.countDocuments({ session: session2._id });
            expect(count2).toBe(2);

            // Verifying session objects
            const s1 = await ClassroomSession.findById(session1._id);
            const s2 = await ClassroomSession.findById(session2._id);
            expect(s1?.participantCount).toBe(3);
            expect(s2?.participantCount).toBe(2);
        });

        it('keeps participant count and submission count completely separate and accurate', async () => {
            const { session, activity } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Architecture Activity',
                    questionPrompt: 'Explain pipeline hazard resolution',
                    referenceAnswer: 'Forwarding and stalls',
                    timeLimit: 180
                },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            // 4 participants join
            const p1 = await classroomSessionService.joinSession(session.joinCode, 'Dev 1');
            const p2 = await classroomSessionService.joinSession(session.joinCode, 'Dev 2');
            await classroomSessionService.joinSession(session.joinCode, 'Dev 3');
            await classroomSessionService.joinSession(session.joinCode, 'Dev 4');

            // Only Dev 1 and Dev 2 submit answers
            await classroomSessionService.submitHandwrittenAnswer({
                sessionCode: session.joinCode,
                participantId: p1.participant.id,
                studentName: 'Dev 1',
                fileBuffer: validPngBuffer,
                originalFilename: 'dev1.png',
                mimeType: 'image/png',
                answerText: 'Forwarding and stalls'
            });

            await classroomSessionService.submitHandwrittenAnswer({
                sessionCode: session.joinCode,
                participantId: p2.participant.id,
                studentName: 'Dev 2',
                fileBuffer: validPngBuffer,
                originalFilename: 'dev2.png',
                mimeType: 'image/png',
                answerText: 'Forwarding logic'
            });

            // Participant count is 4, submission count is 2
            const participantsCount = await ClassroomParticipant.countDocuments({ session: session._id });
            const submissionsCount = await ClassroomSubmission.countDocuments({ question: activity._id });

            expect(participantsCount).toBe(4);
            expect(submissionsCount).toBe(2);

            const freshActivity = await ClassroomQuestion.findById(activity._id);
            expect(freshActivity?.totalSubmissions).toBe(2);

            const freshSession = await ClassroomSession.findById(session._id);
            expect(freshSession?.participantCount).toBe(4);
        });
    });

    describe('3. API Level Route Authorization & Filtering', () => {
        it('GET /api/classroom/sessions/[code] enforces 403 when accessed by non-owner professor', async () => {
            const { GET } = await import('../app/api/classroom/sessions/[code]/route');

            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Confidential Exam Session',
                    questionPrompt: 'Solve PDE'
                },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            // Add 2 students
            await classroomSessionService.joinSession(session.joinCode, 'Learner 1');
            await classroomSessionService.joinSession(session.joinCode, 'Learner 2');

            // Professor B tries to view session via API
            currentAuthUser = { id: profBId, role: 'PROFESSOR' };
            const req = new NextRequest(`http://localhost:3000/api/classroom/sessions/${session.joinCode}`);
            const resB = await GET(req, { params: Promise.resolve({ code: session.joinCode }) });
            expect(resB.status).toBe(403);
            const jsonB = await resB.json();
            expect(jsonB.message).toContain('Forbidden: You do not own this classroom session');

            // Professor A (owner) views session via API -> 200 OK with accurate participantCount = 2
            currentAuthUser = { id: profAId, role: 'PROFESSOR' };
            const resA = await GET(req, { params: Promise.resolve({ code: session.joinCode }) });
            expect(resA.status).toBe(200);
            const jsonA = await resA.json();
            expect(jsonA.success).toBe(true);
            expect(jsonA.data.session.participantCount).toBe(2);
            expect(jsonA.data.session.title).toBe('Confidential Exam Session');
        });

        it('GET /api/classroom/sessions returns only sessions owned by the authenticated professor', async () => {
            const { GET } = await import('../app/api/classroom/sessions/route');

            // Prof A creates 2 sessions
            await classroomSessionService.createSessionAndActivity(
                { title: 'Prof A Course 1', questionPrompt: 'Q1' },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );
            await classroomSessionService.createSessionAndActivity(
                { title: 'Prof A Course 2', questionPrompt: 'Q2' },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            // Prof B creates 1 session
            await classroomSessionService.createSessionAndActivity(
                { title: 'Prof B Course 1', questionPrompt: 'QB1' },
                { actingUserId: profBId, actingUserRole: 'PROFESSOR' }
            );

            // Query as Prof A
            currentAuthUser = { id: profAId, role: 'PROFESSOR' };
            const resA = await GET();
            expect(resA.status).toBe(200);
            const dataA = (await resA.json()).data;
            expect(dataA).toHaveLength(2);
            expect(dataA.every((s: { createdBy: string }) => s.createdBy.toString() === profAId)).toBe(true);

            // Query as Prof B
            currentAuthUser = { id: profBId, role: 'PROFESSOR' };
            const resB = await GET();
            expect(resB.status).toBe(200);
            const dataB = (await resB.json()).data;
            expect(dataB).toHaveLength(1);
            expect(dataB[0].createdBy.toString()).toBe(profBId);
            expect(dataB[0].title).toBe('Prof B Course 1');
        });

        it('GET /api/classroom/sessions/[code]/submissions enforces 403 for non-owner professor', async () => {
            const { GET } = await import('../app/api/classroom/sessions/[code]/submissions/route');

            const { session } = await classroomSessionService.createSessionAndActivity(
                { title: 'Submission Test Session', questionPrompt: 'Sample Prompt' },
                { actingUserId: profAId, actingUserRole: 'PROFESSOR' }
            );

            // Non-owner Professor B is rejected
            currentAuthUser = { id: profBId, role: 'PROFESSOR' };
            const req = new NextRequest(`http://localhost:3000/api/classroom/sessions/${session.joinCode}/submissions`);
            const res = await GET(req, { params: Promise.resolve({ code: session.joinCode }) });
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.message).toContain('Forbidden: You do not own this classroom session');
        });
    });
});

