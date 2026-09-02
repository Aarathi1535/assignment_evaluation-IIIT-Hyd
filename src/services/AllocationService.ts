import mongoose from 'mongoose';
import Allocation, { AllocationStatus, AllocationRule, IAllocation } from '../models/Allocation';
import Grade from '../models/Grade';
import AnswerScript, { IAnswerScript } from '../models/AnswerScript';
import Exam from '../models/Exam';
import Course, { ICourse } from '../models/Course';
import { HttpError } from '../lib/errors';
import AuditLog from '../models/AuditLog';
import User from '../models/User';
import { UserRole } from '../constants/permissions';
import ProgressEventService from './ProgressEventService';

export class AllocationService {
    /**
     * Checks if grading has already commenced for the given exam.
     * Throws 400 HttpError if grading has commenced or grades exist.
     */
    static async checkGradingCommenced(
        examObjectId: mongoose.Types.ObjectId,
        session?: mongoose.ClientSession
    ): Promise<void> {
        // Find existing allocations for the exam
        const existingAllocations = await Allocation.find({ exam: examObjectId }).session(session ?? null);

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
        const scripts = await AnswerScript.find({ exam: examObjectId, isActive: true })
            .select('_id')
            .session(session ?? null);
        const scriptIds = scripts.map(s => s._id);

        if (scriptIds.length > 0) {
            const gradeExists = await Grade.findOne({ answerScript: { $in: scriptIds } })
                .select('_id')
                .session(session ?? null);
            if (gradeExists) {
                throw new HttpError(
                    'Cannot re-run allocation: grades already exist for this exam.',
                    400
                );
            }
        }
    }

