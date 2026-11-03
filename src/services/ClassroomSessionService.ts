import mongoose from 'mongoose';
import path from 'path';
import crypto from 'crypto';
import ClassroomSession, { IClassroomSession } from '../models/ClassroomSession';
import ClassroomParticipant, { IClassroomParticipant } from '../models/ClassroomParticipant';
import ClassroomQuestion, { IClassroomQuestion } from '../models/ClassroomQuestion';
import ClassroomSubmission, { IClassroomSubmission } from '../models/ClassroomSubmission';
import ClassroomEventService from './ClassroomEventService';
import classroomStorageService from './ClassroomStorageService';
import { generateJoinCode, generateQRCodeSvg } from '../lib/classroomQr';
import { HttpError } from '../lib/errors';

export interface ClassroomAuditContext {
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

export interface CreateSessionAndActivityInput {
    title: string;
    questionPrompt: string;
    referenceAnswer?: string;
    timeLimit?: number;
    courseId?: string;
}

export interface JoinSessionResponse {
    participant: {
        id: string;
        name: string;
        token: string;
    };
    session: {
        id: string;
        title: string;
        joinCode: string;
        status: string;
        participantCount: number;
    };
    activeActivity: {
        id: string;
        title: string;
        questionPrompt: string;
        timeLimit: number;
        expiresAt: string | null;
        status: string;
    } | null;
}

export interface ActivityPublishedResults {
    activityId: string;
    title: string;
    questionPrompt: string;
    referenceAnswer: string;
    totalSubmissions: number;
    correctCount: number;
    incorrectCount: number;
    unreviewedCount: number;
    successRate: number;
    publishedAt: Date;
}

export class ClassroomSessionService {
    /**
     * Creates a new classroom session and initial activity with unique join code and QR code.
     */
    async createSessionAndActivity(
        input: CreateSessionAndActivityInput,
        context: ClassroomAuditContext
    ): Promise<{ session: IClassroomSession; activity: IClassroomQuestion; joinCode: string; qrCodeSvg: string }> {
        if (!context.actingUserId || context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can create classroom sessions', 403);
        }

        if (!input.title || !input.title.trim()) {
            throw new HttpError('Session title is required', 400);
        }

        if (!input.questionPrompt || !input.questionPrompt.trim()) {
            throw new HttpError('Question prompt is required', 400);
        }

        // Generate unique 6-character join code
        let joinCode = generateJoinCode();
        let attempts = 0;
        while (attempts < 5) {
            const existing = await ClassroomSession.findOne({ joinCode });
            if (!existing) break;
            joinCode = generateJoinCode();
            attempts++;
        }

        const timeLimit = typeof input.timeLimit === 'number' && input.timeLimit >= 0 ? input.timeLimit : 180;
        const now = new Date();
        const expiresAt = timeLimit > 0 ? new Date(now.getTime() + timeLimit * 1000) : null;

        // Generate QR code SVG linking to student join URL
        const joinUrl = `/classroom/session/${joinCode}`;
        const qrCodeSvg = generateQRCodeSvg(joinUrl, 280);

        // Create the session
        const session = await ClassroomSession.create({
            title: input.title.trim(),
            joinCode,
            qrCodeSvg,
            createdBy: new mongoose.Types.ObjectId(context.actingUserId),
            status: 'ACTIVE',
            defaultTimeLimit: timeLimit,
            participantCount: 0
        });

        // Create initial question/activity
        const activity = await ClassroomQuestion.create({
            session: session._id,
            title: input.title.trim(),
            questionPrompt: input.questionPrompt.trim(),
            referenceAnswer: input.referenceAnswer?.trim() || null,
            correctAnswerText: input.referenceAnswer?.trim() || null,
            timeLimit,
            type: 'HANDWRITTEN',
            options: [],
            order: 1,
            maxMarks: 1,
            totalSubmissions: 0,
            correctCount: 0,
            incorrectCount: 0,
            createdBy: new mongoose.Types.ObjectId(context.actingUserId),
            isActive: true,
            isRevealed: false,
            isPublished: false,
            status: 'ACTIVE',
            activatedAt: now,
            expiresAt
        });

        session.currentActivity = activity._id;
        await session.save();

        // Dispatch real-time event
        ClassroomEventService.notifyQuestionActivated(
            activity._id.toString(),
            {
                sessionId: session._id.toString(),
                joinCode,
                title: activity.title,
                questionPrompt: activity.questionPrompt,
                timeLimit,
                expiresAt: expiresAt?.toISOString() || null
            },
            session._id.toString()
        );

        return {
            session,
            activity,
            joinCode,
            qrCodeSvg
        };
    }

