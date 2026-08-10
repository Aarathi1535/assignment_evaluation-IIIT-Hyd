import ingestionWorker from '../services/IngestionWorker';

let isWorkerInitialized = false;

/**
 * Initializes the background ingestion worker once during application startup.
 * Disabled in test environments to allow deterministic test orchestration.
 */
export function initBackgroundWorker(): void {
    if (process.env.NODE_ENV === 'test') {
        return;
    }

    if (!isWorkerInitialized) {
        isWorkerInitialized = true;
        ingestionWorker.start();
    }
}
