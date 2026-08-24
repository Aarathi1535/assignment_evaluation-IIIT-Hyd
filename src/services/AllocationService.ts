import mongoose from 'mongoose';
import Allocation, { AllocationStatus, AllocationRule, IAllocation } from '../models/Allocation';
import Grade from '../models/Grade';
import AnswerScript, { IAnswerScript } from '../models/AnswerScript';
import Exam from '../models/Exam';
import Course, { ICourse } from '../models/Course';
import { HttpError } from '../lib/errors';

export class AllocationService {
    /**
     * Prepares the exam for allocation by enforcing the re-run contract:
     * - Checks if grading has already commenced (status !== PENDING or Grade exists).
     * - If so, throws a 400 HttpError.
     * - Otherwise, deletes existing allocations for the exam to avoid stale records.
     */
    static async prepareForAllocation(examId: string): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }

        const examObjectId = new mongoose.Types.ObjectId(examId);

        // Find existing allocations for the exam
        const existingAllocations = await Allocation.find({ exam: examObjectId });

        const hasGradingCommenced = existingAllocations.some(
            alloc => alloc.status !== AllocationStatus.PENDING
        );

        if (hasGradingCommenced) {
            throw new HttpError(
                'Cannot re-run allocation: grading has already commenced for this exam.',
                400
            );
        }

        // Also check if any Grade document exists for the exam's scripts
        const scripts = await AnswerScript.find({ exam: examObjectId, isActive: true }).select('_id');
        const scriptIds = scripts.map(s => s._id);

        if (scriptIds.length > 0) {
            const gradeExists = await Grade.exists({ answerScript: { $in: scriptIds } });
            if (gradeExists) {
                throw new HttpError(
                    'Cannot re-run allocation: grades already exist for this exam.',
                    400
                );
            }
        }

        // Safe to clear existing allocations
        await Allocation.deleteMany({ exam: examObjectId });
    }

    /**
     * Validates that all selected TA IDs are valid and belong to the course's TAs list.
     */
    static validateTeachingAssistants(course: ICourse, taIds: string[]): void {
        const courseTaStrings = course.teachingAssistants.map((id) => id.toString());
        for (const taId of taIds) {
            if (!mongoose.Types.ObjectId.isValid(taId)) {
                throw new HttpError(`Invalid TA ID format: ${taId}`, 400);
            }
            if (!courseTaStrings.includes(taId)) {
                throw new HttpError(`User ${taId} is not a teaching assistant for this course`, 400);
            }
        }
    }

    /**
     * Fetches eligible scripts for the exam.
     */
    static async getEligibleScripts(examObjectId: mongoose.Types.ObjectId): Promise<IAnswerScript[]> {
        return await AnswerScript.find({
            exam: examObjectId,
            isActive: true,
            student: { $ne: null },
            needsManualId: { $ne: true }
        });
    }

    /**
     * Allocates all eligible scripts of the exam equally across the provided TAs.
     */
    static async allocateEqual(
        examId: string,
        taIds: string[],
        allocatedById: string
    ): Promise<IAllocation[]> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }
        if (!allocatedById || !mongoose.Types.ObjectId.isValid(allocatedById)) {
            throw new HttpError('Invalid Allocated By ID format', 400);
        }
        if (!taIds || taIds.length === 0) {
            throw new HttpError('At least one selected TA must be provided for allocation', 400);
        }

        const examObjectId = new mongoose.Types.ObjectId(examId);

        // Fetch Exam and Course
        const exam = await Exam.findById(examObjectId);
        if (!exam) {
            throw new HttpError('Exam not found', 404);
        }

        const course = await Course.findById(exam.course);
        if (!course) {
            throw new HttpError('Course not found for this exam', 404);
        }

        // Validate that all provided TAs are registered on the course
        this.validateTeachingAssistants(course, taIds);

        // Run re-run check/cleaning contract
        await this.prepareForAllocation(examId);

        // Fetch eligible scripts
        const eligibleScripts = await this.getEligibleScripts(examObjectId);

        if (eligibleScripts.length === 0) {
            throw new HttpError('No eligible scripts found for allocation', 400);
        }

        // Sort scripts lexicographically by Hex ID string to be deterministic
        const sortedScripts = [...eligibleScripts].sort((a, b) =>
            a._id.toString().localeCompare(b._id.toString())
        );

        // Sort TAs lexicographically to be deterministic
        const sortedTAs = [...taIds].sort((a, b) => a.localeCompare(b));

        const allocationsToCreate = [];

        for (let i = 0; i < sortedScripts.length; i++) {
            const script = sortedScripts[i];
            const taId = sortedTAs[i % sortedTAs.length];

            allocationsToCreate.push({
                exam: examObjectId,
                ta: new mongoose.Types.ObjectId(taId),
                answerScript: script._id,
                allocatedBy: new mongoose.Types.ObjectId(allocatedById),
                status: AllocationStatus.PENDING,
                rule: AllocationRule.EQUAL
            });
        }

        // Save allocations and return them
        const createdAllocations = await Allocation.create(allocationsToCreate);
        return createdAllocations;
    }

    /**
     * Allocates specific questions of eligible scripts equally across the provided TAs.
     */
    static async allocateByQuestion(
        examId: string,
        taIds: string[],
        allocatedById: string
    ): Promise<IAllocation[]> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }
        if (!allocatedById || !mongoose.Types.ObjectId.isValid(allocatedById)) {
            throw new HttpError('Invalid Allocated By ID format', 400);
        }
        if (!taIds || taIds.length === 0) {
            throw new HttpError('At least one selected TA must be provided for allocation', 400);
        }

        const examObjectId = new mongoose.Types.ObjectId(examId);

        // Fetch Exam and Course
        const exam = await Exam.findById(examObjectId);
        if (!exam) {
            throw new HttpError('Exam not found', 404);
        }

        const course = await Course.findById(exam.course);
        if (!course) {
            throw new HttpError('Course not found for this exam', 404);
        }

        // Validate that all provided TAs are registered on the course
        this.validateTeachingAssistants(course, taIds);

        // Validate Exam.numberOfQuestions
        const numQuestions = exam.numberOfQuestions;
        if (
            numQuestions === undefined ||
            numQuestions === null ||
            typeof numQuestions !== 'number' ||
            isNaN(numQuestions) ||
            numQuestions < 1 ||
            !Number.isInteger(numQuestions)
        ) {
            throw new HttpError(`Invalid number of questions: ${numQuestions}`, 400);
        }

        // Run re-run check/cleaning contract
        await this.prepareForAllocation(examId);

        // Fetch eligible scripts
        const eligibleScripts = await this.getEligibleScripts(examObjectId);

        if (eligibleScripts.length === 0) {
            throw new HttpError('No eligible scripts found for allocation', 400);
        }

        // Sort scripts lexicographically by Hex ID string to be deterministic
        const sortedScripts = [...eligibleScripts].sort((a, b) =>
            a._id.toString().localeCompare(b._id.toString())
        );

        // Sort TAs lexicographically to be deterministic
        const sortedTAs = [...taIds].sort((a, b) => a.localeCompare(b));

        const allocationsToCreate = [];

        // For every script, allocate questions 1..N
        for (const script of sortedScripts) {
            for (let q = 1; q <= numQuestions; q++) {
                const taId = sortedTAs[(q - 1) % sortedTAs.length];

                allocationsToCreate.push({
                    exam: examObjectId,
                    ta: new mongoose.Types.ObjectId(taId),
                    answerScript: script._id,
                    allocatedBy: new mongoose.Types.ObjectId(allocatedById),
                    status: AllocationStatus.PENDING,
                    rule: AllocationRule.QUESTION,
                    question: q
                });
            }
        }

        // Save allocations and return them
        const createdAllocations = await Allocation.create(allocationsToCreate);
        return createdAllocations;
    }
}

export default AllocationService;