    /**
     * Allows a student to join a classroom session using a join code and classroom-specific identity.
     */
    async joinSession(joinCode: string, name: string, optionalUserId?: string): Promise<JoinSessionResponse> {
        if (!joinCode || !joinCode.trim()) {
            throw new HttpError('Join code is required', 400);
        }

        const normalizedCode = joinCode.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
            throw new HttpError('Invalid join code format. Must be 6 alphanumeric characters', 400);
        }

        if (!name || !name.trim()) {
            throw new HttpError('Participant name or roll number is required to join', 400);
        }

        const cleanName = name.trim().slice(0, 100);
        if (cleanName.length === 0) {
            throw new HttpError('Participant name cannot be empty', 400);
        }

        const session = await ClassroomSession.findOne({ joinCode: normalizedCode, status: 'ACTIVE' });

        if (!session) {
            throw new HttpError('Classroom session not found or is closed', 404);
        }

        // Generate participant identity and secret session-scoped token
        const participantId = `part_${crypto.randomBytes(6).toString('hex')}`;
        const token = `tok_${crypto.randomBytes(24).toString('hex')}`;

        const participant = await ClassroomParticipant.create({
            session: session._id,
            participantId,
            name: cleanName,
            token,
            userId: optionalUserId && mongoose.Types.ObjectId.isValid(optionalUserId)
                ? new mongoose.Types.ObjectId(optionalUserId)
                : null,
            joinedAt: new Date(),
            lastActiveAt: new Date()
        });

        // Increment participant counter
        const updatedSession = await ClassroomSession.findByIdAndUpdate(
            session._id,
            { $inc: { participantCount: 1 } },
            { returnDocument: 'after' }
        );

        // Notify presenter/professor screen of new participant
        ClassroomEventService.notifyParticipantJoined(session._id.toString(), {
            participantCount: updatedSession?.participantCount || 1,
            participantName: participant.name
        });

        // Fetch active activity if available (without exposing referenceAnswer before publication)
        let activeActivity = null;
        if (session.currentActivity) {
            const act = await ClassroomQuestion.findById(session.currentActivity);
            if (act && act.status === 'ACTIVE') {
                activeActivity = {
                    id: act._id.toString(),
                    title: act.title,
                    questionPrompt: act.questionPrompt,
                    timeLimit: act.timeLimit || 0,
                    expiresAt: act.expiresAt ? act.expiresAt.toISOString() : null,
                    status: act.status
                };
            }
        }

        return {
            participant: {
                id: participant.participantId,
                name: participant.name,
                token: participant.token
            },
            session: {
                id: session._id.toString(),
                title: session.title,
                joinCode: session.joinCode,
                status: session.status,
                participantCount: updatedSession?.participantCount || 1
            },
            activeActivity
        };
    }

    /**
     * Validates participant token and retrieves participant details.
     */
    async getParticipantByToken(token: string): Promise<IClassroomParticipant | null> {
        if (!token) return null;
        const participant = await ClassroomParticipant.findOne({ token });
        if (participant) {
            participant.lastActiveAt = new Date();
            await participant.save();
        }
        return participant;
    }

