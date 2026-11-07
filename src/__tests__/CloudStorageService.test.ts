import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudStorageService } from '../services/CloudStorageService';
import * as envModule from '../config/env';

describe('CloudStorageService Lazy Initialization', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = process.env;
        process.env = { ...originalEnv };
        delete process.env.GOOGLE_CLOUD_PROJECT;
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        
        // Ensure singleton instance is reset between tests
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (CloudStorageService as any).instance = undefined;
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it('does not validate GCS configuration on import or construction', () => {
        const validateSpy = vi.spyOn(envModule, 'validateEnv');

        // Should not throw or call validateEnv
        const service = CloudStorageService.getInstance();
        
        expect(service).toBeDefined();
        expect(validateSpy).not.toHaveBeenCalled();
    });

    it('validates/requires production configuration only when a storage operation is invoked', async () => {
        const validateSpy = vi.spyOn(envModule, 'validateEnv').mockImplementation(() => {
            throw new Error('Invalid environment variables');
        });

        const service = CloudStorageService.getInstance();
        
        // Calling uploadFile should trigger validation and throw
        await expect(
            service.uploadFile({
                bucketName: 'test-bucket',
                destination: 'test.pdf',
                buffer: Buffer.from('test')
            })
        ).rejects.toThrow('Invalid environment variables');

        expect(validateSpy).toHaveBeenCalled();
    });
});
