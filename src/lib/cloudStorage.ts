import { Storage } from '@google-cloud/storage';

export class CloudStorageConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CloudStorageConfigurationError';
    }
}

let storageClient: Storage | null = null;

export function getConfiguredStorageBucket() {
    const bucketName = process.env.DERIVED_PAGE_STORAGE_BUCKET?.trim();
    if (!bucketName) {
        if (process.env.K_SERVICE) {
            throw new CloudStorageConfigurationError(
                'DERIVED_PAGE_STORAGE_BUCKET must be set on Cloud Run for shared original and derived page storage.'
            );
        }
        return null;
    }

    storageClient ??= new Storage();
    return storageClient.bucket(bucketName);
}
