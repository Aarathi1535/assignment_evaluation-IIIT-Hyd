import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import RegradeRequest, { RegradeDecisionOutcome, RegradeStatus } from '../models/RegradeRequest';
import Rubric from '../models/Rubric';
import StudentMapping from '../models/StudentMapping';
import { GET as getProfessorQueue } from '../app/api/professor/regrade-requests/route';
import { PATCH as decideRegrade } from '../app/api/professor/regrade-requests/[id]/route';
import { PATCH as assignReviewer } from '../app/api/professor/regrade-requests/[id]/assignment/route';
import { GET as getStudentRequests, POST as submitStudentRequest } from '../app/api/student/regrade-requests/route';
import { GET as getExamAnalytics } from '../app/api/analytics/exams/[id]/route';
import { GET as exportExamGrades } from '../app/api/analytics/exams/[id]/export/route';

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

describe('AE-219: Priority Analytics and Regrade Bug Fixes', () => {
    beforeAll(async () => {
        await RegradeRequest.init();
    });

    afterEach(() => {
        mockSessionUser = null;
        vi.restoreAllMocks();
    });

    describe('Bug 1: Reviewer Assignment & Regrade State Transitions (OPEN -> REVIEWING -> OPEN)', () => {
        it('transitions status to REVIEWING upon assignment and reverts to OPEN upon unassignment', async () => {
            process.env.STUDENT_RESULTS_ENABLED = 'true';
            const suffix = `b1-${Date.now()}`;
            const prof = await User.create({
                name: 'Professor Alpha',
                email: `prof-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });
            const ta = await User.create({
                name: 'TA Alpha',
                email: `ta-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.TA,
                isActive: true
            });
            const student = await User.create({
                name: 'Student Alpha',
                email: `student-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });
            const course = await Course.create({
                courseCode: `CS-${suffix}`,
                courseName: 'Computer Science',
                academicYear: '2026',
                semester: 1,
                professor: prof._id,
                enrolledStudents: [student._id],
                teachingAssistants: [ta._id],
                isActive: true
            });
            const exam = await Exam.create({
                title: 'Midterm B1',
                course: course._id,
                createdBy: prof._id,
                examDate: new Date(),
                totalMarks: 20,
                numberOfQuestions: 1,
                status: ExamStatus.PUBLISHED,
                isActive: true,
                regradeWindowOpensAt: new Date(Date.now() - 3600000),
                regradeWindowClosesAt: new Date(Date.now() + 3600000)
            });
            const rubric = await Rubric.create({
                exam: exam._id,
                createdBy: prof._id,
                scoreStep: 0.5,
                questions: [{
                    questionNumber: 1,
                    maxMarks: 20,
                    criteria: [{ criterionName: 'Correctness', points: 20 }]
                }],
                isActive: true
            });
            await Exam.updateOne({ _id: exam._id }, { rubric: rubric._id });

            const script = await AnswerScript.create({
                exam: exam._id,
                student: student._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: script._id,
                rubric: rubric._id,
                gradedBy: prof._id,
                question: 1,
                marksAwarded: [{ criterionName: 'Correctness', score: 14 }],
                totalScore: 14,
                isFinal: true
            });

            // 1. Student submits a regrade request
            mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
            const postResponse = await submitStudentRequest(
                new NextRequest('http://localhost/api/student/regrade-requests', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        scriptId: script._id.toString(),
                        questionNumber: 1,
                        reason: 'I believe my solution satisfies all requirements.'
                    })
                })
            );
            const postBody = await postResponse.json();
            expect(postResponse.status).toBe(201);
            expect(postBody.data.status).toBe('open');

            const regradeId = postBody.data.id;

            // 2. Professor assigns the TA -> Should transition status to REVIEWING
            mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };
            const assignResponse = await assignReviewer(
                new NextRequest(`http://localhost/api/professor/regrade-requests/${regradeId}/assignment`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ reviewerId: ta._id.toString() })
                }),
                { params: Promise.resolve({ id: regradeId }) }
            );
            const assignBody = await assignResponse.json();
            expect(assignResponse.status).toBe(200);
            expect(assignBody.data.status).toBe(RegradeStatus.REVIEWING);
            expect(assignBody.data.assignedTo.id).toBe(ta._id.toString());

            // Verify in DB
            const savedAfterAssign = await RegradeRequest.findById(regradeId);
            expect(savedAfterAssign?.status).toBe(RegradeStatus.REVIEWING);

            // Verify student view reflects 'reviewing'
            mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
            const studentView = await getStudentRequests();
            const studentBody = await studentView.json();
            expect(studentBody.data[0].status).toBe('reviewing');

            // Verify professor queue filtering by REVIEWING returns this request
            mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };
            const queueResponse = await getProfessorQueue(
                new NextRequest('http://localhost/api/professor/regrade-requests?status=REVIEWING')
            );
            const queueBody = await queueResponse.json();
            expect(queueBody.data.requests).toHaveLength(1);
            expect(queueBody.data.requests[0].id).toBe(regradeId);
            expect(queueBody.data.requests[0].status).toBe(RegradeStatus.REVIEWING);

            // 3. Unassign reviewer -> Should revert status back to OPEN
            const unassignResponse = await assignReviewer(
                new NextRequest(`http://localhost/api/professor/regrade-requests/${regradeId}/assignment`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ reviewerId: '' })
                }),
                { params: Promise.resolve({ id: regradeId }) }
            );
            const unassignBody = await unassignResponse.json();
            expect(unassignResponse.status).toBe(200);
            expect(unassignBody.data.status).toBe(RegradeStatus.OPEN);
            expect(unassignBody.data.assignedTo).toBeNull();

            // Verify student view reverts to 'open'
            mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
            const studentViewAfter = await getStudentRequests();
            const studentBodyAfter = await studentViewAfter.json();
            expect(studentBodyAfter.data[0].status).toBe('open');
        });
    });

    describe('Bug 2: Strict Creator-Only Scoping for Regrade Decisions and Assignment', () => {
        it('enforces creator-only scoping so non-creating professors cannot access or decide regrades (matching analytics and export)', async () => {
            const suffix = `b2-${Date.now()}`;
            const admin = await User.create({
                name: 'Administrator',
                email: `admin-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.ADMIN,
                isActive: true
            });
            const courseProf = await User.create({
                name: 'Course Professor',
                email: `course-prof-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });
            const otherProf = await User.create({
                name: 'Unrelated Professor',
                email: `unrelated-prof-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });
            const student = await User.create({
                name: 'Student Beta',
                email: `student-b2-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });
            const course = await Course.create({
                courseCode: `CS-B2-${suffix}`,
                courseName: 'Algorithms',
                academicYear: '2026',
                semester: 1,
                professor: courseProf._id, // courseProf is the course instructor
                enrolledStudents: [student._id],
                teachingAssistants: [],
                isActive: true
            });
            // Exam was created by admin, not courseProf
            const exam = await Exam.create({
                title: 'Admin Created Exam',
                course: course._id,
                createdBy: admin._id,
                examDate: new Date(),
                totalMarks: 10,
                numberOfQuestions: 1,
                status: ExamStatus.PUBLISHED,
                isActive: true
            });
            const rubric = await Rubric.create({
                exam: exam._id,
                createdBy: admin._id,
                scoreStep: 0.5,
                questions: [{
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [{ criterionName: 'Logic', points: 10 }]
                }],
                isActive: true
            });
            await Exam.updateOne({ _id: exam._id }, { rubric: rubric._id });

            const script = await AnswerScript.create({
                exam: exam._id,
                student: student._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: script._id,
                rubric: rubric._id,
                gradedBy: admin._id,
                question: 1,
                marksAwarded: [{ criterionName: 'Logic', score: 6 }],
                totalScore: 6,
                isFinal: true
            });

            const regrade = await RegradeRequest.create({
                exam: exam._id,
                answerScript: script._id,
                questionNumber: 1,
                student: student._id,
                reason: 'Requesting review from course professor.',
                status: RegradeStatus.OPEN
            });

            // 1. Course Professor (non-creator) is denied access with 404 (creator-only scope)
            mockSessionUser = { id: courseProf._id.toString(), role: UserRole.PROFESSOR };
            const queueRes = await getProfessorQueue(
                new NextRequest(`http://localhost/api/professor/regrade-requests?examId=${exam._id}`)
            );
            expect(queueRes.status).toBe(404);

            const courseProfDecide = await decideRegrade(
                new NextRequest(`http://localhost/api/professor/regrade-requests/${regrade._id}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        outcome: RegradeDecisionOutcome.APPROVED,
                        reason: 'Course prof attempting decision.'
                    })
                }),
                { params: Promise.resolve({ id: regrade._id.toString() }) }
            );
            expect(courseProfDecide.status).toBe(404);

            // 2. Unrelated professor is also denied access with 404
            mockSessionUser = { id: otherProf._id.toString(), role: UserRole.PROFESSOR };
            const deniedQueue = await getProfessorQueue(
                new NextRequest(`http://localhost/api/professor/regrade-requests?examId=${exam._id}`)
            );
            expect(deniedQueue.status).toBe(404);

            const deniedDecision = await decideRegrade(
                new NextRequest(`http://localhost/api/professor/regrade-requests/${regrade._id}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        outcome: RegradeDecisionOutcome.APPROVED,
                        reason: 'Should be denied.'
                    })
                }),
                { params: Promise.resolve({ id: regrade._id.toString() }) }
            );
            expect(deniedDecision.status).toBe(404);

            // 3. Admin / Creator can access and decide the regrade request
            mockSessionUser = { id: admin._id.toString(), role: UserRole.ADMIN };
            const decideRes = await decideRegrade(
                new NextRequest(`http://localhost/api/professor/regrade-requests/${regrade._id}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        outcome: RegradeDecisionOutcome.APPROVED,
                        reason: 'Awarding full marks for alternative valid logic.',
                        revisedScore: 10
                    })
                }),
                { params: Promise.resolve({ id: regrade._id.toString() }) }
            );
            const decideBody = await decideRes.json();
            expect(decideRes.status).toBe(200);
            expect(decideBody.data.status).toBe(RegradeStatus.RESOLVED);
            expect(decideBody.data.decision.revisedScore).toBe(10);

            const updatedGrade = await Grade.findOne({ answerScript: script._id, question: 1 });
            expect(updatedGrade?.totalScore).toBe(10);
        });
    });

    describe('Bug 3: Analytics and Export Consistency Before and After Regrade Approval', () => {
        it('accurately updates class statistics, question difficulty, and exports after a regrade adjustment', async () => {
            process.env.STUDENT_RESULTS_ENABLED = 'true';
            const suffix = `b3-${Date.now()}`;
            const prof = await User.create({
                name: 'Analytics Regrade Professor',
                email: `prof-b3-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });
            const students = await Promise.all([1, 2, 3].map(i => User.create({
                name: `Student B3-${i}`,
                email: `student-b3-${i}-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            })));

            const course = await Course.create({
                courseCode: `CS-B3-${suffix}`,
                courseName: 'Data Systems',
                academicYear: '2026',
                semester: 1,
                professor: prof._id,
                enrolledStudents: students.map(s => s._id),
                teachingAssistants: [],
                isActive: true
            });

            const exam = await Exam.create({
                title: 'Analytics Regrade Midterm',
                course: course._id,
                createdBy: prof._id,
                examDate: new Date(),
                totalMarks: 50,
                numberOfQuestions: 2,
                status: ExamStatus.PUBLISHED,
                isActive: true,
                regradeWindowOpensAt: new Date(Date.now() - 3600000),
                regradeWindowClosesAt: new Date(Date.now() + 3600000)
            });

            const rubric = await Rubric.create({
                exam: exam._id,
                createdBy: prof._id,
                scoreStep: 0.5,
                questions: [
                    { questionNumber: 1, maxMarks: 20, criteria: [{ criterionName: 'Q1', points: 20 }] },
                    { questionNumber: 2, maxMarks: 30, criteria: [{ criterionName: 'Q2', points: 30 }] }
                ],
                isActive: true
            });
            await Exam.updateOne({ _id: exam._id }, { rubric: rubric._id });

            // Create mappings
            await Promise.all(students.map((s, idx) => StudentMapping.create({
                exam: exam._id,
                student: s._id,
                rollNumber: `CS26-00${idx + 1}`,
                anonymousId: `ANON-${idx + 1}`
            })));

            // Baseline Scores:
            // S1: Q1=10/20, Q2=20/30 -> Total 30/50
            // S2: Q1=12/20, Q2=18/30 -> Total 30/50
            // S3: Q1=14/20, Q2=22/30 -> Total 36/50
            const scores = [
                { q1: 10, q2: 20 },
                { q1: 12, q2: 18 },
                { q1: 14, q2: 22 }
            ];
            const scripts: InstanceType<typeof AnswerScript>[] = [];
            for (let i = 0; i < 3; i++) {
                const script = await AnswerScript.create({
                    exam: exam._id,
                    student: students[i]._id,
                    identificationStatus: IdentificationStatus.IDENTIFIED,
                    isActive: true,
                    needsManualId: false,
                    hasIdentificationConflict: false
                });
                scripts.push(script);
                await Grade.create({
                    answerScript: script._id,
                    rubric: rubric._id,
                    gradedBy: prof._id,
                    question: 1,
                    marksAwarded: [{ criterionName: 'Q1', score: scores[i].q1 }],
                    totalScore: scores[i].q1,
                    isFinal: true
                });
                await Grade.create({
                    answerScript: script._id,
                    rubric: rubric._id,
                    gradedBy: prof._id,
                    question: 2,
                    marksAwarded: [{ criterionName: 'Q2', score: scores[i].q2 }],
                    totalScore: scores[i].q2,
                    isFinal: true
                });
            }

            mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };

            // Check Baseline Analytics:
            // Totals: [30, 30, 36]
            // Mean = 96 / 3 = 32
            // Median = 30
            // Q1: [10/20 (50%), 12/20 (60%), 14/20 (70%)] -> Mean% = 60%, Difficulty = 40%
            const baselineAnalyticsRes = await getExamAnalytics(
                new NextRequest(`http://localhost/api/analytics/exams/${exam._id}`),
                { params: Promise.resolve({ id: exam._id.toString() }) }
            );
            const baselineAnalytics = await baselineAnalyticsRes.json();
            expect(baselineAnalyticsRes.status).toBe(200);
            expect(baselineAnalytics.data.classStatistics.count).toBe(3);
            expect(baselineAnalytics.data.classStatistics.mean).toBe(32);
            expect(baselineAnalytics.data.classStatistics.median).toBe(30);

            const baselineQ1 = baselineAnalytics.data.questionStatistics.find((q: { questionNumber: number }) => q.questionNumber === 1);
            expect(baselineQ1.meanScorePercentage).toBe(60);
            expect(baselineQ1.difficultyIndexPercentage).toBe(40);

            // S1 submits a regrade request for Q1
            const regrade = await RegradeRequest.create({
                exam: exam._id,
                answerScript: scripts[0]._id,
                questionNumber: 1,
                student: students[0]._id,
                reason: 'Question 1 marks were miscalculated by 8 marks.',
                status: RegradeStatus.OPEN
            });

            // Professor approves regrade for S1 on Q1 from 10 to 18 (+8 marks)
            const decisionRes = await decideRegrade(
                new NextRequest(`http://localhost/api/professor/regrade-requests/${regrade._id}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        outcome: RegradeDecisionOutcome.APPROVED,
                        reason: 'Confirmed 8 additional points earned.',
                        revisedScore: 18
                    })
                }),
                { params: Promise.resolve({ id: regrade._id.toString() }) }
            );
            expect(decisionRes.status).toBe(200);

            // Audit verification
            const auditEvent = await AuditLog.findOne({
                entityId: regrade._id,
                action: 'REGRADE_DECIDED'
            });
            expect(auditEvent).toBeDefined();
            expect(auditEvent?.details).toMatchObject({
                outcome: RegradeDecisionOutcome.APPROVED,
                originalScore: 10,
                revisedScore: 18
            });

            // Check Updated Analytics:
            // New Totals: S1=38, S2=30, S3=36
            // New Mean: (38 + 30 + 36) / 3 = 104 / 3 ≈ 34.6666666667
            // New Median: sorted [30, 36, 38] -> 36!
            // New Q1: [18/20 (90%), 12/20 (60%), 14/20 (70%)] -> Mean% = 220/3 ≈ 73.3333333333%, Difficulty = 26.6666666667%
            const updatedAnalyticsRes = await getExamAnalytics(
                new NextRequest(`http://localhost/api/analytics/exams/${exam._id}`),
                { params: Promise.resolve({ id: exam._id.toString() }) }
            );
            const updatedAnalytics = await updatedAnalyticsRes.json();
            expect(updatedAnalyticsRes.status).toBe(200);
            expect(updatedAnalytics.data.classStatistics.count).toBe(3);
            expect(updatedAnalytics.data.classStatistics.mean).toBeCloseTo(104 / 3, 8);
            expect(updatedAnalytics.data.classStatistics.median).toBe(36);

            const updatedQ1 = updatedAnalytics.data.questionStatistics.find((q: { questionNumber: number }) => q.questionNumber === 1);
            expect(updatedQ1.meanScorePercentage).toBeCloseTo(220 / 3, 8);
            expect(updatedQ1.difficultyIndexPercentage).toBeCloseTo(100 - (220 / 3), 8);

            // Check CSV Export reflects updated score
            const csvRes = await exportExamGrades(
                new NextRequest(`http://localhost/api/analytics/exams/${exam._id}/export?format=csv`),
                { params: Promise.resolve({ id: exam._id.toString() }) }
            );
            expect(csvRes.status).toBe(200);
            const csvText = await csvRes.text();
            // Student 1 (CS26-001) must have Q1 score 18 and Total 38
            expect(csvText).toContain('"CS26-001"');
            expect(csvText).toContain('18');
            expect(csvText).toContain('38');

            // Check LMS Export reflects updated score
            const lmsRes = await exportExamGrades(
                new NextRequest(`http://localhost/api/analytics/exams/${exam._id}/export?format=lms`),
                { params: Promise.resolve({ id: exam._id.toString() }) }
            );
            expect(lmsRes.status).toBe(200);
            const lmsText = await lmsRes.text();
            expect(lmsText).toContain('"CS26-001"');
            expect(lmsText).toContain('38');
        });
    });

    describe('Bug 4: Repeated Regrade Requests and Safe Resolution Cycles', () => {
        it('allows a subsequent regrade request after prior resolution, and reflects current score in queue', async () => {
            process.env.STUDENT_RESULTS_ENABLED = 'true';
            const suffix = `b4-${Date.now()}`;
            const prof = await User.create({
                name: 'Professor Repeat',
                email: `prof-b4-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });
            const student = await User.create({
                name: 'Student Repeat',
                email: `student-b4-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });
            const course = await Course.create({
                courseCode: `CS-B4-${suffix}`,
                courseName: 'Algorithms',
                academicYear: '2026',
                semester: 1,
                professor: prof._id,
                enrolledStudents: [student._id],
                teachingAssistants: [],
                isActive: true
            });
            const exam = await Exam.create({
                title: 'Repeat Regrade Exam',
                course: course._id,
                createdBy: prof._id,
                examDate: new Date(),
                totalMarks: 20,
                numberOfQuestions: 1,
                status: ExamStatus.PUBLISHED,
                isActive: true,
                regradeWindowOpensAt: new Date(Date.now() - 3600000),
                regradeWindowClosesAt: new Date(Date.now() + 3600000)
            });
            const rubric = await Rubric.create({
                exam: exam._id,
                createdBy: prof._id,
                scoreStep: 0.5,
                questions: [{
                    questionNumber: 1,
                    maxMarks: 20,
                    criteria: [{ criterionName: 'Code', points: 20 }]
                }],
                isActive: true
            });
            await Exam.updateOne({ _id: exam._id }, { rubric: rubric._id });

            const script = await AnswerScript.create({
                exam: exam._id,
                student: student._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: script._id,
                rubric: rubric._id,
                gradedBy: prof._id,
                question: 1,
                marksAwarded: [{ criterionName: 'Code', score: 10 }],
                totalScore: 10,
                isFinal: true
            });

            // 1. Submit Request 1
            mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
            const req1Res = await submitStudentRequest(
                new NextRequest('http://localhost/api/student/regrade-requests', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        scriptId: script._id.toString(),
                        questionNumber: 1,
                        reason: 'Initial regrade request for Question 1.'
                    })
                })
            );
            const req1Body = await req1Res.json();
            expect(req1Res.status).toBe(201);

            // Submitting another while open is blocked (409)
            const dupRes = await submitStudentRequest(
                new NextRequest('http://localhost/api/student/regrade-requests', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        scriptId: script._id.toString(),
                        questionNumber: 1,
                        reason: 'Duplicate regrade attempt.'
                    })
                })
            );
            expect(dupRes.status).toBe(409);

            // 2. Professor resolves Request 1 (approves and raises from 10 to 14)
            mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };
            const resolve1 = await decideRegrade(
                new NextRequest(`http://localhost/api/professor/regrade-requests/${req1Body.data.id}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        outcome: RegradeDecisionOutcome.APPROVED,
                        reason: 'Partial credit added.',
                        revisedScore: 14
                    })
                }),
                { params: Promise.resolve({ id: req1Body.data.id }) }
            );
            expect(resolve1.status).toBe(200);

            // 3. Student submits Request 2 for the same question (now that Request 1 is RESOLVED)
            mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
            const req2Res = await submitStudentRequest(
                new NextRequest('http://localhost/api/student/regrade-requests', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        scriptId: script._id.toString(),
                        questionNumber: 1,
                        reason: 'Subsequent regrade: line 12 also handles the corner case.'
                    })
                })
            );
            const req2Body = await req2Res.json();
            expect(req2Res.status).toBe(201);
            expect(req2Body.data.id).not.toBe(req1Body.data.id);

            // 4. Professor queue shows the new open request with the current evaluation score (14)
            mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };
            const queueRes = await getProfessorQueue(
                new NextRequest(`http://localhost/api/professor/regrade-requests?status=OPEN&examId=${exam._id}`)
            );
            const queueBody = await queueRes.json();
            expect(queueRes.status).toBe(200);
            expect(queueBody.data.requests).toHaveLength(1);
            expect(queueBody.data.requests[0].id).toBe(req2Body.data.id);
            expect(queueBody.data.requests[0].evaluation.score).toBe(14);
        });
    });

    describe('Bug 5: Safe handling of grades with null or missing rubric references', () => {
        it('does not throw a 500 error when database grades have null rubric references', async () => {
            const suffix = `b5-${Date.now()}`;
            const prof = await User.create({
                name: 'Professor Safe',
                email: `prof-b5-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });
            const student = await User.create({
                name: 'Student Safe',
                email: `student-b5-${suffix}@example.test`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });
            const course = await Course.create({
                courseCode: `CS-B5-${suffix}`,
                courseName: 'Safety',
                academicYear: '2026',
                semester: 1,
                professor: prof._id,
                enrolledStudents: [student._id],
                teachingAssistants: [],
                isActive: true
            });
            const exam = await Exam.create({
                title: 'Safe Queue Exam',
                course: course._id,
                createdBy: prof._id,
                examDate: new Date(),
                totalMarks: 10,
                numberOfQuestions: 1,
                status: ExamStatus.PUBLISHED,
                isActive: true
            });
            const rubric = await Rubric.create({
                exam: exam._id,
                createdBy: prof._id,
                scoreStep: 1,
                questions: [{ questionNumber: 1, maxMarks: 10, criteria: [] }],
                isActive: true
            });
            await Exam.updateOne({ _id: exam._id }, { rubric: rubric._id });

            const script = await AnswerScript.create({
                exam: exam._id,
                student: student._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true
            });

            // Normal grade
            await Grade.create({
                answerScript: script._id,
                rubric: rubric._id,
                gradedBy: prof._id,
                question: 1,
                marksAwarded: [],
                totalScore: 5,
                isFinal: true
            });

            await RegradeRequest.create({
                exam: exam._id,
                answerScript: script._id,
                questionNumber: 1,
                student: student._id,
                reason: 'Question 1 check.',
                status: RegradeStatus.OPEN
            });

            // Intentionally bypass schema validation via native collection to insert a grade without rubric
            await mongoose.connection.collection('grades').insertOne({
                answerScript: script._id,
                gradedBy: prof._id,
                question: 2,
                totalScore: 0,
                isFinal: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };
            const queueRes = await getProfessorQueue(
                new NextRequest(`http://localhost/api/professor/regrade-requests?examId=${exam._id}`)
            );
            expect(queueRes.status).toBe(200);
            const queueBody = await queueRes.json();
            expect(queueBody.success).toBe(true);
            expect(queueBody.data.requests).toHaveLength(1);
        });
    });
});