    /**
     * Submits an uploaded handwritten answer image.
     */
    async submitHandwrittenAnswer(options: {
        sessionCode: string;
        participantId: string;
        studentName: string;
        studentUserId?: string;
        fileBuffer: Buffer;
        originalFilename?: string;
        mimeType?: string;
    }): Promise<IClassroomSubmission> {
        const { sessionCode, participantId, studentName, studentUserId, fileBuffer, originalFilename, mimeType } = options;

        if (!sessionCode || !sessionCode.trim()) {
            throw new HttpError('Session code is required', 400);
        }

        const session = await ClassroomSession.findOne({
            joinCode: sessionCode.trim().toUpperCase(),
            status: 'ACTIVE'
        });

        if (!session) {
            throw new HttpError('Active classroom session not found', 404);
        }

        if (!session.currentActivity) {
            throw new HttpError('No active activity in this session', 400);
        }

        const activity = await ClassroomQuestion.findById(session.currentActivity);
        if (!activity || activity.status !== 'ACTIVE') {
            throw new HttpError('Submissions are currently closed for this activity', 400);
        }

        // Validate time limit
        if (activity.expiresAt && new Date() > activity.expiresAt) {
            // Check if activity should be automatically closed
            activity.status = 'CLOSED';
            activity.closedAt = new Date();
            activity.isActive = false;
            await activity.save();
            ClassroomEventService.notifyQuestionClosed(activity._id.toString(), undefined, session._id.toString());
            throw new HttpError('Time expired for this activity. Submissions are closed.', 400);
        }

        // Validate file buffer existence
        if (!fileBuffer || fileBuffer.length === 0) {
            throw new HttpError('Image file is required for submission', 400);
        }

        // Upload security: 10MB limit
        const MAX_SIZE = 10 * 1024 * 1024;
        if (fileBuffer.length > MAX_SIZE) {
            throw new HttpError('File size exceeds the 10MB limit', 400);
        }

        // Upload security: validate mime type
        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
        const normalizedMime = (mimeType || 'image/jpeg').toLowerCase();
        if (!allowedMimes.includes(normalizedMime)) {
            throw new HttpError('Invalid image format. Allowed formats: JPEG, PNG, WebP, HEIC', 400);
        }

        // Validate minimum size for an actual image
        if (fileBuffer.length < 50) {
            throw new HttpError('Uploaded image is too small or corrupt', 400);
        }

        // Verify image header magic bytes
        const isJpeg = fileBuffer.length >= 3 && fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff;
        const isPng = fileBuffer.length >= 8 && fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x4e && fileBuffer[3] === 0x47;
        const isWebp = fileBuffer.length > 12 && fileBuffer.toString('utf8', 0, 4) === 'RIFF' && fileBuffer.toString('utf8', 8, 12) === 'WEBP';
        const isHeic = fileBuffer.length > 12 && fileBuffer.toString('utf8', 4, 12).includes('ftyp');

        if (!isJpeg && !isPng && !isWebp && !isHeic) {
            throw new HttpError('Uploaded file content does not match a valid image format', 400);
        }

        // Determine extension and safe filename
        const ext = isPng ? '.png' : isWebp ? '.webp' : isHeic ? '.heic' : '.jpg';
        const safeName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
        const rawBase = path.basename(originalFilename || 'handwritten-answer.jpg');
        const sanitizedOriginalName = rawBase
            .replace(/\.{2,}/g, '.')
            .replace(/[^a-zA-Z0-9._-]/g, '')
            .slice(0, 100) || `answer${ext}`;

        // Save image securely via ClassroomStorageService (deployment-persistent)
        const storageResult = await classroomStorageService.storeImage({
            sessionId: session._id.toString(),
            activityId: activity._id.toString(),
            filename: safeName,
            buffer: fileBuffer,
            mimeType: normalizedMime
        });

        const relativeImagePath = storageResult.storagePath;

        // Check if student already submitted (prevent duplicate or allow replace)
        let submission: IClassroomSubmission;
        const existing = await ClassroomSubmission.findOne({
            question: activity._id,
            participantId
        });

        if (existing) {
            existing.imagePath = relativeImagePath;
            existing.originalFilename = sanitizedOriginalName;
            existing.fileSize = fileBuffer.length;
            existing.mimeType = normalizedMime;
            existing.studentName = studentName;
            existing.status = 'SUBMITTED';
            existing.submittedAt = new Date();
            submission = await existing.save();
        } else {
            submission = await ClassroomSubmission.create({
                question: activity._id,
                session: session._id,
                participantId,
                studentName,
                student: studentUserId && mongoose.Types.ObjectId.isValid(studentUserId)
                    ? new mongoose.Types.ObjectId(studentUserId)
                    : null,
                imagePath: relativeImagePath,
                originalFilename: sanitizedOriginalName,
                fileSize: fileBuffer.length,
                mimeType: normalizedMime,
                status: 'SUBMITTED',
                score: 0,
                maxMarks: 1,
                submittedAt: new Date()
            });

            await ClassroomQuestion.findByIdAndUpdate(activity._id, { $inc: { totalSubmissions: 1 } });
        }

        const freshActivity = await ClassroomQuestion.findById(activity._id);
        const totalSubs = freshActivity?.totalSubmissions || 1;

        // Dispatch real-time submission notification
        ClassroomEventService.notifySubmissionReceived(session._id.toString(), activity._id.toString(), {
            submissionId: submission._id.toString(),
            participantId,
            studentName,
            submittedAt: submission.submittedAt.toISOString(),
            imagePath: relativeImagePath,
            totalSubmissions: totalSubs
        });

        return submission;
    }