    /**
     * Prepares the exam for allocation by enforcing the re-run contract:
     * - Checks if grading has already commenced (status !== PENDING or Grade exists).
     * - If so, throws a 400 HttpError.
     * - Otherwise, deletes existing allocations for the exam to avoid stale records.
     */
    static async prepareForAllocation(examId: string, session?: mongoose.ClientSession): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }

        const examObjectId = new mongoose.Types.ObjectId(examId);

        await this.checkGradingCommenced(examObjectId, session);

        // Safe to clear existing allocations
        await Allocation.deleteMany({ exam: examObjectId }, { session });
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
     * Validates that exam.numberOfQuestions is a positive, non-null, finite integer.
     */
    static validateNumberOfQuestions(numQuestions: unknown): number {
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
        return numQuestions as number;
    }

    /**
     * Validates that seed is a finite integer.
     */
    static validateSeed(seed: unknown): number {
        if (
            seed === undefined ||
            seed === null ||
            typeof seed !== 'number' ||
            !Number.isFinite(seed) ||
            !Number.isInteger(seed)
        ) {
            throw new HttpError('Invalid seed: seed must be a finite integer number', 400);
        }
        return seed as number;
    }

    /**
     * Fetches eligible scripts for the exam.
     */
    static async getEligibleScripts(
        examObjectId: mongoose.Types.ObjectId,
        session?: mongoose.ClientSession
    ): Promise<IAnswerScript[]> {
        return await AnswerScript.find({
            exam: examObjectId,
            isActive: true,
            student: { $ne: null },
            needsManualId: { $ne: true }
        }).session(session ?? null);
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

        return await this.runInTransaction(async (session) => {
            // Run re-run check/cleaning contract
            await this.prepareForAllocation(examId, session);

            // Fetch eligible scripts
            const { eligibleScripts } = await this.getEligibleAndExcludedScripts(examObjectId, session);

            if (eligibleScripts.length === 0) {
                throw new HttpError('No eligible scripts found for allocation', 400);
            }

            const distribution = this.computeDistribution(
                AllocationRule.EQUAL,
                eligibleScripts,
                taIds,
                0
            );

            const allocationsToCreate = distribution.map(d => ({
                exam: examObjectId,
                ta: new mongoose.Types.ObjectId(d.ta),
                answerScript: new mongoose.Types.ObjectId(d.answerScript),
                allocatedBy: new mongoose.Types.ObjectId(allocatedById),
                status: AllocationStatus.PENDING,
                rule: AllocationRule.EQUAL
            }));

            // Save allocations and return them
            const createdAllocations = await Allocation.create(allocationsToCreate, { session });
            return createdAllocations;
        });
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
        const numQuestions = this.validateNumberOfQuestions(exam.numberOfQuestions);

        return await this.runInTransaction(async (session) => {
            // Run re-run check/cleaning contract
            await this.prepareForAllocation(examId, session);

            // Fetch eligible scripts
            const { eligibleScripts } = await this.getEligibleAndExcludedScripts(examObjectId, session);

            if (eligibleScripts.length === 0) {
                throw new HttpError('No eligible scripts found for allocation', 400);
            }

            const distribution = this.computeDistribution(
                AllocationRule.QUESTION,
                eligibleScripts,
                taIds,
                numQuestions
            );

            const allocationsToCreate = distribution.map(d => ({
                exam: examObjectId,
                ta: new mongoose.Types.ObjectId(d.ta),
                answerScript: new mongoose.Types.ObjectId(d.answerScript),
                allocatedBy: new mongoose.Types.ObjectId(allocatedById),
                status: AllocationStatus.PENDING,
                rule: AllocationRule.QUESTION,
                question: d.question
            }));

            // Save allocations and return them
            const createdAllocations = await Allocation.create(allocationsToCreate, { session });
            return createdAllocations;
        });
    }

    /**
     * Allocates all eligible scripts of the exam randomly across the provided TAs using a seeded PRNG.
     */
    static async allocateRandom(
        examId: string,
        taIds: string[],
        allocatedById: string,
        seed: number
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
        this.validateSeed(seed);

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

        return await this.runInTransaction(async (session) => {
            // Run re-run check/cleaning contract
            await this.prepareForAllocation(examId, session);

            // Fetch eligible scripts
            const { eligibleScripts } = await this.getEligibleAndExcludedScripts(examObjectId, session);

            if (eligibleScripts.length === 0) {
                throw new HttpError('No eligible scripts found for allocation', 400);
            }

            const distribution = this.computeDistribution(
                AllocationRule.RANDOM,
                eligibleScripts,
                taIds,
                0,
                seed
            );

            const allocationsToCreate = distribution.map(d => ({
                exam: examObjectId,
                ta: new mongoose.Types.ObjectId(d.ta),
                answerScript: new mongoose.Types.ObjectId(d.answerScript),
                allocatedBy: new mongoose.Types.ObjectId(allocatedById),
                status: AllocationStatus.PENDING,
                rule: AllocationRule.RANDOM,
                seed
            }));

            // Save allocations and return them
            const createdAllocations = await Allocation.create(allocationsToCreate, { session });
            return createdAllocations;
        });
    }

    /**
     * Fetches all scripts for the exam and partitions them into eligible and excluded sets with reasons.
     */
    static async getEligibleAndExcludedScripts(
        examObjectId: mongoose.Types.ObjectId,
        session?: mongoose.ClientSession
    ): Promise<{
        eligibleScripts: IAnswerScript[];
        excludedScripts: Array<{ scriptId: string; reason: string }>;
    }> {
        const allScripts = await AnswerScript.find({ exam: examObjectId }).session(session ?? null);

        const eligibleScripts: IAnswerScript[] = [];
        const excludedScripts: Array<{ scriptId: string; reason: string }> = [];

        for (const script of allScripts) {
            if (!script.isActive) {
                excludedScripts.push({
                    scriptId: script._id.toString(),
                    reason: 'Inactive script'
                });
            } else if (!script.student) {
                excludedScripts.push({
                    scriptId: script._id.toString(),
                    reason: 'Student not identified'
                });
            } else if (script.needsManualId) {
                excludedScripts.push({
                    scriptId: script._id.toString(),
                    reason: script.manualIdReason || 'Needs manual identification'
                });
            } else {
                eligibleScripts.push(script);
            }
        }

        return { eligibleScripts, excludedScripts };
    }

    /**
     * Pure function to compute deterministic allocation distribution based on selected rule.
     */
    static computeDistribution(
        rule: AllocationRule,
        eligibleScripts: IAnswerScript[],
        taIds: string[],
        numQuestions: number,
        seed?: number
    ): AllocationResult[] {
        // Sort scripts lexicographically by Hex ID string to be deterministic
        const sortedScripts = [...eligibleScripts].sort((a, b) =>
            a._id.toString().localeCompare(b._id.toString())
        );

        // Sort TAs lexicographically to be deterministic
        const sortedTAs = [...taIds].sort((a, b) => a.localeCompare(b));

        const distribution: AllocationResult[] = [];

        if (rule === AllocationRule.EQUAL) {
            for (let i = 0; i < sortedScripts.length; i++) {
                const script = sortedScripts[i];
                const taId = sortedTAs[i % sortedTAs.length];
                distribution.push({
                    ta: taId,
                    answerScript: script._id.toString()
                });
            }
        } else if (rule === AllocationRule.QUESTION) {
            for (const script of sortedScripts) {
                for (let q = 1; q <= numQuestions; q++) {
                    const taId = sortedTAs[(q - 1) % sortedTAs.length];
                    distribution.push({
                        ta: taId,
                        answerScript: script._id.toString(),
                        question: q
                    });
                }
            }
        } else if (rule === AllocationRule.RANDOM) {
            if (seed === undefined || seed === null) {
                throw new HttpError('Seed is required for random allocation', 400);
            }
            const random = getSeededRandom(seed);
            const shuffledScripts = [...sortedScripts];
            for (let i = shuffledScripts.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                const temp = shuffledScripts[i];
                shuffledScripts[i] = shuffledScripts[j];
                shuffledScripts[j] = temp;
            }
            for (let i = 0; i < shuffledScripts.length; i++) {
                const script = shuffledScripts[i];
                const taId = sortedTAs[i % sortedTAs.length];
                distribution.push({
                    ta: taId,
                    answerScript: script._id.toString()
                });
            }
        }

        return distribution;
    }

    /**
     * Safe, side-effect-free preview of allocations.
     */
    static async previewAllocation(
        examId: string,
        taIds: string[],
        rule: AllocationRule,
        seed?: number
    ): Promise<PreviewAllocationResult> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
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

        // Check if grading has commenced
        await this.checkGradingCommenced(examObjectId);

        // Get eligible and excluded scripts
        const { eligibleScripts, excludedScripts } = await this.getEligibleAndExcludedScripts(examObjectId);

        if (eligibleScripts.length === 0) {
            throw new HttpError('No eligible scripts found for allocation', 400);
        }

        let numQuestions = 0;
        if (rule === AllocationRule.QUESTION) {
            numQuestions = this.validateNumberOfQuestions(exam.numberOfQuestions);
        } else if (rule === AllocationRule.RANDOM) {
            this.validateSeed(seed);
        }

        // Compute the distribution
        const distribution = this.computeDistribution(rule, eligibleScripts, taIds, numQuestions, seed);

        // Calculate counts per TA
        const allocationCounts: Record<string, number> = {};
        for (const taId of taIds) {
            allocationCounts[taId] = 0;
        }
        for (const d of distribution) {
            allocationCounts[d.ta] = (allocationCounts[d.ta] || 0) + 1;
        }

        // Group exclusions by reason for blind-grading safety
        const excludedCountsByReason: Record<string, number> = {};
        for (const esc of excludedScripts) {
            excludedCountsByReason[esc.reason] = (excludedCountsByReason[esc.reason] || 0) + 1;
        }

        return {
            allocationCounts,
            totalEligibleScripts: eligibleScripts.length,
            totalExcludedScripts: excludedScripts.length,
            excludedCountsByReason
        };
    }

    /**
     * Reassigns an existing allocation to another TA on the same course.
     * Operates inside a transaction and validates target TA eligibility and conflicts.
     */
    static async reassignAllocation(
        examId: string,
        allocationId: string,
        targetTaId: string,
        actingUserId: string
    ): Promise<IAllocation> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }
        if (!mongoose.Types.ObjectId.isValid(allocationId)) {
            throw new HttpError('Invalid Allocation ID format', 400);
        }
        if (!mongoose.Types.ObjectId.isValid(targetTaId)) {
            throw new HttpError('Invalid Target TA ID format', 400);
        }
        if (!mongoose.Types.ObjectId.isValid(actingUserId)) {
            throw new HttpError('Invalid Acting User ID format', 400);
        }

        const allocationObjectId = new mongoose.Types.ObjectId(allocationId);
        const targetTaObjectId = new mongoose.Types.ObjectId(targetTaId);
        const actingUserObjectId = new mongoose.Types.ObjectId(actingUserId);

        return await this.runInTransaction(async (session) => {
            // 1. Fetch the existing allocation
            const allocation = await Allocation.findById(allocationObjectId).session(session || null);
            if (!allocation) {
                throw new HttpError('Allocation not found', 404);
            }

            // Verify cross-resource exam matching
            if (allocation.exam.toString() !== examId) {
                throw new HttpError('Allocation does not belong to the specified exam', 400);
            }

            // Prevent reassignment of work that has already started or been graded
            if (allocation.status !== AllocationStatus.PENDING) {
                throw new HttpError('Cannot reassign allocation: grading/work has already started.', 400);
            }

            const gradeQuery: {
                answerScript: mongoose.Types.ObjectId;
                question?: number;
                $or?: Array<{ question: null } | { question: { $exists: false } }>;
            } = {
                answerScript: allocation.answerScript
            };
            if (allocation.question !== undefined && allocation.question !== null) {
                gradeQuery.question = allocation.question;
            } else {
                gradeQuery.$or = [
                    { question: null },
                    { question: { $exists: false } }
                ];
            }

            const gradeExists = await Grade.findOne(gradeQuery).select('_id').session(session || null);
            if (gradeExists) {
                throw new HttpError(
                    'Cannot reassign allocation: a grade already exists for this answer script and question.',
                    400
                );
            }

            // 2. Fetch the exam to verify course/TAs
            const exam = await Exam.findById(allocation.exam).session(session || null);
            if (!exam) {
                throw new HttpError('Exam associated with this allocation not found', 404);
            }

            // 3. Fetch the course
            const course = await Course.findById(exam.course).session(session || null);
            if (!course) {
                throw new HttpError('Course associated with this exam not found', 404);
            }

            // 4. Validate target TA belongs to course
            this.validateTeachingAssistants(course, [targetTaId]);

            // 5. If TA is already the same, do nothing
            if (allocation.ta.toString() === targetTaId) {
                return allocation;
            }

            // 6. Check unique index constraint manually to prevent duplicate allocation conflicts
            const conflictExists = await Allocation.exists({
                ta: targetTaObjectId,
                answerScript: allocation.answerScript,
                question: allocation.question,
                _id: { $ne: allocationObjectId }
            }).session(session || null);

            if (conflictExists) {
                throw new HttpError('Reassignment conflict: The target TA is already allocated to this script/question.', 400);
            }

            const previousTaId = allocation.ta.toString();

            // 7. Update allocation
            allocation.ta = targetTaObjectId;
            allocation.allocatedBy = actingUserObjectId;
            await allocation.save({ session });

            // 8. Audit log inside the transaction
            await AuditLog.create([{
                user: actingUserObjectId,
                action: 'ALLOCATION_REASSIGN',
                outcome: 'SUCCESS',
                entityId: allocationObjectId,
                entityType: 'Allocation',
                details: {
                    examId: exam._id.toString(),
                    answerScriptId: allocation.answerScript.toString(),
                    question: allocation.question,
                    previousTaId,
                    newTaId: targetTaId
                }
            }], { session });

            return allocation;
        });
    }

    /**
     * Helper to execute a sequence of DB operations inside a transaction.
     * Gracefully falls back to normal non-transactional execution if the MongoDB topology doesn't support transactions.
     */
    private static async runInTransaction<T>(
        fn: (session: mongoose.ClientSession | undefined) => Promise<T>
    ): Promise<T> {
        const connection = mongoose.connection;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const topology = (connection.getClient() as any)?.topology;
        const topologyType = (topology?.description?.type as string | undefined) ?? 'Unknown';

        const transactionCapable = [
            'ReplicaSetWithPrimary',
            'ReplicaSetNoPrimary',
            'Sharded',
            'LoadBalanced',
        ].includes(topologyType);

        if (!transactionCapable) {
            return await fn(undefined);
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();
            const result = await fn(session);
            await session.commitTransaction();
            return result;
        } catch (error) {
            try {
                await session.abortTransaction();
            } catch {
                // Ignore abort errors
            }
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Claims a PENDING allocation for the given TA, changing status to IN_PROGRESS.
     * This update is atomic and audit-logged.
     */
    static async claimAllocation(
        allocationId: string,
        taId: string
    ): Promise<IAllocation> {
        if (!mongoose.Types.ObjectId.isValid(allocationId)) {
            throw new HttpError('Invalid Allocation ID format', 400);
        }
        if (!mongoose.Types.ObjectId.isValid(taId)) {
            throw new HttpError('Invalid TA ID format', 400);
        }

        const allocationObjectId = new mongoose.Types.ObjectId(allocationId);
        const taObjectId = new mongoose.Types.ObjectId(taId);

        return await this.runInTransaction(async (session) => {
            const allocation = await Allocation.findOneAndUpdate(
                {
                    _id: allocationObjectId,
                    ta: taObjectId,
                    status: AllocationStatus.PENDING
                },
                {
                    $set: {
                        status: AllocationStatus.IN_PROGRESS,
                        claimedAt: new Date()
                    }
                },
                { new: true, session }
            );

            if (!allocation) {
                const exists = await Allocation.findById(allocationObjectId).session(session || null);
                if (!exists) {
                    throw new HttpError('Allocation not found', 404);
                }
                if (exists.ta.toString() !== taId) {
                    throw new HttpError('Forbidden: This allocation belongs to another TA', 403);
                }
                if (exists.status === AllocationStatus.IN_PROGRESS) {
                    throw new HttpError('Allocation is already in progress', 409);
                }
                if (exists.status === AllocationStatus.COMPLETED) {
                    throw new HttpError('Cannot claim a completed allocation', 400);
                }
                throw new HttpError('Failed to claim allocation', 400);
            }

            // Write audit log inside the transaction
            await AuditLog.create([{
                user: taObjectId,
                action: 'ALLOCATION_CLAIM',
                outcome: 'SUCCESS',
                entityId: allocationObjectId,
                entityType: 'Allocation',
                details: {
                    examId: allocation.exam.toString(),
                    answerScriptId: allocation.answerScript.toString(),
                    question: allocation.question,
                    taId: taId
                }
            }], { session });

            return allocation;
        });
    }

    /**
     * Releases an IN_PROGRESS allocation back to PENDING.
     * This update is atomic and audit-logged.
     */
    static async releaseAllocation(
        allocationId: string,
        taId: string,
        isBackupOperator = false
    ): Promise<IAllocation> {
        if (!mongoose.Types.ObjectId.isValid(allocationId)) {
            throw new HttpError('Invalid Allocation ID format', 400);
        }
        if (!mongoose.Types.ObjectId.isValid(taId)) {
            throw new HttpError('Invalid TA ID format', 400);
        }

        const allocationObjectId = new mongoose.Types.ObjectId(allocationId);
        const taObjectId = new mongoose.Types.ObjectId(taId);

        const query: {
            _id: mongoose.Types.ObjectId;
            status: AllocationStatus;
            ta?: mongoose.Types.ObjectId;
        } = {
            _id: allocationObjectId,
            status: AllocationStatus.IN_PROGRESS
        };
        if (!isBackupOperator) {
            query.ta = taObjectId;
        }

        return await this.runInTransaction(async (session) => {
            const allocation = await Allocation.findOneAndUpdate(
                query,
                {
                    $set: { status: AllocationStatus.PENDING },
                    $unset: { claimedAt: 1 }
                },
                { new: true, session }
            );

            if (!allocation) {
                const exists = await Allocation.findById(allocationObjectId).session(session || null);
                if (!exists) {
                    throw new HttpError('Allocation not found', 404);
                }
                if (!isBackupOperator && exists.ta.toString() !== taId) {
                    throw new HttpError('Forbidden: This allocation belongs to another TA', 403);
                }
                if (exists.status === AllocationStatus.PENDING) {
                    throw new HttpError('Allocation is already pending', 400);
                }
                if (exists.status === AllocationStatus.COMPLETED) {
                    throw new HttpError('Cannot release a completed allocation', 400);
                }
                throw new HttpError('Failed to release allocation', 400);
            }

            const owningTaId = allocation.ta.toString();
            const isOverride = owningTaId !== taId;

            // Write audit log inside the transaction
            await AuditLog.create([{
                user: taObjectId,
                action: 'ALLOCATION_RELEASE',
                outcome: 'SUCCESS',
                entityId: allocationObjectId,
                entityType: 'Allocation',
                details: {
                    examId: allocation.exam.toString(),
                    answerScriptId: allocation.answerScript.toString(),
                    question: allocation.question,
                    owningTaId,
                    actingUserId: taId,
                    isOverride
                }
            }], { session });

            return allocation;
        });
    }

    /**
     * Marks an IN_PROGRESS allocation as COMPLETED.
     * This transition is atomic, idempotent, properly authorized, and audit-logged.
     */
    static async markCompleted(
        allocationId: string,
        actor: unknown
    ): Promise<IAllocation> {
        if (!mongoose.Types.ObjectId.isValid(allocationId)) {
            throw new HttpError('Invalid Allocation ID format', 400);
        }

        let actorIdStr: string;
        let actorRole: UserRole | string | undefined;

        if (typeof actor === 'string') {
            actorIdStr = actor;
        } else if (actor && typeof actor === 'object') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actorObj = actor as Record<string, any>;
            actorIdStr = (actorObj.actingUserId || actorObj.id || actorObj._id)?.toString();
            actorRole = actorObj.actingUserRole || actorObj.role;
        } else {
            throw new HttpError('Invalid actor', 400);
        }

        if (!actorIdStr || !mongoose.Types.ObjectId.isValid(actorIdStr)) {
            throw new HttpError('Invalid Actor ID format', 400);
        }

        const allocationObjectId = new mongoose.Types.ObjectId(allocationId);

        const allocation = await this.runInTransaction(async (session) => {
            // Retrieve user role from DB if not provided in the actor object
            let role = actorRole;
            if (!role) {
                const UserModel = mongoose.models.User || mongoose.model('User');
                const user = await UserModel.findById(actorIdStr).session(session || null);
                if (user) {
                    role = user.role;
                }
            }

            const isBackupOperator = role === UserRole.PROFESSOR || role === UserRole.ADMIN;

            const query: {
                _id: mongoose.Types.ObjectId;
                status: AllocationStatus;
                ta?: mongoose.Types.ObjectId;
            } = {
                _id: allocationObjectId,
                status: AllocationStatus.IN_PROGRESS
            };

            if (!isBackupOperator) {
                query.ta = new mongoose.Types.ObjectId(actorIdStr);
            }

            const allocation = await Allocation.findOneAndUpdate(
                query,
                {
                    $set: {
                        status: AllocationStatus.COMPLETED,
                        completedAt: new Date()
                    }
                },
                { new: true, session }
            );

            if (!allocation) {
                const exists = await Allocation.findById(allocationObjectId).session(session || null);
                if (!exists) {
                    throw new HttpError('Allocation not found', 404);
                }
                if (!isBackupOperator && exists.ta.toString() !== actorIdStr) {
                    throw new HttpError('Forbidden: This allocation belongs to another TA', 403);
                }
                if (exists.status === AllocationStatus.PENDING) {
                    throw new HttpError('Cannot complete a pending allocation', 400);
                }
                if (exists.status === AllocationStatus.COMPLETED) {
                    throw new HttpError('Allocation is already completed', 409);
                }
                throw new HttpError('Failed to complete allocation', 400);
            }

            const owningTaId = allocation.ta.toString();
            const isOverride = owningTaId !== actorIdStr;

            // Write audit log inside the transaction
            await AuditLog.create([{
                user: new mongoose.Types.ObjectId(actorIdStr),
                action: 'ALLOCATION_COMPLETE',
                outcome: 'SUCCESS',
                entityId: allocationObjectId,
                entityType: 'Allocation',
                details: {
                    examId: allocation.exam.toString(),
                    answerScriptId: allocation.answerScript.toString(),
                    question: allocation.question,
                    taId: owningTaId,
                    actingUserId: actorIdStr,
                    isOverride
                }
            }], { session });

            return allocation;
        });

        // Emit transport-independent progress update event after successful completion
        const owningTaId = allocation.ta.toString();
        const examId = allocation.exam.toString();
        try {
            await ProgressEventService.emitAllocationCompleted(examId, owningTaId);
        } catch (eventError) {
            console.error('Failed to emit progress event:', eventError);
        }

        return allocation;
    }

    /**
     * Aggregates grading progress per TA for a specific exam using a MongoDB aggregation pipeline.
     * Evaluates total allocations and completed (graded) allocations without loading documents into memory.
     */
    static async getProgress(examId: string): Promise<ExamProgressResult> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }

        const examObjectId = new mongoose.Types.ObjectId(examId);

        const exam = await Exam.findById(examObjectId).select('gradingDeadline isActive');
        if (!exam || !exam.isActive) {
            throw new HttpError('Exam not found', 404);
        }

        const earliestAllocation = await Allocation.findOne({ exam: examObjectId })
            .sort({ createdAt: 1 })
            .select('createdAt');
        const gradingStart = earliestAllocation ? earliestAllocation.createdAt : null;

        const pipeline: mongoose.PipelineStage[] = [
            {
                $match: {
                    exam: examObjectId
                }
            },
            {
                $group: {
                    _id: '$ta',
                    total: { $sum: 1 },
                    graded: {
                        $sum: {
                            $cond: [{ $eq: ['$status', AllocationStatus.COMPLETED] }, 1, 0]
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'taInfo'
                }
            },
            {
                $unwind: {
                    path: '$taInfo',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 0,
                    taId: { $toString: '$_id' },
                    name: { $ifNull: ['$taInfo.name', 'Unknown TA'] },
                    graded: 1,
                    total: 1
                }
            },
            {
                $sort: {
                    name: 1
                }
            }
        ];

        const aggregatedResults = await Allocation.aggregate<TaProgressResult>(pipeline);

        const totalAllocations = aggregatedResults.reduce((acc, curr) => acc + curr.total, 0);
        const totalGraded = aggregatedResults.reduce((acc, curr) => acc + curr.graded, 0);

        // AE-104a: Calculate completion ratios and cohort median among eligible TAs (total > 0)
        const eligibleRatios = aggregatedResults
            .filter((ta) => ta.total > 0)
            .map((ta) => Math.round((ta.graded / ta.total) * 10000) / 10000)
            .sort((a, b) => a - b);

        let cohortMedianCompletionRatio = 0;
        if (eligibleRatios.length > 0) {
            const mid = Math.floor(eligibleRatios.length / 2);
            if (eligibleRatios.length % 2 === 1) {
                cohortMedianCompletionRatio = eligibleRatios[mid];
            } else {
                cohortMedianCompletionRatio = Math.round(((eligibleRatios[mid - 1] + eligibleRatios[mid]) / 2) * 10000) / 10000;
            }
        }

        // AE-104b: Absolute pace calculation using explicit gradingDeadline and gradingStart
        let paceAvailable = false;
        let paceReason: string | undefined = undefined;
        let expectedCompletionRatio: number | undefined = undefined;
        let bottleneckCount = 0;

        if (!exam.gradingDeadline) {
            paceAvailable = false;
            paceReason = 'GRADING_DEADLINE_NOT_SET';
        } else if (!gradingStart || totalAllocations === 0) {
            paceAvailable = false;
            paceReason = 'NO_ALLOCATIONS';
        } else {
            const startMs = new Date(gradingStart).getTime();
            const deadlineMs = new Date(exam.gradingDeadline).getTime();
            const nowMs = Date.now();

            if (deadlineMs <= startMs) {
                paceAvailable = false;
                paceReason = 'INVALID_DEADLINE_WINDOW';
            } else {
                paceAvailable = true;
                if (nowMs < startMs) {
                    expectedCompletionRatio = 0.0;
                } else if (nowMs >= deadlineMs) {
                    expectedCompletionRatio = 1.0;
                } else {
                    expectedCompletionRatio = Math.round(((nowMs - startMs) / (deadlineMs - startMs)) * 10000) / 10000;
                }
            }
        }

        const enrichedProgress: TaProgressResult[] = aggregatedResults.map((ta) => {
            const completionRatio = ta.total > 0 ? Math.round((ta.graded / ta.total) * 10000) / 10000 : 0;
            let isBottleneck = false;
            let paceLag: number | undefined = undefined;

            // 1. Cohort-based bottleneck detection (AE-104a)
            if (ta.total > 0 && eligibleRatios.length > 0) {
                const cohortDiff = Math.round((cohortMedianCompletionRatio - completionRatio) * 10000) / 10000;
                // Flagged when materially below the cohort median by more than 20 percentage points (0.20)
                if (cohortDiff > 0.20) {
                    isBottleneck = true;
                }
            }

            // 2. Absolute pace-based bottleneck detection (AE-104b)
            if (paceAvailable && expectedCompletionRatio !== undefined && ta.total > 0) {
                paceLag = Math.round(Math.max(0, expectedCompletionRatio - completionRatio) * 10000) / 10000;
                const paceDiff = Math.round((expectedCompletionRatio - completionRatio) * 10000) / 10000;
                // Materially lagging behind expected pace by more than 20 percentage points (0.20)
                if (paceDiff > 0.20) {
                    isBottleneck = true;
                }
            }

            if (isBottleneck) {
                bottleneckCount++;
            }

            return {
                ...ta,
                completionRatio,
                expectedCompletionRatio: paceAvailable ? expectedCompletionRatio : undefined,
                paceLag,
                isBottleneck,
                bottleneck: isBottleneck
            };
        });

        // AE-107: Naive ETA calculation based strictly on reliable completedAt timestamps
        let eta: Date | null = null;
        let etaAvailable = false;
        let etaReason: string | undefined = undefined;
        let estimatedRemainingSeconds: number | null = null;

        const remainingAllocations = Math.max(0, totalAllocations - totalGraded);

        if (totalAllocations === 0) {
            etaAvailable = false;
            etaReason = 'NO_ALLOCATIONS';
        } else if (remainingAllocations === 0) {
            etaAvailable = true;
            etaReason = 'COMPLETED';
            estimatedRemainingSeconds = 0;
            const latestCompleted = await Allocation.findOne({
                exam: examObjectId,
                status: AllocationStatus.COMPLETED,
                completedAt: { $exists: true, $ne: null }
            })
                .sort({ completedAt: -1 })
                .select('completedAt');
            eta = latestCompleted?.completedAt || new Date();
        } else {
            const [timingStats] = await Allocation.aggregate<{
                _id: null;
                first: Date;
                last: Date;
                count: number;
            }>([
                {
                    $match: {
                        exam: examObjectId,
                        status: AllocationStatus.COMPLETED,
                        completedAt: { $exists: true, $ne: null }
                    }
                },
                {
                    $group: {
                        _id: null,
                        first: { $min: '$completedAt' },
                        last: { $max: '$completedAt' },
                        count: { $sum: 1 }
                    }
                }
            ]);

            const completedCount = timingStats?.count || 0;

            if (completedCount < 2) {
                etaAvailable = false;
                etaReason = 'INSUFFICIENT_DATA';
            } else {
                const firstCompletedMs = new Date(timingStats.first).getTime();
                const lastCompletedMs = new Date(timingStats.last).getTime();
                const elapsedMs = lastCompletedMs - firstCompletedMs;

                if (elapsedMs <= 0) {
                    etaAvailable = false;
                    etaReason = 'INSUFFICIENT_INTERVAL';
                } else {
                    const avgMsPerCompletion = elapsedMs / (completedCount - 1);
                    const remainingMs = remainingAllocations * avgMsPerCompletion;
                    estimatedRemainingSeconds = Math.round(remainingMs / 1000);
                    eta = new Date(Date.now() + remainingMs);
                    etaAvailable = true;
                }
            }
        }

        return {
            examId,
            total: totalAllocations,
            graded: totalGraded,
            cohortMedianCompletionRatio,
            gradingDeadline: exam.gradingDeadline || null,
            gradingStart: gradingStart || null,
            paceAvailable,
            paceReason,
            expectedCompletionRatio,
            bottleneckCount,
            progress: enrichedProgress,
            eta,
            etaAvailable,
            etaReason,
            estimatedRemainingSeconds
        };
    }

    /**
     * Alias for getProgress to ensure consistent API ergonomics.
     */
    static async getExamProgress(examId: string): Promise<ExamProgressResult> {
        return this.getProgress(examId);
    }

    /**
     * Retrieves progress and specifically filtered bottlenecks for an exam (AE-104a).
     */
    static async getBottlenecks(examId: string): Promise<ExamBottleneckResult> {
        const progressResult = await this.getProgress(examId);
        const bottlenecks = progressResult.progress.filter((ta) => ta.isBottleneck);

        return {
            ...progressResult,
            bottlenecks
        };
    }

    /**
     * Retrieves progress and specifically filtered absolute-pace bottlenecks for an exam (AE-104b).
     */
    static async getAbsolutePace(examId: string): Promise<ExamAbsolutePaceResult> {
        const progressResult = await this.getProgress(examId);
        const bottlenecks = progressResult.progress.filter((ta) => ta.isBottleneck);

        return {
            ...progressResult,
            bottlenecks
        };
    }

    /**
     * Retrieves detailed allocation workload for a specific TA within an exam (AE-108).
     * Enforces strict scoping to both examId and taId.
     */
    static async getTaAllocationsForExam(examId: string, taId: string): Promise<TaExamWorkloadResult> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }
        if (!mongoose.Types.ObjectId.isValid(taId)) {
            throw new HttpError('Invalid TA ID format', 400);
        }

        const examObjectId = new mongoose.Types.ObjectId(examId);
        const taObjectId = new mongoose.Types.ObjectId(taId);

        const exam = await Exam.findById(examObjectId).select('title isActive');
        if (!exam || !exam.isActive) {
            throw new HttpError('Exam not found', 404);
        }

        const taUser = await User.findById(taObjectId).select('name email role isActive');
        if (!taUser) {
            throw new HttpError('TA not found', 404);
        }

        const allocations = await Allocation.find({
            exam: examObjectId,
            ta: taObjectId
        })
            .populate({
                path: 'answerScript',
                select: 'anonymousId scriptReference filename pageCount'
            })
            .sort({ createdAt: 1 });

        const scripts: TaAllocatedScriptItem[] = allocations.map((alloc) => {
            const answerScript = alloc.answerScript as unknown as (IAnswerScript & { scriptReference?: string; anonymousId?: string }) | null;
            const scriptId = answerScript
                ? (answerScript.anonymousId || answerScript.scriptReference || answerScript.filename || alloc._id.toString())
                : alloc._id.toString();

            // Time per script: completedAt - claimedAt (in ms / seconds)
            let durationSeconds: number | null = null;
            if (
                alloc.status === AllocationStatus.COMPLETED &&
                alloc.claimedAt &&
                alloc.completedAt
            ) {
                const claimedMs = new Date(alloc.claimedAt).getTime();
                const completedMs = new Date(alloc.completedAt).getTime();
                const diffMs = completedMs - claimedMs;
                if (diffMs >= 0) {
                    durationSeconds = Math.round(diffMs / 1000);
                }
            }

            return {
                allocationId: alloc._id.toString(),
                scriptId,
                answerScriptId: answerScript?._id?.toString() || null,
                question: alloc.question ?? null,
                status: alloc.status,
                claimedAt: alloc.claimedAt || null,
                completedAt: alloc.completedAt || null,
                durationSeconds
            };
        });

        const total = scripts.length;
        const graded = scripts.filter((s) => s.status === AllocationStatus.COMPLETED).length;
        const inProgress = scripts.filter((s) => s.status === AllocationStatus.IN_PROGRESS).length;
        const pending = scripts.filter((s) => s.status === AllocationStatus.PENDING).length;

        return {
            examId,
            examTitle: exam.title,
            ta: {
                id: taUser._id.toString(),
                name: taUser.name,
                email: taUser.email
            },
            total,
            graded,
            inProgress,
            pending,
            scripts
        };
    }
}

