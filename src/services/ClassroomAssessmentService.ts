import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ClassroomAssessmentRepository from '../repositories/ClassroomAssessmentRepository';
import { IClassroomQuestion, IClassroomCriterion } from '../models/ClassroomQuestion';
import { IClassroomSubmission } from '../models/ClassroomSubmission';
import { writeAuditLog } from '../lib/audit';
import { HttpError } from '../lib/errors';
import classroomEvaluationService, { ValidatedEvaluationOutcome } from './ClassroomEvaluationService';

export interface ClassroomAuditContext {
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

export interface CreateClassroomQuestionInput {
    title: string;
    questionPrompt: string;
    maxMarks: number;
    rubricCriteria?: IClassroomCriterion[];
    sampleSolution?: string;
    course?: string;
    isActive?: boolean;
}

export interface SubmitClassroomAnswerInput {
    questionId: string;
    studentId: string;
    fileBuffer: Buffer;
    originalFilename: string;
    mimeType: string;
}

export class ClassroomAssessmentService {
    getStorageRoot(): string {
        return process.env.CLASSROOM_STORAGE_PATH || path.join(process.cwd(), 'data', 'classroom_submissions');
    }

    /**
     * Creates a new classroom question. (Professor / Admin only)
     */
    async createQuestion(
        data: CreateClassroomQuestionInput,
        context: ClassroomAuditContext
    ): Promise<IClassroomQuestion> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole !== 'PROFESSOR' && context.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: Only professors or admins can create classroom questions', 403);
        }

        if (!data.title || !data.title.trim()) {
            throw new HttpError('Question title is required', 400);
        }

        if (!data.questionPrompt || !data.questionPrompt.trim()) {
            throw new HttpError('Question prompt is required', 400);
        }

        if (!data.maxMarks || data.maxMarks <= 0) {
            throw new HttpError('Maximum marks must be greater than 0', 400);
        }

        // Validate rubric criteria points if provided
        const criteria = data.rubricCriteria || [];
        if (criteria.length > 0) {
            const criteriaTotal = criteria.reduce((sum, c) => sum + (c.points || 0), 0);
            if (criteriaTotal > data.maxMarks) {
                throw new HttpError(
                    `Sum of rubric criteria points (${criteriaTotal}) exceeds maximum marks (${data.maxMarks})`,
                    400
                );
            }
        }

        const questionData: Partial<IClassroomQuestion> = {
            title: data.title.trim(),
            questionPrompt: data.questionPrompt.trim(),
            maxMarks: data.maxMarks,
            rubricCriteria: criteria,
            sampleSolution: data.sampleSolution?.trim(),
            course: data.course && mongoose.Types.ObjectId.isValid(data.course)
                ? new mongoose.Types.ObjectId(data.course)
                : undefined,
            createdBy: new mongoose.Types.ObjectId(context.actingUserId),
            isActive: !!data.isActive,
            status: data.isActive ? 'ACTIVE' : 'DRAFT'
        };

        const newQuestion = await ClassroomAssessmentRepository.createQuestion(questionData);

        // If marked active, ensure it is the only active question
        if (data.isActive) {
            await ClassroomAssessmentRepository.setActiveQuestion(newQuestion._id.toString());
        }

        await writeAuditLog({
            user: context.actingUserId,
            action: 'CLASSROOM_QUESTION_CREATED',
            outcome: 'SUCCESS',
            entityId: newQuestion._id as mongoose.Types.ObjectId,
            entityType: 'ClassroomQuestion',
            details: {
                title: newQuestion.title,
                maxMarks: newQuestion.maxMarks,
                isActive: newQuestion.isActive
            },
            ipAddress: context.ipAddress
        });

