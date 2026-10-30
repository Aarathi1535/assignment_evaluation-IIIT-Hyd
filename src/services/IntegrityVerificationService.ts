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
export type AssemblyStatus = 'INTACT' | 'MISMATCH' | 'UNAPPROVED' | 'UNSEALED' | 'ERROR' | 'NOT_APPLICABLE';
export type OverallIntegrityStatus = 'INTACT' | 'MISMATCH' | 'ERROR' | 'NOT_APPLICABLE';

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
    status: OverallIntegrityStatus;
    outcome: OverallIntegrityStatus;
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

export interface VerifyExamIntegrityOptions {
    /**
     * If true, populates all per-item verification results (including INTACT items).
     * If false (default), keeps memory use bounded and returns only problem items in `items` arrays.
     */
    includeAllItems?: boolean;
    /**
     * Optional cap on the number of problem items retained in memory and returned in the summary
     * to protect against unbounded memory growth during mass-corruption events.
     * Summary counts (total, intact, mismatch, error, unsealed) always remain exact.
     * Defaults to unlimited.
     */
    maxProblemRecords?: number;
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
     *
     * Scalability & Memory Bounding:
     * - Batches and IngestionPages are streamed using Mongoose cursors with projections
     *   (selecting only batchId and files for batches; _id, batchId, fileId, pageNumber, storageKey for pages).
     * - Large documents and nested fields (such as metadata.annotations) are never materialized into memory.
     * - Memory scales as O(B_ids + F_batch + P_retained) where B_ids is the set of unique batch IDs,
     *   F_batch is the file array of the single active batch being processed, and P_retained is the
     *   problem records array (bounded by options.maxProblemRecords if set).
     * - Sequential storage existence checks prevent unbounded concurrency against storage backends.
     *
     * Security:
     * - No raw infrastructure error messages, absolute filesystem paths, bucket names, secrets, or storage keys
     *   are exposed in public failure reasons. Failures map to safe fixed reason codes.
     */
    async verifyExamIntegrity(
        examId: string,
        context?: IngestionApprovalAuditContext,
        options?: VerifyExamIntegrityOptions
    ): Promise<IntegrityVerificationSummary> {
        const includeAllItems = options?.includeAllItems ?? false;
        const maxProblemRecords = options?.maxProblemRecords ?? Infinity;

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
        // Select only batchId from direct exam batches via distinct query
        const directBatchIds = (await Batch.distinct('batchId', {
            exam: examObjectId,
            isActive: true
        })) as string[];

        const answerScripts = await AnswerScript.find({ exam: examObjectId, isActive: true }).select('_id').lean();
        const scriptIds = answerScripts.map((s) => s._id);

        // Retrieve distinct batch IDs for pages linked to this exam's answer scripts without loading documents
        const pagesBatchIds = scriptIds.length > 0
            ? ((await IngestionPage.distinct('batchId', {
                answerScript: { $in: scriptIds }
            })) as string[])
            : [];

        const allBatchIds = Array.from(new Set([
            ...directBatchIds.map((b) => String(b)),
            ...pagesBatchIds.map((b) => String(b))
        ])).filter(Boolean);

        // Stream batches with projection covering only needed fields
        const batchCursor = Batch.find({ batchId: { $in: allBatchIds }, isActive: true })
            .select('batchId files')
            .cursor();

        // 2. Verify Original Uploaded Files
        const allOriginalItems: OriginalFileVerificationItem[] = [];
        const problemOriginalItems: OriginalFileVerificationItem[] = [];
        const problemFiles: Array<{ batchId: string; fileId: string; status: string; reason?: string }> = [];

        let totalOriginal = 0;
        let intactOriginal = 0;
        let mismatchOriginal = 0;
        let unsealedOriginal = 0;
        let errorOriginal = 0;

        for await (const batch of batchCursor) {
            const files = batch.files || [];
            for (const file of files) {
                totalOriginal += 1;

                // Check if file lacks seal metadata
                if (!file.hmac || !file.integrityMetadata) {
                    unsealedOriginal += 1;
                    const item: OriginalFileVerificationItem = {
                        batchId: batch.batchId,
                        fileId: file.fileId,
                        fileIndex: file.fileIndex,
                        originalFilename: file.originalFilename,
                        status: 'UNSEALED',
                        reason: 'Original file lacks required HMAC seal or binding metadata'
                    };
                    if (problemOriginalItems.length < maxProblemRecords) {
                        problemOriginalItems.push(item);
                        problemFiles.push({
                            batchId: batch.batchId,
                            fileId: file.fileId,
                            status: 'UNSEALED',
                            reason: item.reason
                        });
                    }
                    if (includeAllItems) {
                        allOriginalItems.push(item);
                    }
                    continue;
                }

                // Verify historical key configuration is available without falling back
                try {
                    getHmacSecret(file.keyId);
                } catch {
                    errorOriginal += 1;
                    const item: OriginalFileVerificationItem = {
                        batchId: batch.batchId,
                        fileId: file.fileId,
                        fileIndex: file.fileIndex,
                        originalFilename: file.originalFilename,
                        status: 'ERROR',
                        reason: 'HMAC key configuration unavailable or not configured'
                    };
                    if (problemOriginalItems.length < maxProblemRecords) {
                        problemOriginalItems.push(item);
                        problemFiles.push({
                            batchId: batch.batchId,
                            fileId: file.fileId,
                            status: 'ERROR',
                            reason: item.reason
                        });
                    }
                    if (includeAllItems) {
                        allOriginalItems.push(item);
                    }
                    continue;
                }

                // Read original content from immutable storage
                let contentBuffer: Buffer;
                try {
                    contentBuffer = await immutableStorageService.readOriginalContent(file.storageKey);
                } catch (readErr: unknown) {
                    errorOriginal += 1;
                    const isNotFound = readErr && typeof readErr === 'object' && ('code' in readErr) && (readErr as { code?: string | number }).code === 'ENOENT';
                    const safeReason = isNotFound ? 'OBJECT_NOT_FOUND' : 'STORAGE_READ_FAILED';
                    const item: OriginalFileVerificationItem = {
                        batchId: batch.batchId,
                        fileId: file.fileId,
                        fileIndex: file.fileIndex,
                        originalFilename: file.originalFilename,
                        status: 'ERROR',
                        reason: safeReason
                    };
                    if (problemOriginalItems.length < maxProblemRecords) {
                        problemOriginalItems.push(item);
                        problemFiles.push({
                            batchId: batch.batchId,
                            fileId: file.fileId,
                            status: 'ERROR',
                            reason: safeReason
                        });
                    }
                    if (includeAllItems) {
                        allOriginalItems.push(item);
                    }
                    continue;
                }

                // Verify HMAC seal against content and recorded metadata
                const verification = immutableStorageService.verifyOriginalIntegrity(contentBuffer, file);
                if (verification.valid) {
                    intactOriginal += 1;
                    if (includeAllItems) {
                        allOriginalItems.push({
                            batchId: batch.batchId,
                            fileId: file.fileId,
                            fileIndex: file.fileIndex,
                            originalFilename: file.originalFilename,
                            status: 'INTACT'
                        });
                    }
                } else {
                    const reason = verification.reason || 'VERIFICATION_FAILED';
                    const isKeyError = reason.includes('unavailable') || reason.includes('not configured');
                    const status: IntegrityStatus = isKeyError ? 'ERROR' : 'MISMATCH';
                    if (status === 'ERROR') {
                        errorOriginal += 1;
                    } else {
                        mismatchOriginal += 1;
                    }
                    const item: OriginalFileVerificationItem = {
                        batchId: batch.batchId,
                        fileId: file.fileId,
                        fileIndex: file.fileIndex,
                        originalFilename: file.originalFilename,
                        status,
                        reason
                    };
                    if (problemOriginalItems.length < maxProblemRecords) {
                        problemOriginalItems.push(item);
                        problemFiles.push({
                            batchId: batch.batchId,
                            fileId: file.fileId,
                            status,
                            reason
                        });
                    }
                    if (includeAllItems) {
                        allOriginalItems.push(item);
                    }
                }
            }
        }

        // 3. Verify Derived Pages
        // Bounded cursor streaming with projection: avoid loading annotations or heavy metadata
        const pageQuery = allBatchIds.length > 0 || scriptIds.length > 0
            ? {
                $or: [
                    ...(allBatchIds.length > 0 ? [{ batchId: { $in: allBatchIds } }] : []),
                    ...(scriptIds.length > 0 ? [{ answerScript: { $in: scriptIds } }] : [])
                ]
            }
            : { batchId: '__NO_MATCH__' };

        const pageCursor = IngestionPage.find(pageQuery)
            .select('_id batchId fileId pageNumber storageKey')
            .cursor();

        let totalPages = 0;
        let intactPages = 0;
        let mismatchPages = 0;
        let errorPages = 0;

        const allDerivedItems: DerivedPageVerificationItem[] = [];
        const problemDerivedItems: DerivedPageVerificationItem[] = [];
        const problemPages: Array<{ pageId: string; batchId: string; fileId: string; pageNumber: number; status: string; reason?: string }> = [];

        for await (const page of pageCursor) {
            totalPages += 1;
            const pageIdStr = page._id.toString();

            // Validate key structure, namespace, and deterministic format before storage access
            const keyValidation = this.validateDerivedKeyShape(page);
            if (!keyValidation.valid) {
                mismatchPages += 1;
                const item: DerivedPageVerificationItem = {
                    pageId: pageIdStr,
                    batchId: page.batchId,
                    fileId: page.fileId,
                    pageNumber: page.pageNumber,
                    status: 'MISMATCH',
                    reason: keyValidation.reason
                };
                if (problemDerivedItems.length < maxProblemRecords) {
                    problemDerivedItems.push(item);
                    problemPages.push({
                        pageId: pageIdStr,
                        batchId: page.batchId,
                        fileId: page.fileId,
                        pageNumber: page.pageNumber,
                        status: 'MISMATCH',
                        reason: keyValidation.reason
                    });
                }
                if (includeAllItems) {
                    allDerivedItems.push(item);
                }
                continue;
            }

            // Key is validated: verify existence in derived storage backend (sequential, bounded)
            try {
                const exists = await derivedStorageService.derivedPageExists(page.storageKey);
                if (!exists) {
                    errorPages += 1;
                    const item: DerivedPageVerificationItem = {
                        pageId: pageIdStr,
                        batchId: page.batchId,
                        fileId: page.fileId,
                        pageNumber: page.pageNumber,
                        status: 'ERROR',
                        reason: 'OBJECT_NOT_FOUND'
                    };
                    if (problemDerivedItems.length < maxProblemRecords) {
                        problemDerivedItems.push(item);
                        problemPages.push({
                            pageId: pageIdStr,
                            batchId: page.batchId,
                            fileId: page.fileId,
                            pageNumber: page.pageNumber,
                            status: 'ERROR',
                            reason: 'OBJECT_NOT_FOUND'
                        });
                    }
                    if (includeAllItems) {
                        allDerivedItems.push(item);
                    }
                } else {
                    intactPages += 1;
                    if (includeAllItems) {
                        allDerivedItems.push({
                            pageId: pageIdStr,
                            batchId: page.batchId,
                            fileId: page.fileId,
                            pageNumber: page.pageNumber,
                            status: 'INTACT'
                        });
                    }
                }
            } catch {
                errorPages += 1;
                const item: DerivedPageVerificationItem = {
                    pageId: pageIdStr,
                    batchId: page.batchId,
                    fileId: page.fileId,
                    pageNumber: page.pageNumber,
                    status: 'ERROR',
                    reason: 'STORAGE_READ_FAILED'
                };
                if (problemDerivedItems.length < maxProblemRecords) {
                    problemDerivedItems.push(item);
                    problemPages.push({
                        pageId: pageIdStr,
                        batchId: page.batchId,
                        fileId: page.fileId,
                        pageNumber: page.pageNumber,
                        status: 'ERROR',
                        reason: 'STORAGE_READ_FAILED'
                    });
                }
                if (includeAllItems) {
                    allDerivedItems.push(item);
                }
            }
        }

        // 4. Verify Exam Assembly (delegate to IngestionApprovalService)
        const auditContext: IngestionApprovalAuditContext = {
            actingUserId: context?.actingUserId || SYSTEM_PRINCIPAL_ID,
            actingUserRole: context?.actingUserRole || SYSTEM_ROLE,
            ipAddress: context?.ipAddress
        };

        const assemblyResult = await IngestionApprovalService.verifyAssembly(examId, auditContext);

        const isAssemblyUnapproved = assemblyResult.status === 'UNAPPROVED';
        const effectiveAssemblyStatus: AssemblyStatus = isAssemblyUnapproved ? 'NOT_APPLICABLE' : assemblyResult.status;
        const effectiveAssemblyReason = isAssemblyUnapproved
            ? 'Ingestion has not been approved for this exam (assembly seal not applicable)'
            : assemblyResult.reason;

        // 5. Aggregate Counts
        const originalCounts = {
            total: totalOriginal,
            intact: intactOriginal,
            mismatch: mismatchOriginal,
            unsealed: unsealedOriginal,
            error: errorOriginal,
            items: includeAllItems ? allOriginalItems : problemOriginalItems
        };

        const derivedCounts = {
            total: totalPages,
            intact: intactPages,
            mismatch: mismatchPages,
            error: errorPages,
            items: includeAllItems ? allDerivedItems : problemDerivedItems
        };

        // 6. Determine Overall Outcome
        const hasFileMismatch = originalCounts.mismatch > 0 || originalCounts.unsealed > 0;
        const hasPageMismatch = derivedCounts.mismatch > 0;
        const hasAssemblyMismatch = effectiveAssemblyStatus === 'MISMATCH' || effectiveAssemblyStatus === 'UNSEALED';

        const hasFileError = originalCounts.error > 0;
        const hasPageError = derivedCounts.error > 0;
        const hasAssemblyError = effectiveAssemblyStatus === 'ERROR';

        let overallStatus: OverallIntegrityStatus = 'INTACT';
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
        } else if (isAssemblyUnapproved) {
            overallStatus = 'NOT_APPLICABLE';
            overallValid = true;
            overallReason = 'Exam ingestion is not approved; assembly verification is not applicable. Original files and derived pages are intact.';
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
                status: effectiveAssemblyStatus,
                reason: effectiveAssemblyReason,
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