export interface TaAllocatedScriptItem {
    allocationId: string;
    scriptId: string;
    answerScriptId: string | null;
    question: number | null;
    status: AllocationStatus;
    claimedAt: Date | null;
    completedAt: Date | null;
    durationSeconds: number | null;
}

export interface TaExamWorkloadResult {
    examId: string;
    examTitle: string;
    ta: {
        id: string;
        name: string;
        email: string;
    };
    total: number;
    graded: number;
    inProgress: number;
    pending: number;
    scripts: TaAllocatedScriptItem[];
}

export interface TaProgressResult {
    taId: string;
    name: string;
    graded: number;
    total: number;
    completionRatio: number;
    expectedCompletionRatio?: number;
    paceLag?: number;
    isBottleneck: boolean;
    bottleneck: boolean;
}

export interface ExamProgressResult {
    examId: string;
    total: number;
    graded: number;
    cohortMedianCompletionRatio: number;
    gradingDeadline?: Date | null;
    gradingStart?: Date | null;
    paceAvailable: boolean;
    paceReason?: string;
    expectedCompletionRatio?: number;
    bottleneckCount: number;
    progress: TaProgressResult[];
    eta?: Date | null;
    etaAvailable: boolean;
    etaReason?: string;
    estimatedRemainingSeconds?: number | null;
}

export interface ExamBottleneckResult extends ExamProgressResult {
    bottlenecks: TaProgressResult[];
}

export interface ExamAbsolutePaceResult extends ExamProgressResult {
    bottlenecks: TaProgressResult[];
}


export interface PreviewAllocationResult {
    allocationCounts: Record<string, number>;
    totalEligibleScripts: number;
    totalExcludedScripts: number;
    excludedCountsByReason: Record<string, number>;
}

export interface AllocationResult {
    ta: string;
    answerScript: string;
    question?: number;
}

function getSeededRandom(seed: number): () => number {
    let state = seed | 0;
    return function () {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), state | 1);
        t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export default AllocationService;
