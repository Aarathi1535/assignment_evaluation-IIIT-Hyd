import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import User, { IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import Exam, { IExam, ExamStatus, IngestionApprovalStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript, { IAnswerScript } from '../models/AnswerScript';
import ReconstructedAnswer from '../models/AnswerSegmentation';
import { ContinuationReconstructionEngine } from '../services/segmentation/ContinuationReconstructionEngine';
import { SegmentHeadingDetector } from '../services/segmentation/SegmentHeadingDetector';
import answerSegmentationService from '../services/AnswerSegmentationService';
import { AnswerScriptFixtureGenerator } from './fixtures/AnswerScriptFixtureGenerator';
import { UserRole } from '../constants/permissions';
import { GET as getSegmentationRoute } from '../app/api/research/segmentation/[scriptId]/route';
import { GET as getQuestionRoute, PATCH as patchQuestionRoute } from '../app/api/research/segmentation/[scriptId]/question/[questionNumber]/route';

// Mock NextAuth session
let mockSessionUser: { id: string; email: string; name: string; role: string } | null = null;

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

describe('Research Direction 3: Question-Answer Segmentation & Reconstruction Test Suite', () => {
    let professorUser: IUser;
    let taUser: IUser;
    let testCourse: ICourse;
    let testExam: IExam;
    let testScript: IAnswerScript;

    const dummyScriptId = new mongoose.Types.ObjectId();
    const dummyExamId = new mongoose.Types.ObjectId();

    beforeEach(async () => {
        // 1. Create Professor
        professorUser = await User.create({
            name: 'Prof. Jawahar',
            email: `jawahar_${Date.now()}@iiit.ac.in`,
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // 2. Create TA
        taUser = await User.create({
            name: 'TA Alex',
            email: `ta_${Date.now()}@iiit.ac.in`,
            password: 'hashedPassword123',
            role: UserRole.TA,
            isActive: true
        });

        // 3. Create Course
        testCourse = await Course.create({
            courseCode: 'CS7.502',
            courseName: 'Document Image Processing & Recognition',
            semester: 1,
            academicYear: '2026-2027',
            professor: professorUser._id,
            teachingAssistants: [taUser._id],
            enrolledStudents: [],
            isActive: true
        });

        // 4. Create Exam
        testExam = await Exam.create({
            title: 'Midterm Exam - Document Analysis',
            course: testCourse._id,
            createdBy: professorUser._id,
            examDate: new Date(),
            totalMarks: 50,
            status: ExamStatus.EVALUATING,
            numberOfQuestions: 6,
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            isActive: true
        });

        // 5. Create Rubric
        await Rubric.create({
            exam: testExam._id,
            scoreStep: 0.5,
            createdBy: professorUser._id,
            isActive: true,
            version: 1,
            questions: [
                { questionNumber: 1, maxMarks: 10, criteria: [{ criterionName: 'Correctness', points: 10 }] },
                { questionNumber: 2, maxMarks: 10, criteria: [{ criterionName: 'Correctness', points: 10 }] },
                { questionNumber: 3, maxMarks: 10, criteria: [{ criterionName: 'Correctness', points: 10 }] },
                { questionNumber: 4, maxMarks: 10, criteria: [{ criterionName: 'Correctness', points: 10 }] },
                { questionNumber: 5, maxMarks: 10, criteria: [{ criterionName: 'Correctness', points: 10 }] },
                { questionNumber: 6, maxMarks: 10, criteria: [{ criterionName: 'Correctness', points: 10 }] }
            ]
        });

        // 6. Create AnswerScript
        testScript = await AnswerScript.create({
            exam: testExam._id,
            filename: 'script_001.pdf',
            batchId: 'batch_test_001',
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 10,
            pageCount: 10,
            isActive: true,
            identificationHistory: []
        });
    });

    // =========================================================================
    // Heading & Marker Detection Unit Tests
    // =========================================================================
    describe('1. Heading & Marker Detection', () => {
        it('detects explicit question headers with high confidence', () => {
            const h1 = SegmentHeadingDetector.detect('Q1: Define convolution.');
            expect(h1.isQuestionStart).toBe(true);
            expect(h1.questionNumber).toBe(1);
            expect(h1.confidence).toBeGreaterThanOrEqual(0.95);

            const h2 = SegmentHeadingDetector.detect('Question 4(b) Derive the formula.');
            expect(h2.isQuestionStart).toBe(true);
            expect(h2.questionNumber).toBe(4);
            expect(h2.subQuestion).toBe('b');

            const h3 = SegmentHeadingDetector.detect('Ans 3.');
            expect(h3.isQuestionStart).toBe(true);
            expect(h3.questionNumber).toBe(3);
        });

        it('detects explicit continuation markers with question identifier', () => {
            const c1 = SegmentHeadingDetector.detect('Q1 continued: Resuming calculation');
            expect(c1.isContinuation).toBe(true);
            expect(c1.questionNumber).toBe(1);
            expect(c1.confidence).toBeGreaterThanOrEqual(0.95);

            const c2 = SegmentHeadingDetector.detect('Ans 2 contd.');
            expect(c2.isContinuation).toBe(true);
            expect(c2.questionNumber).toBe(2);
        });

        it('detects transition footers (PTO) and scratch work sheets', () => {
            const pto = SegmentHeadingDetector.detect('PTO');
            expect(pto.isTransitionFooter).toBe(true);
            expect(pto.isContinuation).toBe(true);

            const scratch = SegmentHeadingDetector.detect('Rough Work Sheet - ignore');
            expect(scratch.isScratchWork).toBe(true);
        });
    });

    // =========================================================================
    // Scenario 1: Consecutive Continuation
    // =========================================================================
    describe('2. Scenario 1: Consecutive Continuation (Q1 p1 -> p2)', () => {
        it('reconstructs Q1 with 2 consecutive segments and high confidence', () => {
            const regions = AnswerScriptFixtureGenerator.createConsecutiveContinuationFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            expect(q1).toBeDefined();
            expect(q1!.segments.length).toBe(2);
            expect(q1!.segments[0].pageNumber).toBe(1);
            expect(q1!.segments[0].sequenceIndex).toBe(1);
            expect(q1!.segments[1].pageNumber).toBe(2);
            expect(q1!.segments[1].sequenceIndex).toBe(2);
            expect(q1!.isNonConsecutive).toBe(false);
            expect(q1!.status).toBe('AUTO_RECONSTRUCTED');
        });
    });

    // =========================================================================
    // Scenario 2: Distal Continuation (Prof. Jawahar Requirement)
    // =========================================================================
    describe('3. Scenario 2: Distal Continuation (Q1 p1 -> p7)', () => {
        it('reconstructs Q1 from Page 1 and Page 7 across distant pages and flags isNonConsecutive', () => {
            const regions = AnswerScriptFixtureGenerator.createDistalContinuationFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1, 2, 3, 4, 5, 6]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            expect(q1).toBeDefined();
            expect(q1!.segments.length).toBe(2);
            expect(q1!.segments[0].pageNumber).toBe(1);
            expect(q1!.segments[1].pageNumber).toBe(7);
            expect(q1!.pagesInvolved).toEqual([1, 7]);
            expect(q1!.isNonConsecutive).toBe(true); // Gaps exist between 1 and 7
            expect(q1!.status).toBe('AUTO_RECONSTRUCTED');

            // Verify intermediate questions are unaffected
            const q2 = results.find((r) => r.questionNumber === 2);
            expect(q2!.segments.length).toBe(1);
            expect(q2!.segments[0].pageNumber).toBe(2);

            const q3 = results.find((r) => r.questionNumber === 3);
            expect(q3!.segments.length).toBe(1);
            expect(q3!.segments[0].pageNumber).toBe(3);
        });
    });

    // =========================================================================
    // Scenario 3: Triple Non-Consecutive Pages
    // =========================================================================
    describe('4. Scenario 3: Triple Non-Consecutive Pages (Q1 p1, p4, p9)', () => {
        it('chains 3 non-consecutive segments in strict sequence order', () => {
            const regions = AnswerScriptFixtureGenerator.createTripleNonConsecutiveFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1, 2, 3, 4]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            expect(q1).toBeDefined();
            expect(q1!.segments.length).toBe(3);
            expect(q1!.segments.map((s) => s.pageNumber)).toEqual([1, 4, 9]);
            expect(q1!.segments.map((s) => s.sequenceIndex)).toEqual([1, 2, 3]);
            expect(q1!.isNonConsecutive).toBe(true);
        });
    });

    // =========================================================================
    // Scenario 4: Multiple Questions on Same Page
    // =========================================================================
    describe('5. Scenario 4: Multiple Questions on Same Page', () => {
        it('segments page into distinct bounding boxes for Q1 continuation and Q2 start', () => {
            const regions = AnswerScriptFixtureGenerator.createSharedPageFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1, 2]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            const q2 = results.find((r) => r.questionNumber === 2);

            expect(q1!.segments.length).toBe(3); // p1, p2, p3 (top region)
            const q1P3 = q1!.segments.find((s) => s.pageNumber === 3);
            expect(q1P3?.box?.y).toBe(0.05);

            expect(q2!.segments.length).toBe(1); // p3 (bottom region)
            expect(q2!.segments[0].box?.y).toBe(0.5);
        });
    });

    // =========================================================================
    // Scenario 5: Out-of-Order Answering
    // =========================================================================
    describe('6. Scenario 5: Out-of-Order Answering', () => {
        it('reconstructs Q1 from Page 2 and Page 5 despite non-sequential student ordering', () => {
            const regions = AnswerScriptFixtureGenerator.createOutOfOrderFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1, 2, 3, 5]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            expect(q1).toBeDefined();
            expect(q1!.segments.length).toBe(2);
            expect(q1!.segments[0].pageNumber).toBe(2); // Sequence 1
            expect(q1!.segments[1].pageNumber).toBe(5); // Sequence 2
            expect(q1!.segments[0].sequenceIndex).toBe(1);
            expect(q1!.segments[1].sequenceIndex).toBe(2);
            expect(q1!.isNonConsecutive).toBe(true);

            // Q3 is on Page 1
            const q3 = results.find((r) => r.questionNumber === 3);
            expect(q3!.segments[0].pageNumber).toBe(1);
        });
    });

    // =========================================================================
    // Scenario 6: Return to Earlier Question
    // =========================================================================
    describe('7. Scenario 6: Return to Earlier Question', () => {
        it('detects return to Q1 on Page 3 and appends it as continuation to Q1 on Page 1', () => {
            const regions = AnswerScriptFixtureGenerator.createReturnToQuestionFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1, 2]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            expect(q1!.segments.length).toBe(2);
            expect(q1!.segments[0].pageNumber).toBe(1);
            expect(q1!.segments[1].pageNumber).toBe(3);
            expect(q1!.segments[1].segmentType).toBe('CONTINUATION');
            expect(q1!.segments[1].evidence).toContain('RETURNED_TO_EARLIER_QUESTION');
        });
    });

    // =========================================================================
    // Scenario 7: Explicit Labelled Continuation Marker
    // =========================================================================
    describe('8. Scenario 7: Explicit Labelled Continuation Marker', () => {
        it('associates continuation marker "Q1 continued" with highest confidence', () => {
            const regions = AnswerScriptFixtureGenerator.createExplicitLabelledContinuationFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            expect(q1!.segments[1].confidence).toBeGreaterThanOrEqual(0.95);
            expect(q1!.segments[1].evidence).toContain('EXPLICIT_CONTD_WITH_QUESTION:Q1');
        });
    });

    // =========================================================================
    // Scenario 8: Unlabelled Continuation (Syntactic Continuity)
    // =========================================================================
    describe('9. Scenario 8: Unlabelled Continuation', () => {
        it('associates unlabelled page via syntactic mid-sentence continuity', () => {
            const regions = AnswerScriptFixtureGenerator.createUnlabelledSyntacticContinuationFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            expect(q1!.segments.length).toBe(2);
            expect(q1!.segments[1].evidence).toContain('SYNTACTIC_SENTENCE_CONTINUITY');
        });
    });

    // =========================================================================
    // Scenario 9: Ambiguous Continuation Handling
    // =========================================================================
    describe('10. Scenario 9: Ambiguous Continuation', () => {
        it('never drops uncertain segments; marks UNCERTAIN, flags NEEDS_REVIEW, and lists candidate scores', () => {
            const regions = AnswerScriptFixtureGenerator.createAmbiguousContinuationFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1, 2, 4]
            });

            const ambiguousAnswer = results.find((r) => r.isAmbiguous);
            expect(ambiguousAnswer).toBeDefined();
            expect(ambiguousAnswer!.status).toBe('NEEDS_REVIEW');
            expect(ambiguousAnswer!.ambiguityReason).toBeDefined();

            const uncertainSeg = ambiguousAnswer!.segments.find((s) => s.segmentType === 'UNCERTAIN');
            expect(uncertainSeg).toBeDefined();
            expect(uncertainSeg!.candidateAssociations?.length).toBeGreaterThanOrEqual(1);
        });
    });

    // =========================================================================
    // Scenario 10: Unrelated / Scratch Page
    // =========================================================================
    describe('11. Scenario 10: Scratch Sheet Exclusion', () => {
        it('excludes scratch work page without corrupting Q1 continuation chain', () => {
            const regions = AnswerScriptFixtureGenerator.createScratchSheetFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            expect(q1!.segments.length).toBe(2);
            expect(q1!.segments[0].pageNumber).toBe(1);
            expect(q1!.segments[1].pageNumber).toBe(3); // Page 2 (scratch) is omitted from Q1
        });
    });

    // =========================================================================
    // Scenario 11: Blank Page Handling
    // =========================================================================
    describe('12. Scenario 11: Blank Page Handling', () => {
        it('ignores nearBlank page and connects Q1 from Page 1 to Page 3', () => {
            const regions = AnswerScriptFixtureGenerator.createBlankPageFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            expect(q1!.segments.length).toBe(2);
            expect(q1!.segments.map((s) => s.pageNumber)).toEqual([1, 3]);
        });
    });

    // =========================================================================
    // Scenario 12: Diagram-Heavy Answer with Bounding Box
    // =========================================================================
    describe('13. Scenario 12: Diagram-Heavy Answer with Bounding Box', () => {
        it('preserves diagram bounding box information and links it to Q2', () => {
            const regions = AnswerScriptFixtureGenerator.createDiagramAnswerFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [2]
            });

            const q2 = results.find((r) => r.questionNumber === 2);
            expect(q2!.segments.length).toBe(2);
            expect(q2!.segments[1].box).toBeDefined();
            expect(q2!.segments[1].box?.width).toBe(0.8);
            expect(q2!.segments[1].box?.height).toBe(0.75);
        });
    });

    // =========================================================================
    // Scenario 13: Sub-Question Structures
    // =========================================================================
    describe('14. Scenario 13: Sub-Question Structures (Q1(a) vs Q2(a))', () => {
        it('differentiates parent question hierarchy without cross-bleed', () => {
            const regions = AnswerScriptFixtureGenerator.createSubQuestionStructureFixture();
            const results = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: dummyScriptId,
                examId: dummyExamId,
                regions,
                expectedQuestions: [1, 2]
            });

            const q1 = results.find((r) => r.questionNumber === 1);
            const q2 = results.find((r) => r.questionNumber === 2);

            expect(q1!.segments.length).toBe(2); // 1(a), 1(b)
            expect(q2!.segments.length).toBe(2); // 2(a), 2(b)
            expect(q1!.segments[0].subQuestion).toBe('a');
            expect(q2!.segments[0].subQuestion).toBe('a');
        });
    });

    // =========================================================================
    // Service & Database Integration Tests
    // =========================================================================
    describe('15. AnswerSegmentationService Database Integration', () => {
        it('persists and retrieves reconstructed answers for an AnswerScript', async () => {
            const regions = AnswerScriptFixtureGenerator.createDistalContinuationFixture();

            const saved = await answerSegmentationService.reconstructScript(testScript._id, {
                overrideRegions: regions,
                actingUserId: professorUser._id.toString()
            });

            expect(saved.length).toBeGreaterThanOrEqual(6);

            const retrieved = await answerSegmentationService.getReconstructedAnswers(testScript._id);
            expect(retrieved.length).toBe(saved.length);

            const q1 = await answerSegmentationService.getReconstructedAnswerForQuestion(
                testScript._id,
                1
            );
            expect(q1).toBeDefined();
            expect(q1!.segments.length).toBe(2);
            expect(q1!.isNonConsecutive).toBe(true);
        });

        it('allows reviewer verification of ambiguous answer', async () => {
            const regions = AnswerScriptFixtureGenerator.createAmbiguousContinuationFixture();

            await answerSegmentationService.reconstructScript(testScript._id, {
                overrideRegions: regions,
                actingUserId: professorUser._id.toString()
            });

            const ambiguousQ = await ReconstructedAnswer.findOne({
                answerScript: testScript._id,
                isAmbiguous: true
            });
            expect(ambiguousQ).toBeDefined();

            const verified = await answerSegmentationService.verifyReconstructedAnswer(
                testScript._id,
                ambiguousQ!.questionNumber,
                professorUser._id.toString(),
                'Confirmed belongs to Q2 after physical booklet inspection'
            );

            expect(verified.status).toBe('VERIFIED');
            expect(verified.isAmbiguous).toBe(false);
            expect(verified.reviewNotes).toContain('Confirmed belongs to Q2');
        });

        it('throws 404 for non-existent answer script', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            await expect(
                answerSegmentationService.reconstructScript(fakeId)
            ).rejects.toThrow(/AnswerScript not found/i);
        });
    });

    // =========================================================================
    // 16. Isolated Research API Endpoints
    // =========================================================================
    describe('16. Direction 3 Isolated Research API Endpoints', () => {
        beforeEach(async () => {
            // Seed a distal continuation reconstruction
            const regions = AnswerScriptFixtureGenerator.createDistalContinuationFixture();
            await answerSegmentationService.reconstructScript(testScript._id, {
                overrideRegions: regions,
                actingUserId: professorUser._id.toString()
            });
        });

        it('GET /api/research/segmentation/[scriptId] - returns 401 when unauthenticated', async () => {
            mockSessionUser = null;
            const req = new NextRequest(`http://localhost:3000/api/research/segmentation/${testScript._id}`);
            const res = await getSegmentationRoute(req, { params: Promise.resolve({ scriptId: testScript._id.toString() }) });
            expect(res.status).toBe(401);
        });

        it('GET /api/research/segmentation/[scriptId] - returns 200 with complete question map for Professor', async () => {
            mockSessionUser = {
                id: professorUser._id.toString(),
                email: professorUser.email,
                name: professorUser.name,
                role: UserRole.PROFESSOR
            };

            const req = new NextRequest(`http://localhost:3000/api/research/segmentation/${testScript._id}`);
            const res = await getSegmentationRoute(req, { params: Promise.resolve({ scriptId: testScript._id.toString() }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(6);

            const q1 = json.data.find((q: { questionNumber: number }) => q.questionNumber === 1);
            expect(q1).toBeDefined();
            expect(q1.pagesInvolved).toEqual([1, 7]);
            expect(q1.isNonConsecutive).toBe(true);
            expect(q1.segments.length).toBe(2);
        });

        it('GET /api/research/segmentation/[scriptId]/question/[qNum] - returns single question reconstruction', async () => {
            mockSessionUser = {
                id: professorUser._id.toString(),
                email: professorUser.email,
                name: professorUser.name,
                role: UserRole.PROFESSOR
            };

            const req = new NextRequest(`http://localhost:3000/api/research/segmentation/${testScript._id}/question/1`);
            const res = await getQuestionRoute(req, { params: Promise.resolve({ scriptId: testScript._id.toString(), questionNumber: '1' }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.questionNumber).toBe(1);
            expect(json.data.pagesInvolved).toEqual([1, 7]);
            expect(json.data.segments[0].segmentType).toBe('START');
            expect(json.data.segments[1].segmentType).toBe('CONTINUATION');
        });

        it('PATCH /api/research/segmentation/[scriptId]/question/[qNum] - verifies question reconstruction', async () => {
            mockSessionUser = {
                id: professorUser._id.toString(),
                email: professorUser.email,
                name: professorUser.name,
                role: UserRole.PROFESSOR
            };

            const req = new NextRequest(`http://localhost:3000/api/research/segmentation/${testScript._id}/question/1`, {
                method: 'PATCH',
                body: JSON.stringify({ notes: 'Verified in API test' }),
                headers: { 'Content-Type': 'application/json' }
            });
            const res = await patchQuestionRoute(req, { params: Promise.resolve({ scriptId: testScript._id.toString(), questionNumber: '1' }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.status).toBe('VERIFIED');
            expect(json.data.reviewNotes).toContain('Verified in API test');
        });

        it('GET /api/research/segmentation/[scriptId] - returns 403 when unauthorized role accesses', async () => {
            mockSessionUser = {
                id: new mongoose.Types.ObjectId().toString(),
                email: 'unauthorized_student@iiit.ac.in',
                name: 'Student',
                role: UserRole.STUDENT
            };

            const req = new NextRequest(`http://localhost:3000/api/research/segmentation/${testScript._id}`);
            const res = await getSegmentationRoute(req, { params: Promise.resolve({ scriptId: testScript._id.toString() }) });
            expect(res.status).toBe(403);
        });

        it('GET /api/research/segmentation/[scriptId] - returns 400 on invalid scriptId', async () => {
            mockSessionUser = {
                id: professorUser._id.toString(),
                email: professorUser.email,
                name: professorUser.name,
                role: UserRole.PROFESSOR
            };

            const req = new NextRequest('http://localhost:3000/api/research/segmentation/invalid-id');
            const res = await getSegmentationRoute(req, { params: Promise.resolve({ scriptId: 'invalid-id' }) });
            expect(res.status).toBe(400);
        });
    });
});
