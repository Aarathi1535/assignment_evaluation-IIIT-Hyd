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
    scriptReference?: string | null;
    anonymousId?: string | null;
    question?: number | null;
    previousTaId?: string | mongoose.Types.ObjectId | null;
    previousTaName?: string | null;
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

export type NotificationPayloadMap = {
    [NotificationType.ASSIGNMENT]: AssignmentTemplatePayload;
    [NotificationType.REASSIGNMENT]: ReassignmentTemplatePayload;
    [NotificationType.PUBLISH]: PublishTemplatePayload;
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
 * Registry of notification template rendering functions.
 */
export const NotificationTemplates = {
    [NotificationType.ASSIGNMENT]: renderAssignmentTemplate,
    [NotificationType.REASSIGNMENT]: renderReassignmentTemplate,
    [NotificationType.PUBLISH]: renderPublishTemplate
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
        default:
            return {
                type: NotificationType.ASSIGNMENT,
                title: 'Notification',
                message: 'You have received a new notification.'
            };
    }
}
