import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import User, { IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import Exam, { IExam, ExamStatus, IngestionApprovalStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript, { IAnswerScript } from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import ReconstructedAnswer, { TaggedRegion } from '../models/AnswerSegmentation';
import answerSegmentationService from '../services/AnswerSegmentationService';
import { UserRole } from '../constants/permissions';
import { POST as postRegionRoute, GET as getRegionsRoute } from '../app/api/research/segmentation/[scriptId]/regions/route';
import { PUT as putRegionRoute, DELETE as deleteRegionRoute } from '../app/api/research/segmentation/[scriptId]/regions/[regionId]/route';
import { PUT as putQuestionRegionsRoute } from '../app/api/research/segmentation/[scriptId]/question/[questionNumber]/route';

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

describe('Mentor-Reviewed TA-Assisted Question-Region Tagging & Reconstruction', () => {
    let professorUser: IUser;
    let allocatedTaUser: IUser;
    let unallocatedTaUser: IUser;
    let studentUser: IUser;
    let testCourse: ICourse;
    let testExam: IExam;
    let testScript: IAnswerScript;

    beforeEach(async () => {
        // Clean collections
        await TaggedRegion.deleteMany({});
        await ReconstructedAnswer.deleteMany({});
        await Allocation.deleteMany({});

        // 1. Create Users
        professorUser = await User.create({
            name: 'Prof. Jawahar',
            email: `jawahar_ta_${Date.now()}@iiit.ac.in`,
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        allocatedTaUser = await User.create({
            name: 'TA Ananya',
            email: `ta_alloc_${Date.now()}@iiit.ac.in`,
            password: 'hashedPassword123',
            role: UserRole.TA,
            isActive: true
        });

        unallocatedTaUser = await User.create({
            name: 'TA External',
            email: `ta_ext_${Date.now()}@iiit.ac.in`,
            password: 'hashedPassword123',
            role: UserRole.TA,
            isActive: true
        });

        studentUser = await User.create({
            name: 'Student Rohan',
            email: `student_${Date.now()}@iiit.ac.in`,
            password: 'hashedPassword123',
            role: UserRole.STUDENT,
            isActive: true
        });

        // 2. Create Course
        testCourse = await Course.create({
            courseCode: 'CS7.502',
            courseName: 'Document Image Processing & Recognition',
            semester: 1,
            academicYear: '2026-2027',
            professor: professorUser._id,
            teachingAssistants: [allocatedTaUser._id],
            enrolledStudents: [],
            isActive: true
        });

        // 3. Create Exam
        testExam = await Exam.create({
            title: 'Midterm Exam - Document Analysis',
            course: testCourse._id,
            createdBy: professorUser._id,
            examDate: new Date(),
            totalMarks: 50,
            status: ExamStatus.EVALUATING,
            numberOfQuestions: 4,
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            isActive: true
        });

        // 4. Create Rubric
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
                { questionNumber: 4, maxMarks: 10, criteria: [{ criterionName: 'Correctness', points: 10 }] }
            ]
        });

        // 5. Create AnswerScript
        testScript = await AnswerScript.create({
            exam: testExam._id,
            filename: 'ta_tagged_script_001.pdf',
            batchId: 'batch_test_002',
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 10,
            pageCount: 10,
            isActive: true,
            identificationHistory: []
        });

        // 6. Allocate Script to TA Ananya
        await Allocation.create({
            exam: testExam._id,
            answerScript: testScript._id,
            ta: allocatedTaUser._id,
            allocatedBy: professorUser._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });
    });

    // =========================================================================
    // 1. Tagging a Region to a Question
    // =========================================================================
    describe('1. Tagging a Region to a Question', () => {
        it('allows a TA to tag a bounding box on a page and records it as human ground truth', async () => {
            const { region, reconstructedAnswer } = await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 1,
                    pageNumber: 1,
                    box: { x: 0.05, y: 0.1, width: 0.9, height: 0.4 },
                    notes: 'Answer header and formulation for Q1'
                },
                allocatedTaUser._id.toString()
            );

            expect(region).toBeDefined();
            expect(region.questionNumber).toBe(1);
            expect(region.pageNumber).toBe(1);
            expect(region.isGroundTruth).toBe(true);
            expect(region.taggedBy.toString()).toBe(allocatedTaUser._id.toString());
            expect(region.segmentType).toBe('START');
            expect(region.sequenceIndex).toBe(1);

            // Verified in reconstructed answer
            expect(reconstructedAnswer).toBeDefined();
            expect(reconstructedAnswer!.questionNumber).toBe(1);
            expect(reconstructedAnswer!.totalSegments).toBe(1);
            expect(reconstructedAnswer!.status).toBe('GROUND_TRUTH');
            expect(reconstructedAnswer!.isGroundTruth).toBe(true);
            expect(reconstructedAnswer!.isAmbiguous).toBe(false);
            expect(reconstructedAnswer!.reconstructionConfidence).toBe(1.0);
            expect(reconstructedAnswer!.segments[0].evidence).toContain('TA_TAGGED_GROUND_TRUTH');
        });

        it('rejects invalid bounding box coordinates', async () => {
            await expect(
                answerSegmentationService.tagRegion(
                    testScript._id,
                    {
                        questionNumber: 1,
                        pageNumber: 1,
                        box: { x: -0.1, y: 0.1, width: 1.2, height: 0.5 }
                    },
                    allocatedTaUser._id.toString()
                )
            ).rejects.toThrow('Bounding box coordinates must be normalized numbers within [0.0, 1.0]');
        });
    });

    // =========================================================================
    // 2. Multiple Regions for One Question
    // =========================================================================
    describe('2. Multiple Regions for One Question', () => {
        it('associates multiple tagged regions with the same question in proper sequence order', async () => {
            await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 1,
                    pageNumber: 1,
                    box: { x: 0.05, y: 0.1, width: 0.9, height: 0.35 }
                },
                allocatedTaUser._id.toString()
            );

            const { reconstructedAnswer } = await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 1,
                    pageNumber: 1,
                    box: { x: 0.05, y: 0.55, width: 0.9, height: 0.4 }
                },
                allocatedTaUser._id.toString()
            );

            expect(reconstructedAnswer).toBeDefined();
            expect(reconstructedAnswer!.questionNumber).toBe(1);
            expect(reconstructedAnswer!.totalSegments).toBe(2);
            expect(reconstructedAnswer!.segments[0].sequenceIndex).toBe(1);
            expect(reconstructedAnswer!.segments[0].segmentType).toBe('START');
            expect(reconstructedAnswer!.segments[1].sequenceIndex).toBe(2);
            expect(reconstructedAnswer!.segments[1].segmentType).toBe('CONTINUATION');
        });
    });

    // =========================================================================
    // 3. Continuation Across Pages (Consecutive and Non-Consecutive)
    // =========================================================================
    describe('3. Continuation Across Pages', () => {
        it('correctly tracks non-consecutive distal continuation (e.g. Page 1 -> Page 7)', async () => {
            // Tag initial segment on Page 1
            await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 2,
                    pageNumber: 1,
                    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 }
                },
                allocatedTaUser._id.toString()
            );

            // Tag continuation segment on Page 7
            const { reconstructedAnswer } = await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 2,
                    pageNumber: 7,
                    box: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 }
                },
                allocatedTaUser._id.toString()
            );

            expect(reconstructedAnswer).toBeDefined();
            expect(reconstructedAnswer!.pagesInvolved).toEqual([1, 7]);
            expect(reconstructedAnswer!.isNonConsecutive).toBe(true);
            expect(reconstructedAnswer!.segments[0].pageNumber).toBe(1);
            expect(reconstructedAnswer!.segments[1].pageNumber).toBe(7);
            expect(reconstructedAnswer!.status).toBe('GROUND_TRUTH');
        });

        it('correctly identifies consecutive continuation (e.g. Page 2 -> Page 3)', async () => {
            await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 3,
                    pageNumber: 2,
                    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
                },
                allocatedTaUser._id.toString()
            );

            const { reconstructedAnswer } = await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 3,
                    pageNumber: 3,
                    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.5 }
                },
                allocatedTaUser._id.toString()
            );

            expect(reconstructedAnswer).toBeDefined();
            expect(reconstructedAnswer!.pagesInvolved).toEqual([2, 3]);
            expect(reconstructedAnswer!.isNonConsecutive).toBe(false);
        });
    });

    // =========================================================================
    // 4. Multiple Questions on One Page
    // =========================================================================
    describe('4. Multiple Questions on One Page', () => {
        it('supports distinct regions for different questions sharing the same page', async () => {
            // Q1 on top half of Page 4
            await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 1,
                    pageNumber: 4,
                    box: { x: 0.05, y: 0.05, width: 0.9, height: 0.4 }
                },
                allocatedTaUser._id.toString()
            );

            // Q2 on bottom half of Page 4
            await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 2,
                    pageNumber: 4,
                    box: { x: 0.05, y: 0.5, width: 0.9, height: 0.45 }
                },
                allocatedTaUser._id.toString()
            );

            const q1Answer = await answerSegmentationService.getReconstructedAnswerForQuestion(testScript._id, 1);
            const q2Answer = await answerSegmentationService.getReconstructedAnswerForQuestion(testScript._id, 2);

            expect(q1Answer).toBeDefined();
            expect(q2Answer).toBeDefined();
            expect(q1Answer!.segments.some((s) => s.pageNumber === 4)).toBe(true);
            expect(q2Answer!.segments.some((s) => s.pageNumber === 4)).toBe(true);
            expect(q1Answer!.segments.find((s) => s.pageNumber === 4)?.box?.y).toBe(0.05);
            expect(q2Answer!.segments.find((s) => s.pageNumber === 4)?.box?.y).toBe(0.5);
        });
    });

    // =========================================================================
    // 5. Saving, Updating, and Removing a Region
    // =========================================================================
    describe('5. Saving, Updating, and Removing a Region', () => {
        it('allows updating an existing region coordinates and re-reconstructs the answer', async () => {
            const { region } = await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 1,
                    pageNumber: 2,
                    box: { x: 0.1, y: 0.1, width: 0.5, height: 0.3 }
                },
                allocatedTaUser._id.toString()
            );

            const updated = await answerSegmentationService.updateRegion(
                region._id,
                {
                    box: { x: 0.15, y: 0.2, width: 0.7, height: 0.6 },
                    notes: 'Expanded box to include handwritten equation'
                },
                allocatedTaUser._id.toString()
            );

            expect(updated.box.x).toBe(0.15);
            expect(updated.box.width).toBe(0.7);
            expect(updated.notes).toBe('Expanded box to include handwritten equation');

            const q1Answer = await answerSegmentationService.getReconstructedAnswerForQuestion(testScript._id, 1);
            expect(q1Answer!.segments[0].box?.x).toBe(0.15);
        });

        it('removes a tagged region and updates the reconstructed question structure', async () => {
            const { region } = await answerSegmentationService.tagRegion(
                testScript._id,
                {
                    questionNumber: 2,
                    pageNumber: 5,
                    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.5 }
                },
                allocatedTaUser._id.toString()
            );

            const deleteRes = await answerSegmentationService.removeRegion(
                region._id,
                allocatedTaUser._id.toString()
            );
            expect(deleteRes.success).toBe(true);

            const checkRegion = await TaggedRegion.findById(region._id);
            expect(checkRegion).toBeNull();
        });

        it('allows batch saving all regions for a specific question via saveQuestionRegions', async () => {
            const batchAnswer = await answerSegmentationService.saveQuestionRegions(
                testScript._id,
                3,
                [
                    {
                        questionNumber: 3,
                        pageNumber: 2,
                        box: { x: 0.05, y: 0.1, width: 0.9, height: 0.4 }
                    },
                    {
                        questionNumber: 3,
                        pageNumber: 5,
                        box: { x: 0.05, y: 0.2, width: 0.9, height: 0.5 }
                    }
                ],
                allocatedTaUser._id.toString()
            );

            expect(batchAnswer).toBeDefined();
            expect(batchAnswer!.questionNumber).toBe(3);
            expect(batchAnswer!.totalSegments).toBe(2);
            expect(batchAnswer!.pagesInvolved).toEqual([2, 5]);
            expect(batchAnswer!.isNonConsecutive).toBe(true);
        });
    });

    // =========================================================================
    // 6. Reconstructing Question-Wise Answers & Ambiguity Handling
    // =========================================================================
    describe('6. Reconstructing Question-Wise Answers & Ambiguity Handling', () => {
        it('marks tagged questions as GROUND_TRUTH and untagged expected questions as NEEDS_REVIEW / ambiguous', async () => {
            // Tag Q1 and Q2, leave Q3 and Q4 untagged
            await answerSegmentationService.tagRegion(
                testScript._id,
                { questionNumber: 1, pageNumber: 1, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 } },
                allocatedTaUser._id.toString()
            );
            await answerSegmentationService.tagRegion(
                testScript._id,
                { questionNumber: 2, pageNumber: 2, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 } },
                allocatedTaUser._id.toString()
            );

            const allAnswers = await answerSegmentationService.getReconstructedAnswers(testScript._id);

            const q1 = allAnswers.find((a) => a.questionNumber === 1);
            expect(q1?.status).toBe('GROUND_TRUTH');
            expect(q1?.isGroundTruth).toBe(true);
            expect(q1?.isAmbiguous).toBe(false);

            const q2 = allAnswers.find((a) => a.questionNumber === 2);
            expect(q2?.status).toBe('GROUND_TRUTH');
            expect(q2?.isGroundTruth).toBe(true);
            expect(q2?.isAmbiguous).toBe(false);

            const q3 = allAnswers.find((a) => a.questionNumber === 3);
            expect(q3?.status).toBe('NEEDS_REVIEW');
            expect(q3?.isAmbiguous).toBe(true);
            expect(q3?.ambiguityReason).toContain('Pending TA region tagging');

            const q4 = allAnswers.find((a) => a.questionNumber === 4);
            expect(q4?.status).toBe('NEEDS_REVIEW');
            expect(q4?.isAmbiguous).toBe(true);
        });
    });

    // =========================================================================
    // 7. TA Authorization & API Endpoints
    // =========================================================================
    describe('7. TA Authorization & API Endpoints', () => {
        it('allows allocated TA to tag regions via POST /api/research/segmentation/[scriptId]/regions', async () => {
            mockSessionUser = {
                id: allocatedTaUser._id.toString(),
                email: allocatedTaUser.email,
                name: allocatedTaUser.name,
                role: UserRole.TA
            };

            const req = new NextRequest(`http://localhost/api/research/segmentation/${testScript._id}/regions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    questionNumber: 1,
                    pageNumber: 1,
                    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 }
                })
            });

            const res = await postRegionRoute(req, {
                params: Promise.resolve({ scriptId: testScript._id.toString() })
            });

            expect(res.status).toBe(201);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.data.region.questionNumber).toBe(1);
        });

        it('denies unallocated TA without course assignment with 403 Forbidden', async () => {
            mockSessionUser = {
                id: unallocatedTaUser._id.toString(),
                email: unallocatedTaUser.email,
                name: unallocatedTaUser.name,
                role: UserRole.TA
            };

            const req = new NextRequest(`http://localhost/api/research/segmentation/${testScript._id}/regions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    questionNumber: 1,
                    pageNumber: 1,
                    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 }
                })
            });

            const res = await postRegionRoute(req, {
                params: Promise.resolve({ scriptId: testScript._id.toString() })
            });

            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.success).toBe(false);
            expect(data.message).toContain('Forbidden');
        });

        it('denies student role with 403 Forbidden', async () => {
            mockSessionUser = {
                id: studentUser._id.toString(),
                email: studentUser.email,
                name: studentUser.name,
                role: UserRole.STUDENT
            };

            const req = new NextRequest(`http://localhost/api/research/segmentation/${testScript._id}/regions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    questionNumber: 1,
                    pageNumber: 1,
                    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 }
                })
            });

            const res = await postRegionRoute(req, {
                params: Promise.resolve({ scriptId: testScript._id.toString() })
            });

            expect(res.status).toBe(403);
        });

        it('denies unauthenticated requests with 401 Unauthorized', async () => {
            mockSessionUser = null;

            const req = new NextRequest(`http://localhost/api/research/segmentation/${testScript._id}/regions`, {
                method: 'GET'
            });

            const res = await getRegionsRoute(req, {
                params: Promise.resolve({ scriptId: testScript._id.toString() })
            });

            expect(res.status).toBe(401);
        });

        it('allows allocated TA to update and delete region via PUT/DELETE endpoints', async () => {
            mockSessionUser = {
                id: allocatedTaUser._id.toString(),
                email: allocatedTaUser.email,
                name: allocatedTaUser.name,
                role: UserRole.TA
            };

            const { region } = await answerSegmentationService.tagRegion(
                testScript._id,
                { questionNumber: 1, pageNumber: 1, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } },
                allocatedTaUser._id.toString()
            );

            // PUT
            const putReq = new NextRequest(`http://localhost/api/research/segmentation/${testScript._id}/regions/${region._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ box: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } })
            });
            const putRes = await putRegionRoute(putReq, {
                params: Promise.resolve({ scriptId: testScript._id.toString(), regionId: region._id.toString() })
            });
            expect(putRes.status).toBe(200);

            // DELETE
            const delReq = new NextRequest(`http://localhost/api/research/segmentation/${testScript._id}/regions/${region._id}`, {
                method: 'DELETE'
            });
            const delRes = await deleteRegionRoute(delReq, {
                params: Promise.resolve({ scriptId: testScript._id.toString(), regionId: region._id.toString() })
            });
            expect(delRes.status).toBe(200);
        });

        it('allows batch saving question regions via PUT /api/research/segmentation/[scriptId]/question/[questionNumber]', async () => {
            mockSessionUser = {
                id: allocatedTaUser._id.toString(),
                email: allocatedTaUser.email,
                name: allocatedTaUser.name,
                role: UserRole.TA
            };

            const req = new NextRequest(`http://localhost/api/research/segmentation/${testScript._id}/question/2`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    regions: [
                        { pageNumber: 2, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 } },
                        { pageNumber: 3, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.5 } }
                    ]
                })
            });

            const res = await putQuestionRegionsRoute(req, {
                params: Promise.resolve({ scriptId: testScript._id.toString(), questionNumber: '2' })
            });

            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.data.totalSegments).toBe(2);
            expect(data.data.pagesInvolved).toEqual([2, 3]);
        });
    });
});