    /**
     * Closes submissions for the active activity manually.
     */
    async closeSubmissions(sessionCode: string, context: ClassroomAuditContext): Promise<IClassroomQuestion> {
        if (!context.actingUserId || context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can close submissions', 403);
        }

        const session = await ClassroomSession.findOne({
            joinCode: sessionCode.trim().toUpperCase()
        });

        if (!session || !session.currentActivity) {
            throw new HttpError('Active classroom activity not found', 404);
        }

        if (session.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You do not own this classroom session', 403);
        }

        const activity = await ClassroomQuestion.findById(session.currentActivity);
        if (!activity) {
            throw new HttpError('Activity not found', 404);
        }

        activity.status = 'CLOSED';
        activity.closedAt = new Date();
        activity.isActive = false;
        await activity.save();

        ClassroomEventService.notifyQuestionClosed(
            activity._id.toString(),
            {
                closedAt: activity.closedAt.toISOString(),
                totalSubmissions: activity.totalSubmissions || 0
            },
            session._id.toString()
        );

        return activity;
    }

    /**
     * Extends the time limit for the active activity.
     */
    async extendTimer(
        sessionCode: string,
        additionalSeconds: number,
        context: ClassroomAuditContext
    ): Promise<IClassroomQuestion> {
        if (!context.actingUserId || context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can extend timer', 403);
        }

        const session = await ClassroomSession.findOne({
            joinCode: sessionCode.trim().toUpperCase()
        });

        if (!session || !session.currentActivity) {
            throw new HttpError('Active classroom activity not found', 404);
        }

        if (session.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You do not own this classroom session', 403);
        }

        const activity = await ClassroomQuestion.findById(session.currentActivity);
        if (!activity) {
            throw new HttpError('Activity not found', 404);
        }

        const baseTime = activity.expiresAt && activity.expiresAt > new Date()
            ? activity.expiresAt.getTime()
            : Date.now();

        const newExpiresAt = new Date(baseTime + additionalSeconds * 1000);
        activity.expiresAt = newExpiresAt;
        activity.status = 'ACTIVE';
        activity.isActive = true;
        await activity.save();

        ClassroomEventService.notifyTimerExtended(session._id.toString(), activity._id.toString(), {
            expiresAt: newExpiresAt.toISOString(),
            additionalSeconds
        });

        return activity;
    }

    /**
     * Reviews a student submission and marks it Correct or Incorrect (Professor only).
     */
    async reviewSubmission(
        submissionId: string,
        isCorrect: boolean,
        note: string | null,
        context: ClassroomAuditContext
    ): Promise<IClassroomSubmission> {
        if (!context.actingUserId || context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can review submissions', 403);
        }

        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
            throw new HttpError('Invalid submission ID', 400);
        }

        const submission = await ClassroomSubmission.findById(submissionId);
        if (!submission) {
            throw new HttpError('Submission not found', 404);
        }

        const session = await ClassroomSession.findById(submission.session);
        if (!session || session.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You do not own the session for this submission', 403);
        }

        submission.isCorrect = isCorrect;
        submission.reviewNote = note ? note.trim() : null;
        submission.reviewedBy = new mongoose.Types.ObjectId(context.actingUserId);
        submission.reviewedAt = new Date();
        submission.status = 'REVIEWED';
        submission.score = isCorrect ? 1 : 0;
        await submission.save();

        // Recalculate correct and incorrect counts for the question
        const correctCount = await ClassroomSubmission.countDocuments({
            question: submission.question,
            isCorrect: true
        });
        const incorrectCount = await ClassroomSubmission.countDocuments({
            question: submission.question,
            isCorrect: false
        });

        await ClassroomQuestion.findByIdAndUpdate(submission.question, {
            correctCount,
            incorrectCount
        });

        const sessionId = submission.session ? submission.session.toString() : '';
        ClassroomEventService.notifySubmissionReviewed(sessionId, submission.question.toString(), {
            submissionId: submission._id.toString(),
            participantId: submission.participantId,
            isCorrect,
            correctCount,
            incorrectCount
        });

