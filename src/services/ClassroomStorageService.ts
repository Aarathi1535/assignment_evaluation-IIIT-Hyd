import fs from 'fs';
import path from 'path';
import { Storage, Bucket } from '@google-cloud/storage';

export interface StoreClassroomImageInput {
    sessionId: string;
    activityId: string;
    filename: string;
    buffer: Buffer;
    mimeType: string;
}

export interface StoredClassroomImageResult {
    storagePath: string; // e.g. "classroom-uploads/<sessionId>/<activityId>/<safeName>"
    size: number;
}

export class ClassroomStorageService {
    private storageClient: Storage | null = null;

    /**
     * Retrieves the configured Google Cloud Storage bucket if set in environment.
     * Uses CLASSROOM_STORAGE_BUCKET or fallback DERIVED_PAGE_STORAGE_BUCKET.
     */
    private getStorageBucket(): Bucket | null {
        const bucketName = process.env.CLASSROOM_STORAGE_BUCKET?.trim() || process.env.DERIVED_PAGE_STORAGE_BUCKET?.trim();
        if (!bucketName) {
            return null;
        }

        try {
            this.storageClient ??= new Storage();
            return this.storageClient.bucket(bucketName);
        } catch {
            return null;
        }
    }

    /**
     * Resolves the local persistent disk root.
     * Guaranteed to be outside public/ to prevent unauthenticated static serving.
     */
    getLocalRoot(): string {
        return process.env.CLASSROOM_STORAGE_PATH?.trim() || path.join(process.cwd(), 'data');
    }

    /**
     * Securely stores an uploaded classroom answer image.
     * Writes to GCS if configured for cloud deployment, or to local persistent disk.
     */
    async storeImage(input: StoreClassroomImageInput): Promise<StoredClassroomImageResult> {
        const { sessionId, activityId, filename, buffer, mimeType } = input;

        // Clean components to guarantee safe path
        const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
        const safeActivity = activityId.replace(/[^a-zA-Z0-9_-]/g, '');
        const safeFile = filename.replace(/[^a-zA-Z0-9._-]/g, '');

        const storagePath = `classroom-uploads/${safeSession}/${safeActivity}/${safeFile}`;
        const bucket = this.getStorageBucket();

        if (bucket) {
            const file = bucket.file(storagePath);
            await file.save(buffer, {
                contentType: mimeType,
                metadata: {
                    cacheControl: 'private, max-age=3600',
                    sessionId: safeSession,
                    activityId: safeActivity
                },
                resumable: false
            });
            return {
                storagePath,
                size: buffer.length
            };
        }

        // Persistent disk storage
        const localRoot = this.getLocalRoot();
        const absoluteDir = path.join(localRoot, 'classroom-uploads', safeSession, safeActivity);
        await fs.promises.mkdir(absoluteDir, { recursive: true });

        const absoluteFilePath = path.join(absoluteDir, safeFile);
        await fs.promises.writeFile(absoluteFilePath, buffer);

        return {
            storagePath,
            size: buffer.length
        };
    }

    /**
     * Reads an image buffer and MIME type from storage.
     */
    async readImage(storagePath: string): Promise<{ buffer: Buffer; contentType: string }> {
        // Enforce path safety with normalized POSIX forward slashes
        const cleanPath = (storagePath || '').replace(/\\/g, '/').replace(/^(\.\.(\/|\\|$))+/, '');
        if (cleanPath.includes('..') || !cleanPath.startsWith('classroom-uploads/')) {
            throw new Error('Invalid or forbidden storage path');
        }

        const bucket = this.getStorageBucket();
        if (bucket) {
            try {
                const file = bucket.file(cleanPath);
                const [exists] = await file.exists();
                if (exists) {
                    const [content] = await file.download();
                    const ext = path.extname(cleanPath).toLowerCase();
                    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.heic' ? 'image/heic' : 'image/jpeg';
                    return { buffer: content, contentType };
                }
            } catch {
                // Fall back to local check if GCS download fails
            }
        }

        // Local persistent disk fallback: check both configured root and data/ fallback
        const parts = cleanPath.split('/').filter(p => p && p !== '..');
        const candidatePaths = [
            path.join(this.getLocalRoot(), ...parts),
            path.join(process.cwd(), 'data', ...parts)
        ];

        let targetPath: string | null = null;
        for (const candidate of candidatePaths) {
            if (fs.existsSync(candidate)) {
                targetPath = candidate;
                break;
            }
        }

        if (!targetPath) {
            throw new Error('Image file not found in storage');
        }

        const buffer = await fs.promises.readFile(targetPath);
        const ext = path.extname(targetPath).toLowerCase();
        const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.heic' ? 'image/heic' : 'image/jpeg';

        return { buffer, contentType };
    }

    /**
     * Checks if an image exists in storage.
     */
    async imageExists(storagePath: string): Promise<boolean> {
        const cleanPath = (storagePath || '').replace(/\\/g, '/').replace(/^(\.\.(\/|\\|$))+/, '');
        if (cleanPath.includes('..') || !cleanPath.startsWith('classroom-uploads/')) {
            return false;
        }

        const bucket = this.getStorageBucket();
        if (bucket) {
            try {
                const file = bucket.file(cleanPath);
                const [exists] = await file.exists();
                if (exists) return true;
            } catch {
                // Fall through to disk check
            }
        }

        const parts = cleanPath.split('/').filter(p => p && p !== '..');
        return fs.existsSync(path.join(this.getLocalRoot(), ...parts)) ||
               fs.existsSync(path.join(process.cwd(), 'data', ...parts));
    }
}

const classroomStorageService = new ClassroomStorageService();
export default classroomStorageService;

