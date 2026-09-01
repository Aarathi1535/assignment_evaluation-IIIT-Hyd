import { EventEmitter } from 'events';
import mongoose from 'mongoose';
import Allocation, { AllocationStatus } from '../models/Allocation';
import AllocationService, { ExamProgressResult, TaProgressResult } from './AllocationService';

export interface ProgressUpdateEvent {
    examId: string;
    taId: string;
    taProgress: TaProgressResult;
    examProgress: ExamProgressResult;
    timestamp: Date;
}

export type ProgressEventListener = (event: ProgressUpdateEvent) => void;

export interface LiveUpdatesUnavailableEvent {
    message: string;
}

export type LiveUpdatesUnavailableListener = (event: LiveUpdatesUnavailableEvent) => void;

export const LIVE_UPDATES_UNAVAILABLE_MESSAGE = 'Live updates unavailable — refresh to see progress.';

/**
 * ProgressEventService
 *
 * Cross-instance live progress event manager for multi-container deployments.
 *
 * Architecture:
 * 1. Utilizes MongoDB Change Streams on the 'allocations' collection as a shared,
 *    multi-container event bus. When any container marks an allocation COMPLETED,
 *    MongoDB pushes the change event to all running container instances.
 * 2. Manages a single shared Change Stream per process/container to avoid exhausting
 *    database cursor connections.
 * 3. Dispatches received progress updates to local SSE subscribers for the affected exam.
 * 4. Transparently supports local direct dispatch for fallback and test environments.
 * 5. Emits operational degraded notifications when Change Streams are unavailable so
 *    connected SSE clients are informed to refresh or poll.
 */
export class ProgressEventService {
    private static emitter = new EventEmitter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static changeStream: any = null;
    private static isChangeStreamInitializing = false;
    private static isDegraded = false;

    /**
     * Returns whether the service is currently operating in degraded fallback mode.
     */
    static isDegradedMode(): boolean {
        return this.isDegraded;
    }

    /**
     * Initializes the MongoDB Change Stream on the allocations collection.
     * Watches only for transitions where status becomes 'COMPLETED'.
     */
    static async startChangeStream(): Promise<void> {
        if (this.changeStream || this.isChangeStreamInitializing || this.isDegraded) {
            return;
        }

        this.isChangeStreamInitializing = true;

        try {
            if (mongoose.connection.readyState !== 1) {
                // Not connected yet; return and allow lazy start on next subscription
                this.isChangeStreamInitializing = false;
                return;
            }

            const pipeline: Array<Record<string, unknown>> = [
                {
                    $match: {
                        operationType: { $in: ['update', 'replace'] },
                        'updateDescription.updatedFields.status': AllocationStatus.COMPLETED
                    }
                }
            ];

            // Open a single managed change stream on the Allocation model
            this.changeStream = Allocation.watch(pipeline, {
                fullDocument: 'updateLookup'
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.changeStream.on('change', async (change: any) => {
                try {
                    const fullDoc = change.fullDocument;
                    if (!fullDoc || !fullDoc.exam) {
                        return;
                    }

                    const examId = fullDoc.exam.toString();
                    const taId = fullDoc.ta ? fullDoc.ta.toString() : '';

                    await this.dispatchProgressEvent(examId, taId);
                } catch (err) {
                    console.error('[ProgressEventService] Error processing change stream event:', err);
                }
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.changeStream.on('error', (error: any) => {
                if (process.env.NODE_ENV !== 'test') {
                    console.warn('[ProgressEventService] Change stream error (fallback active):', error?.message || error);
                }
                if (this.changeStream) {
                    try {
                        this.changeStream.close().catch(() => {});
                    } catch {
                        // ignore close error
                    }
                    this.changeStream = null;
                }
                this.isChangeStreamInitializing = false;
                this.markDegradedAndEmit();
            });

        } catch (error: unknown) {
            // Standalone MongoDB (like MongoMemoryServer in tests) does not support change streams.
            // In such environments, local dispatch handles event propagation.
            this.changeStream = null;
            if (process.env.NODE_ENV !== 'test') {
                const errMsg = error instanceof Error ? error.message : String(error);
                console.warn('[ProgressEventService] Change stream initialization failed (fallback active):', errMsg);
            }
            this.markDegradedAndEmit();
        } finally {
            this.isChangeStreamInitializing = false;
        }
    }

    private static markDegradedAndEmit(): void {
        if (!this.isDegraded) {
            this.isDegraded = true;
            const event: LiveUpdatesUnavailableEvent = {
                message: LIVE_UPDATES_UNAVAILABLE_MESSAGE
            };
            this.emitter.emit('live_updates_unavailable', event);
        }
    }

    /**
     * Closes the active change stream.
     */
    static async stopChangeStream(): Promise<void> {
        if (this.changeStream) {
            try {
                await this.changeStream.close();
            } catch {
                // Ignore close errors
            }
            this.changeStream = null;
        }
        this.isChangeStreamInitializing = false;
    }

    /**
     * Subscribes to progress events for a specific exam on this container instance.
     * Returns an unsubscribe cleanup function.
     */
    static subscribe(examId: string, listener: ProgressEventListener): () => void {
        // Ensure change stream is running
        this.startChangeStream().catch(() => {});

        const eventKey = `progress:${examId}`;
        this.emitter.on(eventKey, listener);
        return () => {
            this.emitter.off(eventKey, listener);
        };
    }

    /**
     * Subscribes to degraded / live updates unavailable notifications.
     * Returns an unsubscribe cleanup function.
     */
    static subscribeLiveUpdatesUnavailable(listener: LiveUpdatesUnavailableListener): () => void {
        this.emitter.on('live_updates_unavailable', listener);
        return () => {
            this.emitter.off('live_updates_unavailable', listener);
        };
    }

    /**
     * Subscribes to all progress events across all exams.
     * Returns an unsubscribe cleanup function.
     */
    static subscribeAll(listener: ProgressEventListener): () => void {
        this.startChangeStream().catch(() => {});

        this.emitter.on('progress', listener);
        return () => {
            this.emitter.off('progress', listener);
        };
    }

    /**
     * Dispatches an aggregated progress event to local listeners.
     * Reuses AllocationService.getProgress(examId) as the single source of truth.
     */
    static async dispatchProgressEvent(examId: string, taId: string): Promise<ProgressUpdateEvent> {
        const examProgress = await AllocationService.getProgress(examId);

        const taProgress: TaProgressResult = examProgress.progress.find((p) => p.taId === taId) || {
            taId,
            name: 'Unknown TA',
            graded: 0,
            total: 0,
            completionRatio: 0,
            isBottleneck: false,
            bottleneck: false
        };

        const event: ProgressUpdateEvent = {
            examId,
            taId,
            taProgress,
            examProgress,
            timestamp: new Date()
        };

        this.emitter.emit(`progress:${examId}`, event);
        this.emitter.emit('progress', event);

        return event;
    }

    /**
     * Direct notification hook called by AllocationService.markCompleted() for immediate in-process dispatch.
     * Works alongside the Change Stream for sub-millisecond local response and standalone test compatibility.
     */
    static async emitAllocationCompleted(examId: string, taId: string): Promise<ProgressUpdateEvent> {
        return this.dispatchProgressEvent(examId, taId);
    }

    /**
     * Clears local listeners and resets change stream (for testing teardown).
     */
    static clearListeners(examId?: string): void {
        if (examId) {
            this.emitter.removeAllListeners(`progress:${examId}`);
        } else {
            this.emitter.removeAllListeners();
            this.isDegraded = false;
        }
    }
}

export default ProgressEventService;
