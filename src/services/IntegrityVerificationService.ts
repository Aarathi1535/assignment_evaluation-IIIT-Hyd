import mongoose from 'mongoose';
import Batch from '../models/Batch';
import IngestionPage from '../models/IngestionPage';
import AnswerScript from '../models/AnswerScript';
import Exam from '../models/Exam';
import ExamRepository from '../repositories/ExamRepository';
import immutableStorageService from './ImmutableStorageService';
import derivedStorageService from './DerivedStorageService';
import IngestionApprovalService, { IngestionApprovalAuditContext } from './IngestionApprovalService';
import { getHmacSecret } from '../utils/hmacStorage';
import { HttpError } from '../lib/errors';
import { SYSTEM_PRINCIPAL_ID, SYSTEM_ROLE } from '../constants/permissions';

export type IntegrityStatus = 'INTACT' | 'MISMATCH' | 'UNSEALED' | 'ERROR';
export type AssemblyStatus = 'INTACT' | 'MISMATCH' | 'UNAPPROVED' | 'UNSEALED' | 'ERROR';

export interface OriginalFileVerificationItem {
    batchId: string;
    fileId: string;
    fileIndex: number;
    originalFilename: string;
    status: IntegrityStatus;
    reason?: string;
}

export interface DerivedPageVerificationItem {
    pageId: string;
    batchId: string;
    fileId: string;
    pageNumber: number;
    status: 'INTACT' | 'MISMATCH' | 'ERROR';
    reason?: string;
}

export interface AssemblyVerificationResult {
    valid: boolean;
    status: AssemblyStatus;
    reason?: string;
    timestamp?: string;
}

export interface IntegrityVerificationSummary {
    valid: boolean;
    status: 'INTACT' | 'MISMATCH' | 'ERROR';
    outcome: 'INTACT' | 'MISMATCH' | 'ERROR';
    reason?: string;
    examId: string;
    timestamp: string;
    originalFiles: {
        total: number;
        intact: number;
        mismatch: number;
        unsealed: number;
        error: number;
        items: OriginalFileVerificationItem[];
    };
    derivedPages: {
        total: number;
        intact: number;
        mismatch: number;
        error: number;
        items: DerivedPageVerificationItem[];
    };
    assembly: AssemblyVerificationResult;
    problemRecords: {
        files: Array<{ batchId: string; fileId: string; status: string; reason?: string }>;
        pages: Array<{ pageId: string; batchId: string; fileId: string; pageNumber: number; status: string; reason?: string }>;
    };
}

export class IntegrityVerificationService {
    /**
     * Read-only validation of storage key shape and namespace before any storage access.
     */
    private validateDerivedKeyShape(page: {
        batchId: string;
        fileId: string;
        pageNumber: number;
        storageKey?: string;
    }): { valid: boolean; reason?: string; format?: string } {
        const storageKey = page.storageKey;
        if (!storageKey || typeof storageKey !== 'string' || storageKey.trim() === '') {
            return { valid: false, reason: 'Derived page storage key is missing or empty' };
        }

        const trimmedKey = storageKey.trim();

        // Reject directory traversal or malformed path separators
        if (trimmedKey.includes('..') || trimmedKey.includes('\\')) {
            return { valid: false, reason: 'Derived storage key contains path traversal or invalid characters' };
        }

        // Flag keys pointing to an original upload or wrong namespace
        const originalFilePattern = /^batches\/[^/]+\/[^/]+\.[a-zA-Z0-9]+$/;
        if (trimmedKey.startsWith('originals/') || originalFilePattern.test(trimmedKey)) {
            return { valid: false, reason: 'Derived storage key points to an original upload instead of derived namespace' };
        }

        const expectedNamespacePrefix = `batches/${page.batchId}/derived/`;
        if (!trimmedKey.startsWith(expectedNamespacePrefix)) {
            return { valid: false, reason: `Derived storage key does not reside under expected namespace "${expectedNamespacePrefix}"` };
        }

        // Expected pattern: batches/{batchId}/derived/{fileId}/{pageNumber}/page.{format}
        const match = trimmedKey.match(/^batches\/([^/]+)\/derived\/([^/]+)\/(\d+)\/page\.([a-zA-Z0-9]+)$/);
        if (!match) {
            return { valid: false, reason: 'Derived storage key does not match pattern batches/{batchId}/derived/{fileId}/{pageNumber}/page.{format}' };
        }

        const [, keyBatchId, keyFileId, keyPageNumStr, format] = match;
        const keyPageNumber = parseInt(keyPageNumStr, 10);

        if (keyBatchId !== page.batchId) {
            return { valid: false, reason: `Storage key batchId "${keyBatchId}" does not match page batchId "${page.batchId}"` };
        }

        if (keyFileId !== page.fileId) {
            return { valid: false, reason: `Storage key fileId "${keyFileId}" does not match page fileId "${page.fileId}"` };
        }

        if (keyPageNumber !== page.pageNumber) {
            return { valid: false, reason: `Storage key pageNumber ${keyPageNumber} does not match page pageNumber ${page.pageNumber}` };
        }

        const reconstructedKey = derivedStorageService.getDerivedPageKey(page.batchId, page.fileId, page.pageNumber, format);
        if (trimmedKey !== reconstructedKey) {
            return { valid: false, reason: 'Storage key does not match deterministic reconstructed key' };
        }

        return { valid: true, format };
    }

