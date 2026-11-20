import { Storage } from '@google-cloud/storage';
import { validateEnv } from '../config/env';

export interface UploadFileOptions {
    bucketName: string;
    destination: string;
    buffer: Buffer;
    contentType?: string;
}

export class CloudStorageService {
    private storage: Storage | null = null;
    private static instance: CloudStorageService;

    private constructor() {
        // Lazy initialization: avoid eagerly validating env variables on module import
    }

    public static getInstance(): CloudStorageService {
        if (!CloudStorageService.instance) {
            CloudStorageService.instance = new CloudStorageService();
        }
        return CloudStorageService.instance;
    }

    private getStorageClient(): Storage {
        if (!this.storage) {
            const env = validateEnv();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const options: any = {};
            if (env.GOOGLE_CLOUD_PROJECT) {
                options.projectId = env.GOOGLE_CLOUD_PROJECT;
            }

            if (env.GOOGLE_APPLICATION_CREDENTIALS) {
                options.keyFilename = env.GOOGLE_APPLICATION_CREDENTIALS;
            }

            this.storage = new Storage(options);
        }
        return this.storage;
    }

    /**
     * Uploads a buffer to a specific Google Cloud Storage bucket.
     */
    public async uploadFile({ bucketName, destination, buffer, contentType }: UploadFileOptions): Promise<string> {
        const client = this.getStorageClient();
        const bucket = client.bucket(bucketName);
        const file = bucket.file(destination);

        await file.save(buffer, {
            contentType,
            resumable: false,
        });

        // We return the gs:// URI which can be stored in the DB
        return `gs://${bucketName}/${destination}`;
    }

    /**
     * Downloads a file from a Google Cloud Storage bucket as a Buffer.
     */
    public async downloadFile(bucketName: string, destination: string): Promise<Buffer> {
        const client = this.getStorageClient();
        const bucket = client.bucket(bucketName);
        const file = bucket.file(destination);

        const [buffer] = await file.download();
        return buffer;
    }
}

export const cloudStorageService = CloudStorageService.getInstance();
