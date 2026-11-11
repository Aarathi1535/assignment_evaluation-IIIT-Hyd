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
import AuditLog from '../models/AuditLog';
import {
    GET as ltiPassbackGET,
    POST as ltiPassbackPOST
} from '../app/api/analytics/exams/[id]/lti/passback/route';
import { ltiGradePassbackService } from '../services/LtiGradePassbackService';

describe('AE-216 LTI 1.3 grade passback design and safe stub', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Service unit tests & URL validation', () => {
        it('validates lineItemUrl HTTPS protocol requirements', () => {
            expect(ltiGradePassbackService.validateLineItemUrl('https://canvas.instructure.com/api/lti/courses/1/line_items/2')).toBe(true);
            expect(ltiGradePassbackService.validateLineItemUrl('http://localhost:3000/api/lti/lineitems/1')).toBe(false);
            expect(ltiGradePassbackService.validateLineItemUrl('https://localhost:3000/api/lti/lineitems/1')).toBe(false);
            expect(ltiGradePassbackService.validateLineItemUrl(undefined)).toBe(true);

            // Insecure or invalid protocols
            expect(ltiGradePassbackService.validateLineItemUrl('http://insecure-lms.edu/lineitem')).toBe(false);
            expect(ltiGradePassbackService.validateLineItemUrl('ftp://example.com/lineitem')).toBe(false);
            expect(ltiGradePassbackService.validateLineItemUrl('javascript:alert(1)')).toBe(false);
            expect(ltiGradePassbackService.validateLineItemUrl('not a url')).toBe(false);
        });
    });

    describe('Safe stub execution & grade scoping', () => {
        async function createFixture() {
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

            const professor = await User.create({
                name: 'Professor LTI Owner',
                email: `prof-lti-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const otherProfessor = await User.create({
                name: 'Professor Other LTI',
                email: `other-prof-lti-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const ta = await User.create({
                name: 'TA LTI Assistant',
                email: `ta-lti-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.TA,
                isActive: true
            });

            // Student 1: Enrolled, released grade 28/30
            const student1 = await User.create({
                name: 'Alice Student',
                email: `alice-lti-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Student 2: Enrolled, unfinalized grade
            const student2 = await User.create({
                name: 'Bob Unfinalized',
                email: `bob-lti-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Student 3: Outside student (enrolled in another course)
            const student3 = await User.create({
                name: 'Diana Outside',
                email: `diana-outside-lti-${suffix}@example.edu`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Course A (CS201)
            const courseA = await Course.create({
                courseCode: `CS201-${suffix}`,
                courseName: 'Algorithms',
                academicYear: '2026-2027',
                semester: 1,
                professor: professor._id,
                enrolledStudents: [student1._id, student2._id],
                teachingAssistants: [ta._id],
                isActive: true
            });

            // Course B (CS999)
            const courseB = await Course.create({
                courseCode: `CS999-${suffix}`,
                courseName: 'Outside Course',
                academicYear: '2026-2027',
                semester: 1,
                professor: otherProfessor._id,
                enrolledStudents: [student3._id],
                teachingAssistants: [],
                isActive: true
            });

            const exam = await Exam.create({
                title: `Midterm Algorithms ${suffix}`,
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

            await StudentMapping.create([
                {
                    exam: exam._id,
                    student: student1._id,
                    anonymousId: `ANON-LTI-1-${suffix}`,
                    rollNumber: 'ROLL-2026-01',
                    ltiSub: 'canvas-sub-user-01',
                    isVerified: true
                },
                {
                    exam: exam._id,
                    student: student2._id,
                    anonymousId: `ANON-LTI-2-${suffix}`,
                    rollNumber: 'ROLL-2026-02',
                    ltiSub: 'canvas-sub-user-02',
                    isVerified: true
                }
            ]);

            // Finalized script & grade for Student 1
            const script1 = await AnswerScript.create({
                exam: exam._id,
                student: student1._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: script1._id,
                rubric: rubric._id,
                gradedBy: professor._id,
                question: 1,
                marksAwarded: [{ criterionName: 'All', score: 28 }],
                totalScore: 28,
                isFinal: true
            });

            // Unfinalized script & grade for Student 2
            const script2 = await AnswerScript.create({
                exam: exam._id,
                student: student2._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: script2._id,
                rubric: rubric._id,
                gradedBy: professor._id,
                question: 1,
                marksAwarded: [{ criterionName: 'All', score: 15 }],
                totalScore: 15,
                isFinal: false
            });

            return {
                professor,
                otherProfessor,
                ta,
                student1,
                student2,
                student3,
                courseA,
                courseB,
                exam,
                rubric
            };
        }

        it('executes LTI 1.3 grade passback in safe stub mode and generates valid AGS Score payloads', async () => {
            const fixture = await createFixture();

            const result = await ltiGradePassbackService.executeGradePassback(
                fixture.exam._id.toString(),
                {
                    lineItemUrl: 'https://canvas.example.edu/api/lti/courses/1/line_items/99',
                    students: [
                        { lmsStudentId: 'ROLL-2026-01' }
                    ]
                },
                fixture.professor._id.toString(),
                UserRole.PROFESSOR
            );

            expect(result.stubMode).toBe(true);
            expect(result.status).toBe('NOT_SENT');
            expect(result.totalProcessed).toBe(1);
            expect(result.successfulScores).toBe(0);
            expect(result.notSentScores).toBe(1);
            expect(result.failedScores).toBe(0);
            expect(result.lineItemUrl).toBe('https://canvas.example.edu/api/lti/courses/1/line_items/99');
            expect(result.message).toContain('safe stub mode');

            // Verify LTI-AGS 2.0 Score payload structure in safe stub mode (marked NOT_SENT)
            const scoreEntry = result.scores[0];
            expect(scoreEntry.status).toBe('NOT_SENT');
            expect(scoreEntry.reason).toContain('Safe stub mode');
            expect(scoreEntry.scoreGiven).toBe(28);
            expect(scoreEntry.scoreMaximum).toBe(30);

            const payload = scoreEntry.payload!;
            expect(payload.userId).toBe('canvas-sub-user-01');
            expect(payload.scoreGiven).toBe(28);
            expect(payload.scoreMaximum).toBe(30);
            expect(payload.activityProgress).toBe('Completed');
            expect(payload.gradingProgress).toBe('FullyGraded');
            expect(payload.timestamp).toBeDefined();
        });

        it('handles dry-run passback and unmapped/duplicate student IDs gracefully', async () => {
            const fixture = await createFixture();

            const result = await ltiGradePassbackService.executeGradePassback(
                fixture.exam._id.toString(),
                {
                    dryRun: true,
                    students: [
                        { lmsStudentId: 'ROLL-2026-01' },
                        { lmsStudentId: 'ROLL-2026-02' }, // Unfinalized grade -> SKIPPED
                        { lmsStudentId: 'UNKNOWN-ID' },   // Not in course -> FAILED
                        { lmsStudentId: 'DUP-1' },
                        { lmsStudentId: 'DUP-1' }        // Duplicate LMS ID -> FAILED
                    ]
                },
                fixture.professor._id.toString(),
                UserRole.PROFESSOR
            );

            expect(result.stubMode).toBe(true);
            expect(result.status).toBe('DRY_RUN');
            expect(result.totalProcessed).toBe(5);
            expect(result.successfulScores).toBe(0);
            expect(result.notSentScores).toBe(1);
            expect(result.skippedScores).toBe(1); // Student 2 (unfinalized grade)
            expect(result.failedScores).toBe(3);  // 1 unknown + 2 duplicate entries

            const skipped = result.scores.find(s => s.lmsStudentId === 'ROLL-2026-02');
            expect(skipped?.status).toBe('SKIPPED');
            expect(skipped?.reason).toContain('finalized');

            const missing = result.scores.find(s => s.lmsStudentId === 'UNKNOWN-ID');
            expect(missing?.status).toBe('FAILED');
            expect(missing?.reason).toContain('not found');
        });

        it('strictly enforces course scoping to prevent cross-student or cross-course data exposure', async () => {
            const fixture = await createFixture();

            // Try to pass back a score for Diana (student3 from Course B) against Course A's exam
            const result = await ltiGradePassbackService.executeGradePassback(
                fixture.exam._id.toString(),
                {
                    students: [
                        { lmsStudentId: fixture.student3.email }
                    ]
                },
                fixture.professor._id.toString(),
                UserRole.PROFESSOR
            );

            expect(result.successfulScores).toBe(0);
            expect(result.failedScores).toBe(1);
            expect(result.scores[0].status).toBe('FAILED');
            expect(result.scores[0].reason).toContain('not found');
            expect(result.scores[0].studentName).toBeUndefined();
        });

        it('handles Mode B (all unresolved LTI sub) returning NOT_SENT, 0 successfulScores, and writing an audit entry', async () => {
            const fixture = await createFixture();
            // Clear ltiSub so all records in Mode B have unresolved LTI sub
            await StudentMapping.updateMany({ exam: fixture.exam._id }, { $set: { ltiSub: null } });

            const result = await ltiGradePassbackService.executeGradePassback(
                fixture.exam._id.toString(),
                {}, // Empty options -> Mode B (roster-derived passback)
                fixture.professor._id.toString(),
                UserRole.PROFESSOR
            );

            expect(result.stubMode).toBe(true);
            expect(result.status).toBe('NOT_SENT');
            expect(result.successfulScores).toBe(0);
            expect(result.notSentScores).toBe(0);
            expect(result.skippedScores).toBeGreaterThan(0);
            expect(result.scores.every(s => s.status === 'SKIPPED')).toBe(true);
            expect(result.scores[0].reason).toContain('LTI platform sub claim is not resolved');

            // Verify audit entry was written
            const auditEntry = await AuditLog.findOne({
                entityId: fixture.exam._id,
                action: 'LTI_GRADE_PASSBACK_SIMULATED'
            }).lean();
            expect(auditEntry).not.toBeNull();
            expect(auditEntry?.details?.status).toBe('NOT_SENT');
            expect(auditEntry?.details?.mode).toBe('MODE_B');
        });

        it('handles Mode A students without resolved LTI sub by marking them as SKIPPED', async () => {
            const fixture = await createFixture();
            // Clear ltiSub for student 1
            await StudentMapping.updateOne({ exam: fixture.exam._id, student: fixture.student1._id }, { $set: { ltiSub: null } });

            const result = await ltiGradePassbackService.executeGradePassback(
                fixture.exam._id.toString(),
                {
                    students: [
                        { lmsStudentId: 'ROLL-2026-01' }
                    ]
                },
                fixture.professor._id.toString(),
                UserRole.PROFESSOR
            );

            expect(result.stubMode).toBe(true);
            expect(result.status).toBe('NOT_SENT');
            expect(result.totalProcessed).toBe(1);
            expect(result.successfulScores).toBe(0);
            expect(result.notSentScores).toBe(0);
            expect(result.skippedScores).toBe(1);
            expect(result.scores[0].status).toBe('SKIPPED');
            expect(result.scores[0].reason).toContain('LTI platform sub claim is not resolved');
        });

        it('enforces API authorization on GET and POST stub routes', async () => {
            const fixture = await createFixture();

            // 1. Unauthenticated -> 401
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: false,
                response: NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 }),
                user: null
            });

            const unauthGet = await ltiPassbackGET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(unauthGet.status).toBe(401);

            const unauthPost = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: JSON.stringify({})
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(unauthPost.status).toBe(401);

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

            const taPost = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: JSON.stringify({})
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(taPost.status).toBe(403);

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

            const otherProfPost = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: JSON.stringify({})
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(otherProfPost.status).toBe(404);

            // 4. Authorized owner -> 200 on GET and POST
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

            const ownerGet = await ltiPassbackGET(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(ownerGet.status).toBe(200);
            const getBody = await ownerGet.json();
            expect(getBody.stubMode).toBe(true);

            const ownerPost = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lineItemUrl: 'https://canvas.example.edu/lineitem/1',
                        students: [{ lmsStudentId: 'ROLL-2026-01' }]
                    })
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(ownerPost.status).toBe(200);
            const postBody = await ownerPost.json();
            expect(postBody.success).toBe(true);
            expect(postBody.stubMode).toBe(true);
            expect(postBody.data.status).toBe('NOT_SENT');
            expect(postBody.data.successfulScores).toBe(0);
            expect(postBody.data.notSentScores).toBe(1);
        });

        it('validates request inputs: malformed JSON, invalid exam ID, insecure lineItemUrl', async () => {
            const fixture = await createFixture();

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

            // 1. Invalid Exam ID
            const badIdRes = await ltiPassbackPOST(
                new NextRequest('http://localhost/api/analytics/exams/bad-id/lti/passback', {
                    method: 'POST',
                    body: JSON.stringify({})
                }),
                { params: Promise.resolve({ id: 'bad-id' }) }
            );
            expect(badIdRes.status).toBe(400);

            // 2. Malformed JSON body
            const malformedJsonRes = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: '{ invalid json'
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(malformedJsonRes.status).toBe(400);

            // 3. Insecure or localhost LineItem URL
            const insecureUrlRes = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: JSON.stringify({
                        lineItemUrl: 'http://insecure.test/lineitem'
                    })
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(insecureUrlRes.status).toBe(400);

            const localhostUrlRes = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: JSON.stringify({
                        lineItemUrl: 'http://localhost:3000/api/lineitems'
                    })
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(localhostUrlRes.status).toBe(400);

            // 4. Invalid students payload: object instead of array or null entry
            const objStudentsRes = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: JSON.stringify({ students: {} })
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(objStudentsRes.status).toBe(400);

            const nullEntryStudentsRes = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: JSON.stringify({ students: [null] })
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(nullEntryStudentsRes.status).toBe(400);

            // 5. Inactive Course -> 409 Conflict
            await Course.findByIdAndUpdate(fixture.courseA._id, { isActive: false });
            const inactiveCourseRes = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: JSON.stringify({ students: [{ lmsStudentId: 'ROLL-2026-01' }] })
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(inactiveCourseRes.status).toBe(409);
            await Course.findByIdAndUpdate(fixture.courseA._id, { isActive: true });

            // 6. Unpublished Exam -> 409 Conflict
            await Exam.findByIdAndUpdate(fixture.exam._id, { status: ExamStatus.DRAFT });
            const unpublishedRes = await ltiPassbackPOST(
                new NextRequest(`http://localhost/api/analytics/exams/${fixture.exam._id}/lti/passback`, {
                    method: 'POST',
                    body: JSON.stringify({})
                }),
                { params: Promise.resolve({ id: fixture.exam._id.toString() }) }
            );
            expect(unpublishedRes.status).toBe(409);
        });
    });
});

