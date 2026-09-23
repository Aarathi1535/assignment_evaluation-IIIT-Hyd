import mongoose from 'mongoose';
import { NotificationType } from '../models/Notification';

export interface RenderedNotification {
    title: string;
    message: string;
    type: NotificationType;
}

export interface AssignmentTemplatePayload {
    exam?: string | mongoose.Types.ObjectId;
    examTitle?: string | null;
    allocation?: string | mongoose.Types.ObjectId;
    answerScript?: string | mongoose.Types.ObjectId;
    scriptReference?: string | null;
    anonymousId?: string | null;
    question?: number | null;
    recipient?: string | mongoose.Types.ObjectId;
}

export interface ReassignmentTemplatePayload {
    exam?: string | mongoose.Types.ObjectId;
    examTitle?: string | null;
    allocation?: string | mongoose.Types.ObjectId;
    answerScript?: string | mongoose.Types.ObjectId;
    question?: number | null;
    previousTaId?: string | mongoose.Types.ObjectId | null;
    newTaId?: string | mongoose.Types.ObjectId | null;
    newTaName?: string | null;
    recipient?: string | mongoose.Types.ObjectId;
}

export interface PublishTemplatePayload {
    exam?: string | mongoose.Types.ObjectId;
    examTitle?: string | null;
    courseCode?: string | null;
    recipient?: string | mongoose.Types.ObjectId;
    publishedAt?: Date | string | null;
}

export interface FlagTemplatePayload {
    exam?: string | mongoose.Types.ObjectId;
    examTitle?: string | null;
    answerScript?: string | mongoose.Types.ObjectId;
    question?: number | null;
    reason?: string | null;
    raisedByName?: string | null;
    recipient?: string | mongoose.Types.ObjectId;
}

export interface ReopenTemplatePayload {
    exam?: string | mongoose.Types.ObjectId;
    examTitle?: string | null;
    allocation?: string | mongoose.Types.ObjectId;
    answerScript?: string | mongoose.Types.ObjectId;
    question?: number | null;
    reason?: string | null;
    reopenedByName?: string | null;
    recipient?: string | mongoose.Types.ObjectId;
}

export type NotificationPayloadMap = {
    [NotificationType.ASSIGNMENT]: AssignmentTemplatePayload;
    [NotificationType.REASSIGNMENT]: ReassignmentTemplatePayload;
    [NotificationType.PUBLISH]: PublishTemplatePayload;
    [NotificationType.FLAG]: FlagTemplatePayload;
};

/**
 * Validates and extracts a valid positive integer question number if available.
 */
function extractValidQuestion(question: unknown): number | null {
    if (question === null || question === undefined) {
        return null;
    }
    const num = Number(question);
    if (typeof num === 'number' && !isNaN(num) && isFinite(num) && num > 0) {
        return Math.floor(num);
    }
    return null;
}

/**
 * Renders the notification title and message for newly assigned scripts.
 */
export function renderAssignmentTemplate(payload?: AssignmentTemplatePayload | null): RenderedNotification {
    const q = extractValidQuestion(payload?.question);

    return {
        type: NotificationType.ASSIGNMENT,
        title: 'New Script Assigned',
        message: q !== null
            ? `You have been assigned question ${q} of an answer script for grading.`
            : 'You have been assigned a new answer script for grading.'
    };
}

/**
 * Renders the notification title and message for reassigned scripts.
 * 
 * Note: The returned notification type remains NotificationType.ASSIGNMENT to preserve
 * compatibility with the existing assignment notification flow/type while AE-119 / related
 * cleanup can later distinguish the semantic reassignment type.
 */
export function renderReassignmentTemplate(payload?: ReassignmentTemplatePayload | null): RenderedNotification {
    const q = extractValidQuestion(payload?.question);

    return {
        type: NotificationType.ASSIGNMENT,
        title: 'Script Reassigned to You',
        message: q !== null
            ? `Question ${q} of an answer script has been reassigned to you for grading.`
            : 'An answer script has been reassigned to you for grading.'
    };
}

/**
 * Renders the notification title and message for published exam grades.
 */
export function renderPublishTemplate(payload?: PublishTemplatePayload | null): RenderedNotification {
    const examTitle = typeof payload?.examTitle === 'string' && payload.examTitle.trim().length > 0
        ? payload.examTitle.trim()
        : null;

    return {
        type: NotificationType.PUBLISH,
        title: 'Grades Published',
        message: examTitle
            ? `Grades have been published for ${examTitle}.`
            : 'Grades have been published for your exam.'
    };
}

/**
 * Renders the notification title and message for reopened allocations (AE-167).
 */
export function renderReopenTemplate(payload?: ReopenTemplatePayload | null): RenderedNotification {
    const q = extractValidQuestion(payload?.question);
    const reasonText = payload?.reason ? ` Reason: ${payload.reason}` : '';

    return {
        type: NotificationType.ASSIGNMENT,
        title: 'Allocation Reopened for Grading',
        message: q !== null
            ? `Your grading allocation for question ${q} has been reopened.${reasonText}`
            : `Your grading allocation for this answer script has been reopened.${reasonText}`
    };
}

/**
 * Renders the notification title and message for flagged scripts/questions.
 */
export function renderFlagTemplate(payload?: FlagTemplatePayload | null): RenderedNotification {
    const q = extractValidQuestion(payload?.question);
    const reasonText = payload?.reason ? ` (${payload.reason})` : '';

    return {
        type: NotificationType.FLAG,
        title: 'Script Flagged for Review',
        message: q !== null
            ? `Question ${q} of an answer script has been flagged for review${reasonText}.`
            : `An answer script has been flagged for review${reasonText}.`
    };
}

/**
 * Registry of notification template rendering functions.
 */
export const NotificationTemplates = {
    [NotificationType.ASSIGNMENT]: renderAssignmentTemplate,
    [NotificationType.REASSIGNMENT]: renderReassignmentTemplate,
    [NotificationType.PUBLISH]: renderPublishTemplate,
    [NotificationType.FLAG]: renderFlagTemplate
} as const;

/**
 * Unified notification template dispatcher.
 */
export function renderNotificationTemplate<T extends NotificationType>(
    type: T,
    payload?: NotificationPayloadMap[T] | null
): RenderedNotification {
    switch (type) {
        case NotificationType.ASSIGNMENT:
            return renderAssignmentTemplate(payload as AssignmentTemplatePayload);
        case NotificationType.REASSIGNMENT:
            return renderReassignmentTemplate(payload as ReassignmentTemplatePayload);
        case NotificationType.PUBLISH:
            return renderPublishTemplate(payload as PublishTemplatePayload);
        case NotificationType.FLAG:
            return renderFlagTemplate(payload as FlagTemplatePayload);
        default:
            return {
                type: NotificationType.ASSIGNMENT,
                title: 'Notification',
                message: 'You have received a new notification.'
            };
    }
}
