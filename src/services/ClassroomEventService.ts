import { EventEmitter } from 'events';

export type ClassroomEventType = 
    | 'QUESTION_ACTIVATED'
    | 'QUESTION_CLOSED'
    | 'QUESTION_REVEALED'
    | 'RESPONSE_SUBMITTED'
    | 'QUESTION_DEACTIVATED'
    | 'SESSION_JOINED'
    | 'SUBMISSION_RECEIVED'
    | 'SUBMISSION_REVIEWED'
    | 'ACTIVITY_CLOSED'
    | 'TIMER_EXTENDED'
    | 'ACTIVITY_PUBLISHED';

export interface ClassroomRealtimeEvent {
    type: ClassroomEventType;
    questionId: string;
    sessionId?: string;
    payload?: Record<string, unknown>;
    timestamp: Date;
}

export type ClassroomEventListener = (event: ClassroomRealtimeEvent) => void;

/**
 * ClassroomEventService
 * 
 * In-memory real-time event bus for interactive classroom sessions.
 * Manages active question transitions and live student response updates.
 */
export class ClassroomEventService {
    private static emitter: EventEmitter = (() => {
        const em = new EventEmitter();
        em.setMaxListeners(200);
        return em;
    })();

    private static EVENT_NAME = 'classroom_live_event';

    /**
     * Subscribe to live classroom events.
     * Returns an unsubscribe function.
     */
    static subscribe(listener: ClassroomEventListener): () => void {
        this.emitter.on(this.EVENT_NAME, listener);
        return () => {
            this.emitter.off(this.EVENT_NAME, listener);
        };
    }

    /**
     * Dispatches a classroom event to all active listeners.
     */
    static dispatch(
        type: ClassroomEventType,
        questionId: string,
        payload?: Record<string, unknown>,
        sessionId?: string
    ): void {
        const event: ClassroomRealtimeEvent = {
            type,
            questionId,
            sessionId,
            payload,
            timestamp: new Date()
        };
        this.emitter.emit(this.EVENT_NAME, event);
    }

    /**
     * Helper for question activation.
     */
    static notifyQuestionActivated(questionId: string, questionData?: Record<string, unknown>, sessionId?: string): void {
        this.dispatch('QUESTION_ACTIVATED', questionId, questionData, sessionId);
    }

    /**
     * Helper for response submitted.
     */
    static notifyResponseSubmitted(questionId: string, stats: Record<string, unknown>, sessionId?: string): void {
        this.dispatch('RESPONSE_SUBMITTED', questionId, stats, sessionId);
    }

    /**
     * Helper for question closed.
     */
    static notifyQuestionClosed(questionId: string, stats?: Record<string, unknown>, sessionId?: string): void {
        this.dispatch('QUESTION_CLOSED', questionId, stats, sessionId);
    }

    /**
     * Helper for question revealed.
     */
    static notifyQuestionRevealed(questionId: string, results: Record<string, unknown>, sessionId?: string): void {
        this.dispatch('QUESTION_REVEALED', questionId, results, sessionId);
    }

    /**
     * Helper for question deactivated.
     */
    static notifyQuestionDeactivated(questionId: string, sessionId?: string): void {
        this.dispatch('QUESTION_DEACTIVATED', questionId, undefined, sessionId);
    }

    /**
     * Helper for new participant joined session.
     */
    static notifyParticipantJoined(sessionId: string, participantData: Record<string, unknown>): void {
        this.dispatch('SESSION_JOINED', '', participantData, sessionId);
    }

    /**
     * Helper for submission received (live thumbnail and counters).
     */
    static notifySubmissionReceived(sessionId: string, questionId: string, submissionData: Record<string, unknown>): void {
        this.dispatch('SUBMISSION_RECEIVED', questionId, submissionData, sessionId);
    }

    /**
     * Helper for submission reviewed (marked correct/incorrect).
     */
    static notifySubmissionReviewed(sessionId: string, questionId: string, reviewData: Record<string, unknown>): void {
        this.dispatch('SUBMISSION_REVIEWED', questionId, reviewData, sessionId);
    }

    /**
     * Helper for timer extended.
     */
    static notifyTimerExtended(sessionId: string, questionId: string, timerData: Record<string, unknown>): void {
        this.dispatch('TIMER_EXTENDED', questionId, timerData, sessionId);
    }

    /**
     * Helper for activity published.
     */
    static notifyActivityPublished(sessionId: string, questionId: string, resultsData: Record<string, unknown>): void {
        this.dispatch('ACTIVITY_PUBLISHED', questionId, resultsData, sessionId);
    }

    /**
     * Reset listeners (for tests).
     */
    static reset(): void {
        this.emitter.removeAllListeners();
    }
}

export default ClassroomEventService;
