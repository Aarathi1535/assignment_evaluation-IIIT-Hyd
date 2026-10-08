import mongoose from 'mongoose';
import ClassroomAssessmentRepository, { ClassroomAggregatedResults } from '../repositories/ClassroomAssessmentRepository';
import { IClassroomQuestion, ClassroomQuestionType, ClassroomQuestionStatus } from '../models/ClassroomQuestion';
import { IClassroomSubmission } from '../models/ClassroomSubmission';
import ClassroomEventService from './ClassroomEventService';
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
    type?: ClassroomQuestionType;
    options?: string[];
    correctOptionIndex?: number | null;
    correctAnswerText?: string | null;
    explanation?: string;
    maxMarks?: number;
    order?: number;
    course?: string;
    isActive?: boolean;
}

export interface SubmitClassroomResponseInput {
    questionId: string;
    studentId: string;
    selectedOption?: number | null;
    textResponse?: string | null;
}

export interface SubmitClassroomAnswerInput {
    questionId: string;
    studentId: string;
    fileBuffer?: Buffer;
    originalFilename?: string;
    mimeType?: string;
    selectedOption?: number | null;
    textResponse?: string | null;
}

export class ClassroomAssessmentService {
    /**
     * Creates a new classroom question (Professor only).
     */
    async createQuestion(
        data: CreateClassroomQuestionInput,
        context: ClassroomAuditContext
    ): Promise<IClassroomQuestion> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can create classroom questions', 403);
        }

        if (!data.title || !data.title.trim()) {
            throw new HttpError('Question title is required', 400);
        }

        if (!data.questionPrompt || !data.questionPrompt.trim()) {
            throw new HttpError('Question prompt is required', 400);
        }

        const maxMarks = typeof data.maxMarks === 'number' && data.maxMarks >= 0 ? data.maxMarks : 1;
        const qType: ClassroomQuestionType = data.type || 'MULTIPLE_CHOICE';
        const options: string[] = Array.isArray(data.options) ? data.options.map((o) => o.trim()).filter(Boolean) : [];

        // Validate multiple choice options
        if (qType === 'MULTIPLE_CHOICE' && options.length > 0 && typeof data.correctOptionIndex === 'number') {
            if (data.correctOptionIndex < 0 || data.correctOptionIndex >= options.length) {
                throw new HttpError('Correct option index is out of bounds for the provided options', 400);
            }
        }

        const questionData: Partial<IClassroomQuestion> = {
            title: data.title.trim(),
            questionPrompt: data.questionPrompt.trim(),
            type: qType,
            options,
            correctOptionIndex: typeof data.correctOptionIndex === 'number' ? data.correctOptionIndex : null,
            correctAnswerText: data.correctAnswerText?.trim() || null,
            explanation: data.explanation?.trim() || '',
            maxMarks,
            order: typeof data.order === 'number' ? data.order : 0,
            course: data.course && mongoose.Types.ObjectId.isValid(data.course)
                ? new mongoose.Types.ObjectId(data.course)
                : undefined,
            createdBy: new mongoose.Types.ObjectId(context.actingUserId),
            isActive: !!data.isActive,
            isRevealed: false,
            status: data.isActive ? 'ACTIVE' : 'DRAFT'
        };

        const newQuestion = await ClassroomAssessmentRepository.createQuestion(questionData);

        // If marked active, ensure it is the only active question
        if (data.isActive) {
            await ClassroomAssessmentRepository.setActiveQuestion(newQuestion._id.toString());
            ClassroomEventService.notifyQuestionActivated(newQuestion._id.toString(), {
                title: newQuestion.title,
                questionPrompt: newQuestion.questionPrompt,
                type: newQuestion.type,
                options: newQuestion.options
            });
        }

        await writeAuditLog({
            user: context.actingUserId,
            action: 'CLASSROOM_QUESTION_CREATED',
            outcome: 'SUCCESS',
            entityId: newQuestion._id as mongoose.Types.ObjectId,
            entityType: 'ClassroomQuestion',
            details: {
                title: newQuestion.title,
                type: newQuestion.type,
                isActive: newQuestion.isActive
            },
            ipAddress: context.ipAddress
        });

        return newQuestion;
    }

    /**
     * Retrieves the currently active classroom question.
     * Sanitizes correct answers for students unless results are revealed.
     */
    async getActiveQuestion(context?: ClassroomAuditContext): Promise<Record<string, unknown> | null> {
        const active = await ClassroomAssessmentRepository.getActiveQuestion();
        if (!active) return null;

        const isStudent = context?.actingUserRole === 'STUDENT';
        const isRevealed = active.isRevealed || active.status === 'REVEALED';

        let mySubmission: IClassroomSubmission | null = null;
        if (context?.actingUserId) {
            mySubmission = await ClassroomAssessmentRepository.getExistingSubmission(
                active._id.toString(),
                context.actingUserId
            );
        }

        const aggregated = await ClassroomAssessmentRepository.getAggregatedResults(active._id.toString());

        const base = active.toObject();

        if (isStudent) {
            return {
                ...base,
                // Hide answer key from students until professor reveals
                correctOptionIndex: isRevealed ? base.correctOptionIndex : undefined,
                correctAnswerText: isRevealed ? base.correctAnswerText : undefined,
                sampleSolution: isRevealed ? base.sampleSolution : undefined,
                explanation: isRevealed ? base.explanation : undefined,
                hasSubmitted: !!mySubmission,
                mySubmission: mySubmission ? {
                    selectedOption: mySubmission.selectedOption,
                    textResponse: mySubmission.textResponse,
                    isCorrect: isRevealed ? mySubmission.isCorrect : undefined,
                    score: isRevealed ? mySubmission.score : undefined,
                    submittedAt: mySubmission.submittedAt
                } : null,
                results: isRevealed && aggregated ? {
                    ...aggregated,
                    responseHistory: undefined
                } : null
            };
        }

        // Professor / Admin view includes live aggregated results
        return {
            ...base,
            results: aggregated
        };
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

        // Students can only see active question
        const active = await ClassroomAssessmentRepository.getActiveQuestion();
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
     * Updates question active status or lifecycle state (ACTIVE, CLOSED, REVEALED, DRAFT).
     */
    async setQuestionActiveStatus(
        id: string,
        isActive: boolean,
        context: ClassroomAuditContext
    ): Promise<IClassroomQuestion> {
        return await this.setQuestionStatus(id, isActive ? 'ACTIVE' : 'CLOSED', context);
    }

    /**
     * Transitions a question through its lifecycle:
     * - ACTIVE: Only one question can be active at a time; starts accepting student responses.
     * - CLOSED: Stops accepting new responses; results remain hidden.
     * - REVEALED: Reveals aggregated results and correct answer to students.
     * - DRAFT: Returns question to unpresented state.
     */
    async setQuestionStatus(
        id: string,
        status: ClassroomQuestionStatus,
        context: ClassroomAuditContext
    ): Promise<IClassroomQuestion> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can manage question status', 403);
        }

        const question = await ClassroomAssessmentRepository.getQuestionById(id);
        if (!question) {
            throw new HttpError('Classroom question not found', 404);
        }

        if (question.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You can only modify your own questions', 403);
        }

        let updated: IClassroomQuestion | null = null;

        if (status === 'ACTIVE') {
            updated = await ClassroomAssessmentRepository.setActiveQuestion(id);
            if (updated) {
                ClassroomEventService.notifyQuestionActivated(id, {
                    title: updated.title,
                    questionPrompt: updated.questionPrompt,
                    type: updated.type,
                    options: updated.options
                });
            }
        } else if (status === 'CLOSED') {
            updated = await ClassroomAssessmentRepository.closeQuestion(id);
            if (updated) {
                ClassroomEventService.notifyQuestionClosed(id);
            }
        } else if (status === 'REVEALED') {
            updated = await ClassroomAssessmentRepository.revealQuestion(id);
            if (updated) {
                const results = await ClassroomAssessmentRepository.getAggregatedResults(id);
                ClassroomEventService.notifyQuestionRevealed(id, results as unknown as Record<string, unknown>);
            }
        } else {
            updated = await ClassroomAssessmentRepository.deactivateQuestion(id);
            if (updated) {
                ClassroomEventService.notifyQuestionDeactivated(id);
            }
        }

        if (!updated) {
            throw new HttpError('Failed to update question status', 500);
        }

        await writeAuditLog({
            user: context.actingUserId,
            action: `CLASSROOM_QUESTION_STATUS_${status}`,
            outcome: 'SUCCESS',
            entityId: new mongoose.Types.ObjectId(id),
            entityType: 'ClassroomQuestion',
            details: {
                questionId: id,
                status
            },
            ipAddress: context.ipAddress
        });

        return updated;
    }

    /**
     * Advances to the next question in the professor's question deck,
     * closing the current question and activating the next one.
     */
    async nextQuestion(
        currentQuestionId: string,
        context: ClassroomAuditContext
    ): Promise<IClassroomQuestion | null> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can advance questions', 403);
        }

        const current = await ClassroomAssessmentRepository.getQuestionById(currentQuestionId);
        if (!current) {
            throw new HttpError('Current classroom question not found', 404);
        }

        if (current.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You can only advance your own questions', 403);
        }

        // Close current question
        await ClassroomAssessmentRepository.closeQuestion(currentQuestionId);

        // Find next question
        const next = await ClassroomAssessmentRepository.getNextQuestion(currentQuestionId, context.actingUserId);
        if (!next) {
            await ClassroomAssessmentRepository.deactivateQuestion(currentQuestionId);
            ClassroomEventService.notifyQuestionDeactivated(currentQuestionId);
            return null;
        }

        // Activate next question
        const activatedNext = await ClassroomAssessmentRepository.setActiveQuestion(next._id.toString());
        if (activatedNext) {
            ClassroomEventService.notifyQuestionActivated(activatedNext._id.toString(), {
                title: activatedNext.title,
                questionPrompt: activatedNext.questionPrompt,
                type: activatedNext.type,
                options: activatedNext.options
            });
        }

        return activatedNext;
    }

    /**
     * Submits a student response (Multiple Choice or Short Answer).
     */
    async submitResponse(
        input: SubmitClassroomResponseInput,
        context: ClassroomAuditContext
    ): Promise<IClassroomSubmission> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserId !== input.studentId && context.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: Submitting on behalf of another student is not permitted', 403);
        }

        // 1. Verify question exists and is actively accepting responses
        const question = await ClassroomAssessmentRepository.getQuestionById(input.questionId);
        if (!question || !question.isActive || question.status !== 'ACTIVE') {
            throw new HttpError('No active classroom assessment question found for submission', 400);
        }

        // 2. Prevent duplicate responses per question
        const existing = await ClassroomAssessmentRepository.getExistingSubmission(input.questionId, input.studentId);
        if (existing) {
            throw new HttpError('You have already submitted an answer for this assessment question.', 409);
        }

        // 3. Validate response according to question type
        let isCorrect: boolean | null = null;
        let score = 0;

        if (question.type === 'MULTIPLE_CHOICE') {
            if (typeof input.selectedOption !== 'number' || input.selectedOption < 0 || input.selectedOption >= (question.options?.length || 0)) {
                throw new HttpError('Invalid option selected for this multiple-choice question', 400);
            }
            if (typeof question.correctOptionIndex === 'number') {
                isCorrect = input.selectedOption === question.correctOptionIndex;
                score = isCorrect ? (question.maxMarks || 1) : 0;
            }
        } else if (question.type === 'SHORT_ANSWER') {
            if (!input.textResponse || !input.textResponse.trim()) {
                throw new HttpError('Text response cannot be empty', 400);
            }
            if (question.correctAnswerText) {
                isCorrect = input.textResponse.trim().toLowerCase() === question.correctAnswerText.trim().toLowerCase();
                score = isCorrect ? (question.maxMarks || 1) : 0;
            }
        }

        // 4. Create and persist submission
        const submission = await ClassroomAssessmentRepository.createSubmission({
            question: new mongoose.Types.ObjectId(input.questionId),
            student: new mongoose.Types.ObjectId(input.studentId),
            selectedOption: typeof input.selectedOption === 'number' ? input.selectedOption : null,
            textResponse: input.textResponse?.trim() || null,
            isCorrect,
            score,
            maxMarks: question.maxMarks || 1,
            status: 'SUBMITTED',
            submittedAt: new Date()
        });

        // 5. Notify real-time listeners of new response count and distribution
        const stats = await ClassroomAssessmentRepository.getAggregatedResults(input.questionId);
        if (stats) {
            ClassroomEventService.notifyResponseSubmitted(input.questionId, stats as unknown as Record<string, unknown>);
        }

        await writeAuditLog({
            user: input.studentId,
            action: 'CLASSROOM_RESPONSE_SUBMITTED',
            outcome: 'SUCCESS',
            entityId: submission._id as mongoose.Types.ObjectId,
            entityType: 'ClassroomSubmission',
            details: {
                questionId: input.questionId,
                studentId: input.studentId,
                selectedOption: submission.selectedOption,
                isCorrect: submission.isCorrect
            },
            ipAddress: context.ipAddress
        });

        return submission;
    }

    /**
     * Unified submitAnswer supporting both simple interactive responses
     * and fallback image evaluation.
     */
    async submitAnswer(
        input: SubmitClassroomAnswerInput,
        context: ClassroomAuditContext
    ): Promise<IClassroomSubmission> {
        // If interactive simple response (selectedOption or textResponse provided)
        if (typeof input.selectedOption === 'number' || (input.textResponse && !input.fileBuffer)) {
            return await this.submitResponse(
                {
                    questionId: input.questionId,
                    studentId: input.studentId,
                    selectedOption: input.selectedOption,
                    textResponse: input.textResponse
                },
                context
            );
        }

        // Legacy / Handwritten answer evaluation fallback
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserId !== input.studentId && context.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: Submitting on behalf of another student is not permitted', 403);
        }

        const question = await ClassroomAssessmentRepository.getQuestionById(input.questionId);
        if (!question || !question.isActive || question.status !== 'ACTIVE') {
            throw new HttpError('No active classroom assessment question found for submission', 400);
        }

        const existingSubmission = await ClassroomAssessmentRepository.getExistingSubmission(
            input.questionId,
            input.studentId
        );
        if (existingSubmission && (existingSubmission.status === 'EVALUATED' || existingSubmission.status === 'SUBMITTED')) {
            throw new HttpError('You have already submitted an answer for this assessment question.', 409);
        }

        if (!input.fileBuffer || input.fileBuffer.length === 0) {
            throw new HttpError('Invalid upload: File buffer is empty', 400);
        }

        const validMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        const normalizedMime = input.mimeType?.toLowerCase() || '';
        if (!validMimeTypes.includes(normalizedMime)) {
            throw new HttpError(
                `Invalid upload: Unsupported file format "${input.mimeType}". Please upload a JPEG, PNG, or WebP image.`,
                400
            );
        }

        const submission = await ClassroomAssessmentRepository.createSubmission({
            question: new mongoose.Types.ObjectId(input.questionId),
            student: new mongoose.Types.ObjectId(input.studentId),
            originalFilename: input.originalFilename || 'answer.png',
            fileSize: input.fileBuffer.length,
            mimeType: input.mimeType,
            status: 'EVALUATING',
            score: 0,
            maxMarks: question.maxMarks,
            submittedAt: new Date()
        });

        try {
            const evaluationResult = await this.evaluateHandwrittenAnswer({
                question,
                imageBuffer: input.fileBuffer,
                mimeType: input.mimeType,
                filename: input.originalFilename || 'answer.png',
                fileSize: input.fileBuffer.length
            });

            submission.status = 'EVALUATED';
            submission.score = evaluationResult.score;
            submission.feedback = evaluationResult.feedback;
            submission.criterionScores = evaluationResult.criterionScores;
            submission.confidence = evaluationResult.confidence;
            submission.evaluatedAt = new Date();
            const saved = await submission.save();
            return saved;
        } catch (evalError) {
            submission.status = 'FAILED';
            submission.errorMessage = evalError instanceof Error ? evalError.message : 'Evaluation error';
            await submission.save();
            throw new HttpError(`Evaluation failed: ${submission.errorMessage}`, 500);
        }
    }

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

    async getQuestionResults(questionId: string, context: ClassroomAuditContext): Promise<ClassroomAggregatedResults> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        const question = await ClassroomAssessmentRepository.getQuestionById(questionId);
        if (!question) {
            throw new HttpError('Classroom question not found', 404);
        }

        if (context.actingUserRole === 'PROFESSOR' && question.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You can only view results for your own questions', 403);
        }

        if (context.actingUserRole === 'STUDENT' && !question.isRevealed && question.status !== 'REVEALED') {
            throw new HttpError('Results are not yet revealed for this question', 403);
        }

        const results = await ClassroomAssessmentRepository.getAggregatedResults(questionId);
        if (!results) {
            throw new HttpError('Failed to generate results', 500);
        }

        if (context.actingUserRole === 'STUDENT') {
            return {
                ...results,
                responseHistory: undefined
            };
        }

        return results;
    }

    async deleteQuestion(id: string, context: ClassroomAuditContext): Promise<boolean> {
        if (!context.actingUserId || !context.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can delete questions', 403);
        }

        const question = await ClassroomAssessmentRepository.getQuestionById(id);
        if (!question) {
            throw new HttpError('Classroom question not found', 404);
        }

        if (question.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You can only delete your own questions', 403);
        }

        return await ClassroomAssessmentRepository.deleteQuestion(id);
    }

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

        if (context.actingUserRole === 'STUDENT') {
            let studentId: string | null = null;
            if (submission.student) {
                const s = submission.student as unknown as { _id?: mongoose.Types.ObjectId };
                studentId = s._id ? s._id.toString() : submission.student.toString();
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