        return newQuestion;
    }

    /**
     * Retrieves the currently active classroom question.
     */
    async getActiveQuestion(): Promise<IClassroomQuestion | null> {
        return await ClassroomAssessmentRepository.getActiveQuestion();
    }

    /**
     * Retrieves questions matching the user role and ownership.
     */
    async getQuestions(context: ClassroomAuditContext): Promise<IClassroomQuestion[]> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole === 'ADMIN') {
            return await ClassroomAssessmentRepository.getQuestions();
        }

        if (context.actingUserRole === 'PROFESSOR') {
            return await ClassroomAssessmentRepository.getQuestions({
                createdBy: new mongoose.Types.ObjectId(context.actingUserId)
            });
        }

        // Students can only see active questions
        const active = await this.getActiveQuestion();
        return active ? [active] : [];
    }

    /**
     * Retrieves a question by ID.
     */
    async getQuestionById(id: string, context: ClassroomAuditContext): Promise<IClassroomQuestion | null> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        const question = await ClassroomAssessmentRepository.getQuestionById(id);
        if (!question) {
            throw new HttpError('Classroom question not found', 404);
        }

        if (context.actingUserRole === 'STUDENT' && !question.isActive) {
            throw new HttpError('Classroom question is not active', 403);
        }

        return question;
    }

    /**
     * Activates or deactivates a classroom question. (Professor / Admin only)
     */
    async setQuestionActiveStatus(
        id: string,
        isActive: boolean,
        context: ClassroomAuditContext
    ): Promise<IClassroomQuestion> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole !== 'PROFESSOR' && context.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: Only professors or admins can manage question status', 403);
        }

        const question = await ClassroomAssessmentRepository.getQuestionById(id);
        if (!question) {
            throw new HttpError('Classroom question not found', 404);
        }

        // Ownership enforcement for professors
        if (context.actingUserRole === 'PROFESSOR' && question.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You can only modify your own questions', 403);
        }

        let updated: IClassroomQuestion | null;
        if (isActive) {
            updated = await ClassroomAssessmentRepository.setActiveQuestion(id);
        } else {
            updated = await ClassroomAssessmentRepository.deactivateQuestion(id);
        }

        if (!updated) {
            throw new HttpError('Failed to update question status', 500);
        }

        await writeAuditLog({
            user: context.actingUserId,
            action: isActive ? 'CLASSROOM_QUESTION_ACTIVATED' : 'CLASSROOM_QUESTION_DEACTIVATED',
            outcome: 'SUCCESS',
            entityId: new mongoose.Types.ObjectId(id),
            entityType: 'ClassroomQuestion',
            details: {
                questionId: id,
                isActive
            },
            ipAddress: context.ipAddress
        });

        return updated;
    }

    /**
     * Handles student submission of a handwritten answer image,
     * stores the image, evaluates the submission using the evaluation pipeline,
     * and returns the evaluation outcome.
     */
    async submitAnswer(
        input: SubmitClassroomAnswerInput,
        context: ClassroomAuditContext
    ): Promise<IClassroomSubmission> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        // Verify that the acting user is the student submitting
        if (context.actingUserId !== input.studentId && context.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: Submitting on behalf of another student is not permitted', 403);
        }

        // 1. Verify that the question exists and is ACTIVE
        const question = await ClassroomAssessmentRepository.getQuestionById(input.questionId);
        if (!question || !question.isActive || question.status !== 'ACTIVE') {
            throw new HttpError('No active classroom assessment question found for submission', 400);
        }

        // 2. Prevent accidental duplicate submissions
        const existingSubmission = await ClassroomAssessmentRepository.getExistingSubmission(
            input.questionId,
            input.studentId
        );
        if (existingSubmission && existingSubmission.status === 'EVALUATED') {
            throw new HttpError('You have already submitted an answer for this assessment question.', 409);
        }

        // 3. Validate uploaded file
        if (!input.fileBuffer || input.fileBuffer.length === 0) {
            throw new HttpError('Invalid upload: File buffer is empty', 400);
        }

        const maxSizeBytes = 10 * 1024 * 1024; // 10MB
        if (input.fileBuffer.length > maxSizeBytes) {
            throw new HttpError('Invalid upload: File size exceeds the maximum allowed limit of 10MB', 400);
        }

        const validMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        const normalizedMime = input.mimeType?.toLowerCase();
        if (!validMimeTypes.includes(normalizedMime)) {
            throw new HttpError(
                `Invalid upload: Unsupported file format "${input.mimeType}". Please upload a JPEG, PNG, or WebP image.`,
                400
            );
        }

        // Determine file extension
        const ext = normalizedMime.includes('png') ? 'png' : normalizedMime.includes('webp') ? 'webp' : 'jpg';

        // 4. Store image to disk in classroom storage
        const storageRoot = this.getStorageRoot();
        const questionDir = path.join(storageRoot, input.questionId);
        await fs.promises.mkdir(questionDir, { recursive: true });

        const filename = `${input.studentId}_${Date.now()}.${ext}`;
        const filePath = path.join(questionDir, filename);
        await fs.promises.writeFile(filePath, input.fileBuffer);

        const relativeStoragePath = `classroom_submissions/${input.questionId}/${filename}`;

        // 5. Create submission record in EVALUATING state
        let submission: IClassroomSubmission;
        if (existingSubmission) {
            // Update existing in-flight / failed submission
            existingSubmission.imagePath = relativeStoragePath;
            existingSubmission.originalFilename = input.originalFilename;
            existingSubmission.fileSize = input.fileBuffer.length;
            existingSubmission.mimeType = input.mimeType;
            existingSubmission.status = 'EVALUATING';
            existingSubmission.submittedAt = new Date();
            submission = await existingSubmission.save();
        } else {
            submission = await ClassroomAssessmentRepository.createSubmission({
                question: new mongoose.Types.ObjectId(input.questionId),
                student: new mongoose.Types.ObjectId(input.studentId),
                imagePath: relativeStoragePath,
                originalFilename: input.originalFilename,
                fileSize: input.fileBuffer.length,
                mimeType: input.mimeType,
                status: 'EVALUATING',
                score: 0,
                maxMarks: question.maxMarks,
                feedback: '',
                criterionScores: [],
                submittedAt: new Date()
            });
        }

        // 6. Execute Evaluation Pipeline
        try {
            const evaluationResult = await this.evaluateHandwrittenAnswer({
                question,
                imageBuffer: input.fileBuffer,
                mimeType: input.mimeType,
                filename: input.originalFilename,
                fileSize: input.fileBuffer.length
            });

            submission.status = 'EVALUATED';
            submission.score = evaluationResult.score;
            submission.feedback = evaluationResult.feedback;
            submission.criterionScores = evaluationResult.criterionScores;
            submission.confidence = evaluationResult.confidence;
            submission.evaluatedAt = new Date();
            await submission.save();

            await writeAuditLog({
                user: input.studentId,
                action: 'CLASSROOM_SUBMISSION_EVALUATED',
                outcome: 'SUCCESS',
                entityId: submission._id as mongoose.Types.ObjectId,
                entityType: 'ClassroomSubmission',
                details: {
                    questionId: input.questionId,
                    studentId: input.studentId,
                    scoreAwarded: submission.score,
                    maxMarks: submission.maxMarks,
                    confidence: submission.confidence
                },
                ipAddress: context.ipAddress
            });

            return submission;
        } catch (evalError) {
            submission.status = 'FAILED';
            submission.errorMessage = evalError instanceof Error ? evalError.message : 'Evaluation error';
            await submission.save();

            await writeAuditLog({
                user: input.studentId,
                action: 'CLASSROOM_SUBMISSION_EVALUATED',
                outcome: 'FAILURE',
                entityId: submission._id as mongoose.Types.ObjectId,
                entityType: 'ClassroomSubmission',
                details: {
                    questionId: input.questionId,
                    studentId: input.studentId,
                    error: submission.errorMessage
                },
                ipAddress: context.ipAddress
            });

            throw new HttpError(`Evaluation failed: ${submission.errorMessage}`, 500);
        }
    }

    /**
     * Core evaluation pipeline: Analyzes the handwritten response image against
     * the question rubric and criteria, computing precise scores and constructive feedback
     * using the multimodal Gemini evaluator.
     */
    async evaluateHandwrittenAnswer(options: {
        question: IClassroomQuestion;
        imageBuffer: Buffer;
        mimeType?: string;
        filename: string;
        fileSize: number;
    }): Promise<ValidatedEvaluationOutcome> {
        return await classroomEvaluationService.evaluateHandwrittenAnswer({
            questionPrompt: options.question.questionPrompt,
            maxMarks: options.question.maxMarks,
            rubricCriteria: options.question.rubricCriteria,
            sampleSolution: options.question.sampleSolution,
            imageBuffer: options.imageBuffer,
            mimeType: options.mimeType || 'image/png'
        });
    }

    /**
     * Retrieves all student submissions for a specific question (Professor / Admin).
     */
    async getQuestionSubmissions(
        questionId: string,
        context: ClassroomAuditContext
    ): Promise<IClassroomSubmission[]> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole !== 'PROFESSOR' && context.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: Only professors or admins can view all submissions for a question', 403);
        }

        return await ClassroomAssessmentRepository.getSubmissionsByQuestion(questionId);
    }

    /**
     * Retrieves all submissions for the logged-in student.
     */
    async getStudentSubmissions(
        studentId: string,
        questionId?: string,
        context?: ClassroomAuditContext
    ): Promise<IClassroomSubmission[]> {
        if (context && context.actingUserRole === 'STUDENT' && context.actingUserId !== studentId) {
            throw new HttpError('Forbidden: Access denied to other students submissions', 403);
        }

        return await ClassroomAssessmentRepository.getSubmissionsByStudent(studentId, questionId);
    }

    /**
     * Retrieves a single submission by ID.
     */
    async getSubmissionById(
        submissionId: string,
        context: ClassroomAuditContext
    ): Promise<IClassroomSubmission> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        const submission = await ClassroomAssessmentRepository.getSubmissionById(submissionId);
        if (!submission) {
            throw new HttpError('Submission not found', 404);
        }

        // Role-based visibility
        if (context.actingUserRole === 'STUDENT') {
            let studentId: string | null = null;
            if (submission.student) {
                const s = submission.student as unknown as { _id?: mongoose.Types.ObjectId };
                studentId = s._id ? s._id.toString() : submission.student.toString();
            } else {
                const doc = (submission as unknown as { _doc?: { student?: mongoose.Types.ObjectId } })._doc;
                if (doc?.student) {
                    studentId = doc.student.toString();
                }
            }

            if (studentId !== context.actingUserId) {
                throw new HttpError('Forbidden: Access denied to this submission', 403);
            }
        }

        return submission;
    }
}

const classroomAssessmentService = new ClassroomAssessmentService();
export default classroomAssessmentService;
