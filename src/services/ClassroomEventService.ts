import { EventEmitter } from 'events';

export type ClassroomEventType = 
    | 'QUESTION_ACTIVATED'
    | 'QUESTION_CLOSED'
    | 'QUESTION_REVEALED'
    | 'RESPONSE_SUBMITTED'
    | 'QUESTION_DEACTIVATED';

export interface ClassroomRealtimeEvent {
    type: ClassroomEventType;
    questionId: string;
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
    static dispatch(type: ClassroomEventType, questionId: string, payload?: Record<string, unknown>): void {
        const event: ClassroomRealtimeEvent = {
            type,
            questionId,
            payload,
            timestamp: new Date()
        };
        this.emitter.emit(this.EVENT_NAME, event);
    }

    /**
     * Helper for question activation.
     */
    static notifyQuestionActivated(questionId: string, questionData?: Record<string, unknown>): void {
        this.dispatch('QUESTION_ACTIVATED', questionId, questionData);
    }

    /**
     * Helper for response submitted.
     */
    static notifyResponseSubmitted(questionId: string, stats: Record<string, unknown>): void {
        this.dispatch('RESPONSE_SUBMITTED', questionId, stats);
    }

    /**
     * Helper for question closed.
     */
    static notifyQuestionClosed(questionId: string, stats?: Record<string, unknown>): void {
        this.dispatch('QUESTION_CLOSED', questionId, stats);
    }

    /**
     * Helper for question revealed.
     */
    static notifyQuestionRevealed(questionId: string, results: Record<string, unknown>): void {
        this.dispatch('QUESTION_REVEALED', questionId, results);
    }

    /**
     * Helper for question deactivated.
     */
    static notifyQuestionDeactivated(questionId: string): void {
        this.dispatch('QUESTION_DEACTIVATED', questionId);
    }

    /**
     * Reset listeners (for tests).
     */
    static reset(): void {
        this.emitter.removeAllListeners();
    }
}

export default ClassroomEventService;