    /**
     * Performs a read-only integrity verification across an exam's originals, derived pages, and assembly.
     * Never mutates, repairs, or reseals objects or records.
     */
    async verifyExamIntegrity(
        examId: string,
        context?: IngestionApprovalAuditContext
    ): Promise<IntegrityVerificationSummary> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }

        // Verify exam exists and user has access
        const exam = context?.actingUserId && context?.actingUserRole
            ? await ExamRepository.getExamById(examId, context.actingUserId, context.actingUserRole)
            : await Exam.findOne({ _id: examId, isActive: true });

        if (!exam) {
            throw new HttpError('Exam not found or access denied', 404);
        }

        const examObjectId = new mongoose.Types.ObjectId(examId);

        // 1. Resolve all Batches associated with this Exam
        const directBatches = await Batch.find({ exam: examObjectId, isActive: true }).lean();

        const answerScripts = await AnswerScript.find({ exam: examObjectId, isActive: true }).select('_id').lean();
        const scriptIds = answerScripts.map((s) => s._id);

        const pagesFromScripts = scriptIds.length > 0
            ? await IngestionPage.find({ answerScript: { $in: scriptIds } }).select('batchId').lean()
            : [];
        const extraBatchIds = pagesFromScripts.map((p) => p.batchId).filter(Boolean);

        const allBatchIds = Array.from(new Set([
            ...directBatches.map((b) => b.batchId),
            ...extraBatchIds
        ]));

        const batches = await Batch.find({ batchId: { $in: allBatchIds }, isActive: true }).lean();

        // 2. Verify Original Uploaded Files
        const originalFileItems: OriginalFileVerificationItem[] = [];

        for (const batch of batches) {
            const files = batch.files || [];
            for (const file of files) {
                // Check if file lacks seal metadata
                if (!file.hmac || !file.integrityMetadata) {
                    originalFileItems.push({
                        batchId: batch.batchId,
                        fileId: file.fileId,
                        fileIndex: file.fileIndex,
                        originalFilename: file.originalFilename,
                        status: 'UNSEALED',
                        reason: 'Original file lacks required HMAC seal or binding metadata'
                    });
                    continue;
                }

                // Verify historical key configuration is available without falling back
                try {
                    getHmacSecret(file.keyId);
                } catch (keyErr) {
                    originalFileItems.push({
                        batchId: batch.batchId,
                        fileId: file.fileId,
                        fileIndex: file.fileIndex,
                        originalFilename: file.originalFilename,
                        status: 'ERROR',
                        reason: keyErr instanceof Error ? keyErr.message : 'HMAC key configuration unavailable'
                    });
                    continue;
                }

                // Read original content from immutable storage
                let contentBuffer: Buffer;
                try {
                    contentBuffer = await immutableStorageService.readOriginalContent(file.storageKey);
                } catch (readErr) {
                    originalFileItems.push({
                        batchId: batch.batchId,
                        fileId: file.fileId,
                        fileIndex: file.fileIndex,
                        originalFilename: file.originalFilename,
                        status: 'ERROR',
                        reason: readErr instanceof Error ? readErr.message : 'Failed to read original content from storage'
                    });
                    continue;
                }

                // Verify HMAC seal against content and recorded metadata
                const verification = immutableStorageService.verifyOriginalIntegrity(contentBuffer, file);
                if (verification.valid) {
                    originalFileItems.push({
                        batchId: batch.batchId,
                        fileId: file.fileId,
                        fileIndex: file.fileIndex,
                        originalFilename: file.originalFilename,
                        status: 'INTACT'
                    });
                } else {
                    const reason = verification.reason || 'Content or binding metadata failed integrity verification';
                    const isKeyError = reason.includes('unavailable') || reason.includes('not configured');
                    originalFileItems.push({
                        batchId: batch.batchId,
                        fileId: file.fileId,
                        fileIndex: file.fileIndex,
                        originalFilename: file.originalFilename,
                        status: isKeyError ? 'ERROR' : 'MISMATCH',
                        reason
                    });
                }
            }
        }

        // 3. Verify Derived Pages
        const pageQuery = allBatchIds.length > 0 || scriptIds.length > 0
            ? {
                $or: [
                    ...(allBatchIds.length > 0 ? [{ batchId: { $in: allBatchIds } }] : []),
                    ...(scriptIds.length > 0 ? [{ answerScript: { $in: scriptIds } }] : [])
                ]
            }
            : { batchId: '__NO_MATCH__' };

        const pages = await IngestionPage.find(pageQuery).lean();
        const derivedPageItems: DerivedPageVerificationItem[] = [];

        for (const page of pages) {
            const pageIdStr = page._id.toString();

            // Validate key structure, namespace, and deterministic format before storage access
            const keyValidation = this.validateDerivedKeyShape(page);
            if (!keyValidation.valid) {
                derivedPageItems.push({
                    pageId: pageIdStr,
                    batchId: page.batchId,
                    fileId: page.fileId,
                    pageNumber: page.pageNumber,
                    status: 'MISMATCH',
                    reason: keyValidation.reason
                });
                continue;
            }

            // Key is validated: verify existence in derived storage backend
            try {
                const exists = await derivedStorageService.derivedPageExists(page.storageKey);
                if (!exists) {
                    derivedPageItems.push({
                        pageId: pageIdStr,
                        batchId: page.batchId,
                        fileId: page.fileId,
                        pageNumber: page.pageNumber,
                        status: 'ERROR',
                        reason: 'Derived page image not found on storage backend'
                    });
                } else {
                    derivedPageItems.push({
                        pageId: pageIdStr,
                        batchId: page.batchId,
                        fileId: page.fileId,
                        pageNumber: page.pageNumber,
                        status: 'INTACT'
                    });
                }
            } catch (storageErr) {
                derivedPageItems.push({
                    pageId: pageIdStr,
                    batchId: page.batchId,
                    fileId: page.fileId,
                    pageNumber: page.pageNumber,
                    status: 'ERROR',
                    reason: storageErr instanceof Error ? storageErr.message : 'Storage access error'
                });
            }
        }

        // 4. Verify Exam Assembly (delegate to IngestionApprovalService)
        const auditContext: IngestionApprovalAuditContext = {
            actingUserId: context?.actingUserId || SYSTEM_PRINCIPAL_ID,
            actingUserRole: context?.actingUserRole || SYSTEM_ROLE,
            ipAddress: context?.ipAddress
        };

        const assemblyResult = await IngestionApprovalService.verifyAssembly(examId, auditContext);

        // 5. Aggregate Counts
        const originalCounts = {
            total: originalFileItems.length,
            intact: originalFileItems.filter((f) => f.status === 'INTACT').length,
            mismatch: originalFileItems.filter((f) => f.status === 'MISMATCH').length,
            unsealed: originalFileItems.filter((f) => f.status === 'UNSEALED').length,
            error: originalFileItems.filter((f) => f.status === 'ERROR').length,
            items: originalFileItems
        };

        const derivedCounts = {
            total: derivedPageItems.length,
            intact: derivedPageItems.filter((p) => p.status === 'INTACT').length,
            mismatch: derivedPageItems.filter((p) => p.status === 'MISMATCH').length,
            error: derivedPageItems.filter((p) => p.status === 'ERROR').length,
            items: derivedPageItems
        };

        // 6. Determine Problem Records (safe identifiers only)
        const problemFiles = originalFileItems
            .filter((f) => f.status !== 'INTACT')
            .map((f) => ({ batchId: f.batchId, fileId: f.fileId, status: f.status, reason: f.reason }));

        const problemPages = derivedPageItems
            .filter((p) => p.status !== 'INTACT')
            .map((p) => ({
                pageId: p.pageId,
                batchId: p.batchId,
                fileId: p.fileId,
                pageNumber: p.pageNumber,
                status: p.status,
                reason: p.reason
            }));

        // 7. Determine Overall Outcome
        const hasFileMismatch = originalCounts.mismatch > 0 || originalCounts.unsealed > 0;
        const hasPageMismatch = derivedCounts.mismatch > 0;
        const hasAssemblyMismatch = assemblyResult.status === 'MISMATCH' || assemblyResult.status === 'UNSEALED' || assemblyResult.status === 'UNAPPROVED';

        const hasFileError = originalCounts.error > 0;
        const hasPageError = derivedCounts.error > 0;
        const hasAssemblyError = assemblyResult.status === 'ERROR';

        let overallStatus: 'INTACT' | 'MISMATCH' | 'ERROR' = 'INTACT';
        let overallValid = true;
        let overallReason: string | undefined;

        if (hasFileMismatch || hasPageMismatch || hasAssemblyMismatch) {
            overallStatus = 'MISMATCH';
            overallValid = false;
            overallReason = 'Integrity verification detected one or more mismatches or unsealed records';
        } else if (hasFileError || hasPageError || hasAssemblyError) {
            overallStatus = 'ERROR';
            overallValid = false;
            overallReason = 'Integrity verification encountered errors preventing complete verification';
        } else if (!assemblyResult.valid) {
            overallStatus = 'MISMATCH';
            overallValid = false;
            overallReason = assemblyResult.reason || 'Assembly verification failed';
        }

        return {
            valid: overallValid,
            status: overallStatus,
            outcome: overallStatus,
            reason: overallReason,
            examId,
            timestamp: new Date().toISOString(),
            originalFiles: originalCounts,
            derivedPages: derivedCounts,
            assembly: {
                valid: assemblyResult.valid,
                status: assemblyResult.status,
                reason: assemblyResult.reason,
                timestamp: assemblyResult.timestamp
            },
            problemRecords: {
                files: problemFiles,
                pages: problemPages
            }
        };
    }
}

const integrityVerificationService = new IntegrityVerificationService();
export default integrityVerificationService;