        return submission;
    }

    /**
     * Publishes activity results, revealing reference answer and aggregate correct/incorrect counts.
     */
    async publishResults(sessionCode: string, context: ClassroomAuditContext): Promise<ActivityPublishedResults> {
        if (!context.actingUserId || context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can publish results', 403);
        }

        const session = await ClassroomSession.findOne({
            joinCode: sessionCode.trim().toUpperCase()
        });

        if (!session || !session.currentActivity) {
            throw new HttpError('Active classroom activity not found', 404);
        }

        if (session.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You do not own this classroom session', 403);
        }

        const activity = await ClassroomQuestion.findById(session.currentActivity);
        if (!activity) {
            throw new HttpError('Activity not found', 404);
        }

        const now = new Date();
        activity.status = 'PUBLISHED';
        activity.isPublished = true;
        activity.isRevealed = true;
        activity.publishedAt = now;
        activity.isActive = false;

        const totalSubmissions = await ClassroomSubmission.countDocuments({ question: activity._id });
        const correctCount = await ClassroomSubmission.countDocuments({ question: activity._id, isCorrect: true });
        const incorrectCount = await ClassroomSubmission.countDocuments({ question: activity._id, isCorrect: false });
        const unreviewedCount = await ClassroomSubmission.countDocuments({ question: activity._id, isCorrect: null });

        activity.totalSubmissions = totalSubmissions;
        activity.correctCount = correctCount;
        activity.incorrectCount = incorrectCount;
        await activity.save();

        const successRate = totalSubmissions > 0 ? Math.round((correctCount / totalSubmissions) * 100) : 0;
        const referenceAnswer = activity.referenceAnswer || activity.correctAnswerText || activity.sampleSolution || 'No reference answer provided';

        const resultsPayload: ActivityPublishedResults = {
            activityId: activity._id.toString(),
            title: activity.title,
            questionPrompt: activity.questionPrompt,
            referenceAnswer,
            totalSubmissions,
            correctCount,
            incorrectCount,
            unreviewedCount,
            successRate,
            publishedAt: now
        };

        // Notify all clients (students, projector screen) that results are published
        ClassroomEventService.notifyActivityPublished(
            session._id.toString(),
            activity._id.toString(),
            resultsPayload as unknown as Record<string, unknown>
        );

        return resultsPayload;
    }

    /**
     * Retrieves session details by join code.
     */
    async getSessionByCode(joinCode: string): Promise<IClassroomSession | null> {
        return ClassroomSession.findOne({ joinCode: joinCode.trim().toUpperCase() });
    }

    /**
     * Retrieves all submissions for an activity (Professor only).
     */
    async getActivitySubmissions(activityId: string, context: ClassroomAuditContext): Promise<IClassroomSubmission[]> {
        if (!context.actingUserId || context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden: Only professors can view all submissions', 403);
        }

        const activity = await ClassroomQuestion.findById(activityId);
        if (!activity) {
            throw new HttpError('Activity not found', 404);
        }

        const session = await ClassroomSession.findById(activity.session);
        if (!session || session.createdBy.toString() !== context.actingUserId) {
            throw new HttpError('Forbidden: You do not own this classroom session', 403);
        }

        return ClassroomSubmission.find({ question: activityId }).sort({ submittedAt: 1 });
    }

    /**
     * Retrieves published results for students and presenters.
     */
    async getPublishedResults(activityId: string): Promise<ActivityPublishedResults | null> {
        const activity = await ClassroomQuestion.findById(activityId);
        if (!activity || !activity.isPublished) {
            return null;
        }

        const totalSubmissions = await ClassroomSubmission.countDocuments({ question: activity._id });
        const correctCount = await ClassroomSubmission.countDocuments({ question: activity._id, isCorrect: true });
        const incorrectCount = await ClassroomSubmission.countDocuments({ question: activity._id, isCorrect: false });
        const unreviewedCount = await ClassroomSubmission.countDocuments({ question: activity._id, isCorrect: null });
        const successRate = totalSubmissions > 0 ? Math.round((correctCount / totalSubmissions) * 100) : 0;

        return {
            activityId: activity._id.toString(),
            title: activity.title,
            questionPrompt: activity.questionPrompt,
            referenceAnswer: activity.referenceAnswer || activity.correctAnswerText || 'Reference answer not provided',
            totalSubmissions,
            correctCount,
            incorrectCount,
            unreviewedCount,
            successRate,
            publishedAt: activity.publishedAt || activity.updatedAt
        };
    }
}

const classroomSessionService = new ClassroomSessionService();
export default classroomSessionService;
