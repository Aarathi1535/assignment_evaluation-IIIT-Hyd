import ingestionWorker from '../services/IngestionWorker';

declare global {
    var isIngestionWorkerInitialized: boolean | undefined;
}

/**
 * Initializes the background ingestion worker once during application startup.
 * Disabled in test environments to allow deterministic test orchestration.
 */
export function initBackgroundWorker(): void {
    if (process.env.NODE_ENV === 'test') {
        return;
    }

    if (!global.isIngestionWorkerInitialized) {
        global.isIngestionWorkerInitialized = true;
        ingestionWorker.start();
    }
}
