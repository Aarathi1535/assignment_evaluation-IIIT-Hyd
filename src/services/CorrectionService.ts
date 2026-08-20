import mongoose from 'mongoose';
import AnswerScript, { IAnswerScript, IdentificationStatus, ManualIdReason } from '../models/AnswerScript';
import IngestionPage, { IIngestionPage } from '../models/IngestionPage';
import AuditLog from '../models/AuditLog';
import Exam, { IngestionApprovalStatus } from '../models/Exam';
import BatchRepository from '../repositories/BatchRepository';
import { HttpError } from '../lib/errors';

export interface CorrectionAuditContext {
    actingUserId: string;
    actingUserRole: string;
    ipAddress?: string;
}

class CorrectionService {
    /**
     * Guards all correction mutations: throws 409 if the exam linked to this
     * batch has ingestion approval status APPROVED.
     * This enforces the freeze-after-approval rule from AE-074.
     */
    private async assertIngestionNotApproved(examId: mongoose.Types.ObjectId | undefined | null): Promise<void> {
        if (!examId) return;
        const exam = await Exam.findOne({ _id: examId, isActive: true }).lean();
        if (!exam) return;
        const status = exam.ingestionApprovalStatus ?? IngestionApprovalStatus.PENDING_REVIEW;
        if (status === IngestionApprovalStatus.APPROVED) {
            throw new HttpError(
                'Ingestion has been approved. Revoke approval before making corrections.',
                409
            );
        }
    }

    async remapPage(
        batchId: string,
        pageId: string,
        targetScriptId: string,
        versions: Record<string, number>,
        context: CorrectionAuditContext
    ): Promise<{ sourceDeleted: boolean; remappedPage: IIngestionPage }> {
        // Check batch access
        const batch = await BatchRepository.getBatchById(batchId, context.actingUserId, context.actingUserRole);
        if (!batch) {
            throw new HttpError('Batch not found or access denied', 404);
        }

        // Gate: block corrections if exam ingestion is approved (AE-074)
        await this.assertIngestionNotApproved(batch.exam);

        const page = await IngestionPage.findById(pageId);
        if (!page || page.batchId !== batchId) {
            throw new HttpError('Page not found or does not belong to the batch', 404);
        }

        const targetScript = await AnswerScript.findOne({ _id: targetScriptId, batchId, isActive: true });
        if (!targetScript) {
            throw new HttpError('Target script not found or does not belong to the batch', 404);
        }

        const sourceScriptId = page.answerScript;
        if (!sourceScriptId) {
            throw new HttpError('Page does not belong to any script', 400);
        }

        if (sourceScriptId.toString() === targetScriptId) {
            // No-op success
            return {
                sourceDeleted: false,
                remappedPage: page
            };
        }

        const sourceScript = await AnswerScript.findOne({ _id: sourceScriptId, batchId, isActive: true });
        if (!sourceScript) {
            throw new HttpError('Source script not found', 404);
        }

        const targetFileIndex = targetScript.fileIndex ?? 0;
        const targetFile = batch.files.find(f => f.fileIndex === targetFileIndex);
        if (!targetFile) {
            throw new HttpError(`File index ${targetFileIndex} not found in batch`, 400);
        }
        const targetFileId = targetFile.fileId;

        // Verify optimistic concurrency locking versions
        const sourceExpectedVersion = versions[sourceScriptId.toString()];
        const targetExpectedVersion = versions[targetScriptId.toString()];

        if (sourceExpectedVersion !== undefined && sourceScript.__v !== sourceExpectedVersion) {
            throw new HttpError('Concurrency conflict: Source script has been modified', 409);
        }
        if (targetExpectedVersion !== undefined && targetScript.__v !== targetExpectedVersion) {
            throw new HttpError('Concurrency conflict: Target script has been modified', 409);
        }

        const session = await mongoose.startSession();
        let useTransaction = false;
        try {
            session.startTransaction();
            useTransaction = true;
        } catch {
            // transaction fallback (e.g. standalone db)
        }

        try {
            // Fetch fresh copies within transaction
            const freshPage = await IngestionPage.findOne({ _id: pageId }).session(session);
            if (!freshPage) throw new HttpError('Page not found during transaction', 404);

            const freshSource = await AnswerScript.findOne({ _id: sourceScriptId }).session(session);
            if (!freshSource) throw new HttpError('Source script not found during transaction', 404);

            const freshTarget = await AnswerScript.findOne({ _id: targetScriptId }).session(session);
            if (!freshTarget) throw new HttpError('Target script not found during transaction', 404);

            // Double check versions under transaction session
            if (sourceExpectedVersion !== undefined && freshSource.__v !== sourceExpectedVersion) {
                throw new HttpError('Concurrency conflict: Source script has been modified', 409);
            }
            if (targetExpectedVersion !== undefined && freshTarget.__v !== targetExpectedVersion) {
                throw new HttpError('Concurrency conflict: Target script has been modified', 409);
            }

            const previousSourceState = {
                startPageNumber: freshSource.startPageNumber,
                endPageNumber: freshSource.endPageNumber,
                pageCount: freshSource.pageCount
            };

            const previousTargetState = {
                startPageNumber: freshTarget.startPageNumber,
                endPageNumber: freshTarget.endPageNumber,
                pageCount: freshTarget.pageCount
            };

            const sourceFileIndex = freshSource.fileIndex ?? 0;

            // Phase 1: Identify all affected pages in source and destination files
            const sourcePages = await IngestionPage.find({
                batchId,
                fileIndex: sourceFileIndex
            }).session(session);

            const targetPages = sourceFileIndex === targetFileIndex
                ? sourcePages
                : await IngestionPage.find({
                    batchId,
                    fileIndex: targetFileIndex
                }).session(session);

            // Phase 2: Put affected pages into a collision-free temporary state
            if (sourceFileIndex === targetFileIndex) {
                for (let i = 0; i < sourcePages.length; i++) {
                    await IngestionPage.updateOne(
                        { _id: sourcePages[i]._id },
                        { $set: { pageNumber: 100000 + i } },
                        { session }
                    );
                }
            } else {
                for (let i = 0; i < sourcePages.length; i++) {
                    await IngestionPage.updateOne(
                        { _id: sourcePages[i]._id },
                        { $set: { pageNumber: 200000 + i } },
                        { session }
                    );
                }
                for (let i = 0; i < targetPages.length; i++) {
                    await IngestionPage.updateOne(
                        { _id: targetPages[i]._id },
                        { $set: { pageNumber: 100000 + i } },
                        { session }
                    );
                }
            }

            // Phase 3: Apply final file identity to the moved page
            // Temporarily set its pageNumber to a unique offset in the target file space
            const tempPageNumber = sourceFileIndex === targetFileIndex
                ? (100000 + sourcePages.findIndex(p => p._id.toString() === freshPage._id.toString()))
                : (100000 + targetPages.length);

            await IngestionPage.updateOne(
                { _id: freshPage._id },
                {
                    $set: {
                        answerScript: freshTarget._id,
                        fileIndex: targetFileIndex,
                        fileId: targetFileId,
                        pageNumber: tempPageNumber
                    }
                },
                { session }
            );

            // Phase 4: Recompute final page numbering sequentially starting from 1
            const resequenceFilePagesFinal = async (fIndex: number, targetScriptIdToAppend?: string, pageToAppendId?: string) => {
                const scripts = await AnswerScript.find({
                    batchId,
                    fileIndex: fIndex,
                    isActive: true
                }).sort({ startPageNumber: 1 }).session(session);

                const allPagesInOrder: mongoose.Types.ObjectId[] = [];

                for (const script of scripts) {
                    const pages = await IngestionPage.find({
                        answerScript: script._id
                    }).session(session);

                    if (targetScriptIdToAppend && script._id.toString() === targetScriptIdToAppend && pageToAppendId) {
                        const otherPages = pages.filter(p => p._id.toString() !== pageToAppendId);
                        otherPages.sort((a, b) => a.pageNumber - b.pageNumber);
                        const otherPageIds = otherPages.map(p => p._id);
                        allPagesInOrder.push(...otherPageIds, new mongoose.Types.ObjectId(pageToAppendId));
                    } else {
                        pages.sort((a, b) => a.pageNumber - b.pageNumber);
                        allPagesInOrder.push(...pages.map(p => p._id));
                    }
                }

                // Phase 4a: Update database to final sequential values
                for (let i = 0; i < allPagesInOrder.length; i++) {
                    const pId = allPagesInOrder[i];
                    const finalPageNumber = i + 1;
                    await IngestionPage.updateOne(
                        { _id: pId },
                        { $set: { pageNumber: finalPageNumber } },
                        { session }
                    );
                }

                // Phase 5: Recompute AnswerScript summaries from the database
                for (const script of scripts) {
                    const scriptPages = await IngestionPage.find({
                        answerScript: script._id
                    }).sort({ pageNumber: 1 }).session(session);

                    if (scriptPages.length === 0) {
                        await AnswerScript.deleteOne({ _id: script._id }).session(session);
                    } else {
                        script.startPageNumber = scriptPages[0].pageNumber;
                        script.endPageNumber = scriptPages[scriptPages.length - 1].pageNumber;
                        script.pageCount = scriptPages.length;
                        script.__v = (script.__v || 0) + 1;
                        await script.save({ session });
                    }
                }
            };

            if (sourceFileIndex === targetFileIndex) {
                await resequenceFilePagesFinal(targetFileIndex, freshTarget._id.toString(), freshPage._id.toString());
            } else {
                await resequenceFilePagesFinal(targetFileIndex, freshTarget._id.toString(), freshPage._id.toString());
                await resequenceFilePagesFinal(sourceFileIndex);
            }

            // Check if source script was deleted
            const finalSourcePages = await IngestionPage.find({ answerScript: freshSource._id }).session(session);
            const sourceDeleted = finalSourcePages.length === 0;

            const freshSourceAfter = sourceDeleted ? null : await AnswerScript.findOne({ _id: freshSource._id }).session(session);
            const freshTargetAfter = await AnswerScript.findOne({ _id: freshTarget._id }).session(session);

            const newSourceState = sourceDeleted ? 'DELETED' : {
                startPageNumber: freshSourceAfter?.startPageNumber,
                endPageNumber: freshSourceAfter?.endPageNumber,
                pageCount: freshSourceAfter?.pageCount
            };

            const newTargetState = {
                startPageNumber: freshTargetAfter?.startPageNumber,
                endPageNumber: freshTargetAfter?.endPageNumber,
                pageCount: freshTargetAfter?.pageCount
            };

            // Validate startPageNumber uniqueness
            const validateStartPageNumbers = async (fIndex: number) => {
                const scripts = await AnswerScript.find({
                    batchId,
                    fileIndex: fIndex,
                    isActive: true
                }).session(session);
                const starts = scripts.map(s => s.startPageNumber);
                const uniqueStarts = new Set(starts);
                if (uniqueStarts.size !== starts.length) {
                    throw new HttpError(`Duplicate startPageNumber detected in fileIndex ${fIndex}`, 400);
                }
            };

            await validateStartPageNumbers(targetFileIndex);
            if (sourceFileIndex !== targetFileIndex) {
                await validateStartPageNumbers(sourceFileIndex);
            }

            const finalPage = await IngestionPage.findOne({ _id: pageId }).session(session);
            if (!finalPage) throw new HttpError('Page not found at end of transaction', 404);

            // Audit log write (inside transaction)
            await AuditLog.create([{
                user: new mongoose.Types.ObjectId(context.actingUserId),
                action: 'SCRIPT_REMAP',
                outcome: 'SUCCESS',
                entityId: finalPage._id,
                entityType: 'IngestionPage',
                details: {
                    batchId,
                    pageId: finalPage._id.toString(),
                    pageNumber: finalPage.pageNumber,
                    previousScriptId: freshSource._id.toString(),
                    newScriptId: freshTarget._id.toString(),
                    previousSourceState,
                    newSourceState,
                    previousTargetState,
                    newTargetState
                },
                ipAddress: context.ipAddress
            }], { session });

            if (useTransaction) {
                await session.commitTransaction();
            }

            return {
                sourceDeleted,
                remappedPage: finalPage
            };
        } catch (error) {
            if (useTransaction) {
                await session.abortTransaction();
            }
            throw error;
        } finally {
            session.endSession();
        }
    }

    async mergeScripts(
        batchId: string,
        sourceScriptId: string,
        targetScriptId: string,
        versions: Record<string, number>,
        context: CorrectionAuditContext
    ): Promise<{ targetScript: IAnswerScript }> {
        // Verify batch ownership
        const batch = await BatchRepository.getBatchById(batchId, context.actingUserId, context.actingUserRole);
        if (!batch) {
            throw new HttpError('Batch not found or access denied', 404);
        }

        // Gate: block corrections if exam ingestion is approved (AE-074)
        await this.assertIngestionNotApproved(batch.exam);

        if (sourceScriptId === targetScriptId) {
            throw new HttpError('Cannot merge a script with itself', 400);
        }

        const sourceScript = await AnswerScript.findOne({ _id: sourceScriptId, batchId, isActive: true });
        if (!sourceScript) {
            throw new HttpError('Source script not found or does not belong to the batch', 404);
        }

        const targetScript = await AnswerScript.findOne({ _id: targetScriptId, batchId, isActive: true });
        if (!targetScript) {
            throw new HttpError('Target script not found or does not belong to the batch', 404);
        }

        // Optimistic Locking version checks
        const sourceExpectedVersion = versions[sourceScriptId];
        const targetExpectedVersion = versions[targetScriptId];
        if (sourceExpectedVersion !== undefined && sourceScript.__v !== sourceExpectedVersion) {
            throw new HttpError('Concurrency conflict: Source script has been modified', 409);
        }
        if (targetExpectedVersion !== undefined && targetScript.__v !== targetExpectedVersion) {
            throw new HttpError('Concurrency conflict: Target script has been modified', 409);
        }

        // Student identification conflicts check
        const sourceStudent = sourceScript.student?.toString();
        const targetStudent = targetScript.student?.toString();
        const sourceCandidate = sourceScript.candidateStudentId;
        const targetCandidate = targetScript.candidateStudentId;

        const hasDifferentStudents = sourceStudent && targetStudent && sourceStudent !== targetStudent;
        const hasDifferentCandidates = sourceCandidate && targetCandidate && sourceCandidate !== targetCandidate;

        if (hasDifferentStudents || hasDifferentCandidates) {
            throw new HttpError('Cannot merge scripts identified with different students', 400);
        }

        const session = await mongoose.startSession();
        let useTransaction = false;
        try {
            session.startTransaction();
            useTransaction = true;
        } catch {
            // fallback
        }

        try {
            // Fresh read within transaction
            const freshSource = await AnswerScript.findOne({ _id: sourceScriptId }).session(session);
            if (!freshSource) throw new HttpError('Source script not found during transaction', 404);
            const freshTarget = await AnswerScript.findOne({ _id: targetScriptId }).session(session);
            if (!freshTarget) throw new HttpError('Target script not found during transaction', 404);

            if (sourceExpectedVersion !== undefined && freshSource.__v !== sourceExpectedVersion) {
                throw new HttpError('Concurrency conflict: Source script has been modified', 409);
            }
            if (targetExpectedVersion !== undefined && freshTarget.__v !== targetExpectedVersion) {
                throw new HttpError('Concurrency conflict: Target script has been modified', 409);
            }

            // Merge rules: Copy student mapping details from source if target is unidentified but source is identified
            const sourceIdentified = freshSource.identificationStatus === 'IDENTIFIED' || freshSource.student;
            const targetIdentified = freshTarget.identificationStatus === 'IDENTIFIED' || freshTarget.student;

            if (sourceIdentified && !targetIdentified) {
                freshTarget.student = freshSource.student;
                freshTarget.candidateStudentId = freshSource.candidateStudentId;
                freshTarget.identificationSource = freshSource.identificationSource;
                freshTarget.identificationStatus = freshSource.identificationStatus;
                freshTarget.needsManualId = freshSource.needsManualId;
                freshTarget.manualIdReason = freshSource.manualIdReason;
            }

            // Update pages belonging to source script
            await IngestionPage.updateMany(
                { answerScript: freshSource._id },
                { $set: { answerScript: freshTarget._id } },
                { session }
            );

            // After re-pointing, pages from the source script still carry their original
            // fileIndex/fileId/pageNumber values. If source and target came from different
            // files, the merged script now owns pages with duplicate pageNumbers
            // (e.g. both files had a pageNumber:1), which will cause E11000 on
            // (batchId, fileIndex, startPageNumber) when a subsequent split is attempted.
            //
            // Fix: migrate every source page into the target file's numbering space.
            // This is a three-phase operation to avoid intermediate unique-index violations
            // on IngestionPage's (batchId, fileId, pageNumber) and
            // (batchId, fileIndex, pageNumber) compound indexes.

            const targetFileIndex = freshTarget.fileIndex ?? 0;
            const targetFile = batch.files.find(f => f.fileIndex === targetFileIndex);
            if (!targetFile) {
                throw new HttpError(
                    `Target file not found in batch for fileIndex ${targetFileIndex}`,
                    400
                );
            }
            const targetFileId = targetFile.fileId;

            // Pages now belonging to the merged target script that are still in the
            // source file's space (only present on cross-file merges).
            const sourceFileIndex = freshSource.fileIndex ?? 0;
            const crossFilePages =
                targetFileIndex !== sourceFileIndex
                    ? await IngestionPage.find({
                          answerScript: freshTarget._id,
                          fileIndex: sourceFileIndex
                      }).session(session)
                    : [];

            if (crossFilePages.length > 0) {
                // Find the maximum pageNumber currently occupied in the TARGET file
                // (across all scripts in that file, not just the target script).
                const allTargetFilePages = await IngestionPage.find({
                    batchId,
                    fileIndex: targetFileIndex
                }).session(session);
                const maxTargetPageNum = allTargetFilePages.reduce(
                    (max, p) => Math.max(max, p.pageNumber),
                    0
                );

                // Phase 1: Move source pages to a large temporary pageNumber while they
                // still carry the source fileIndex/fileId.  This vacates their current
                // (batchId, sourceFileId, pageNumber) and (batchId, sourceFileIndex, pageNumber)
                // index slots without touching target-file pages.
                for (let i = 0; i < crossFilePages.length; i++) {
                    await IngestionPage.updateOne(
                        { _id: crossFilePages[i]._id },
                        { $set: { pageNumber: 5_000_000 + i } },
                        { session }
                    );
                }

                // Phase 2: Update source pages' fileIndex and fileId to match the target file.
                // At this point they still carry the large temp pageNumber so neither index
                // is violated: (batchId, targetFileId, 5000000+i) is safe.
                for (const p of crossFilePages) {
                    await IngestionPage.updateOne(
                        { _id: p._id },
                        { $set: { fileIndex: targetFileIndex, fileId: targetFileId } },
                        { session }
                    );
                }

                // Phase 3: Assign final sequential pageNumbers that continue directly
                // after the highest existing page in the target file.
                // Source pages are sorted by their original pageNumber to preserve
                // intra-file ordering.
                const sortedCrossFilePages = [...crossFilePages].sort(
                    (a, b) => a.pageNumber - b.pageNumber
                );
                for (let i = 0; i < sortedCrossFilePages.length; i++) {
                    await IngestionPage.updateOne(
                        { _id: sortedCrossFilePages[i]._id },
                        { $set: { pageNumber: maxTargetPageNum + i + 1 } },
                        { session }
                    );
                }
            }

            // Recompute range/counts for target script from the (now-consistent) pages
            const targetPages = await IngestionPage.find({ answerScript: freshTarget._id })
                .sort({ pageNumber: 1 })
                .session(session);

            const previousTargetState = {
                startPageNumber: freshTarget.startPageNumber,
                endPageNumber: freshTarget.endPageNumber,
                pageCount: freshTarget.pageCount,
                student: freshTarget.student
            };

            freshTarget.startPageNumber = targetPages[0].pageNumber;
            freshTarget.endPageNumber = targetPages[targetPages.length - 1].pageNumber;
            freshTarget.pageCount = targetPages.length;
            freshTarget.__v = (freshTarget.__v || 0) + 1;
            await freshTarget.save({ session });

            const newTargetState = {
                startPageNumber: freshTarget.startPageNumber,
                endPageNumber: freshTarget.endPageNumber,
                pageCount: freshTarget.pageCount,
                student: freshTarget.student
            };

            // Delete source script (atomically)
            await AnswerScript.deleteOne({ _id: freshSource._id }).session(session);

            // Validate startPageNumber uniqueness post-merge
            const remainingScripts = await AnswerScript.find({
                batchId,
                fileIndex: freshTarget.fileIndex,
                isActive: true,
                _id: { $nin: [freshTarget._id] }
            }).session(session);
            const usedStarts = new Set(remainingScripts.map(s => s.startPageNumber));
            if (freshTarget.startPageNumber !== undefined && usedStarts.has(freshTarget.startPageNumber)) {
                throw new HttpError(
                    `Duplicate startPageNumber ${freshTarget.startPageNumber} detected for target script after merge`,
                    400
                );
            }

            // Audit log write (inside transaction)
            await AuditLog.create([{
                user: new mongoose.Types.ObjectId(context.actingUserId),
                action: 'SCRIPT_MERGE',
                outcome: 'SUCCESS',
                entityId: freshTarget._id,
                entityType: 'AnswerScript',
                details: {
                    batchId,
                    sourceScriptId: freshSource._id.toString(),
                    targetScriptId: freshTarget._id.toString(),
                    previousSourceState: {
                        startPageNumber: freshSource.startPageNumber,
                        endPageNumber: freshSource.endPageNumber,
                        pageCount: freshSource.pageCount,
                        student: freshSource.student
                    },
                    previousTargetState,
                    newTargetState
                },
                ipAddress: context.ipAddress
            }], { session });

            if (useTransaction) {
                await session.commitTransaction();
            }
            return { targetScript: freshTarget };
        } catch (error) {
            if (useTransaction) {
                await session.abortTransaction();
            }
            throw error;
        } finally {
            session.endSession();
        }
    }

    async splitScript(
        batchId: string,
        scriptId: string,
        version: number,
        groups: string[][],
        context: CorrectionAuditContext
    ): Promise<{ originalScript: IAnswerScript; newScripts: IAnswerScript[] }> {
        // Verify batch ownership
        const batch = await BatchRepository.getBatchById(batchId, context.actingUserId, context.actingUserRole);
        if (!batch) {
            throw new HttpError('Batch not found or access denied', 404);
        }

        // Gate: block corrections if exam ingestion is approved (AE-074)
        await this.assertIngestionNotApproved(batch.exam);

        const originalScript = await AnswerScript.findOne({ _id: scriptId, batchId, isActive: true });
        if (!originalScript) {
            throw new HttpError('AnswerScript not found or does not belong to the batch', 404);
        }

        // Optimistic locking check
        if (version !== undefined && originalScript.__v !== version) {
            throw new HttpError('Concurrency conflict: The script has been modified', 409);
        }

        if (!groups || groups.length < 2) {
            throw new HttpError('A split requires at least two groups', 400);
        }

        // Fetch pages currently associated with originalScript
        const originalPages = await IngestionPage.find({ answerScript: originalScript._id }).sort({ pageNumber: 1 });
        const originalPageIds = new Set(originalPages.map(p => p._id.toString()));

        // Validate group membership partition
        const inputPageIds = new Set<string>();
        for (const group of groups) {
            if (!group || group.length === 0) {
                throw new HttpError('Each group in a split must contain at least one page', 400);
            }
            for (const pageId of group) {
                if (inputPageIds.has(pageId)) {
                    throw new HttpError(`Page ID ${pageId} is duplicated in split groups`, 400);
                }
                if (!originalPageIds.has(pageId)) {
                    throw new HttpError(`Page ID ${pageId} does not belong to the script being split`, 400);
                }
                inputPageIds.add(pageId);
            }
        }

        if (inputPageIds.size !== originalPages.length) {
            throw new HttpError('Every page of the original script must be assigned to exactly one group', 400);
        }

        // Find which group contains the cover page, or defaults to the first group if none
        let inheritingGroupIndex = 0;
        for (let i = 0; i < groups.length; i++) {
            const groupPageIds = groups[i];
            const groupPages = originalPages.filter(p => groupPageIds.includes(p._id.toString()));
            if (groupPages.some(p => p.isCoverPage)) {
                inheritingGroupIndex = i;
                break;
            }
        }

        const session = await mongoose.startSession();
        let useTransaction = false;
        try {
            session.startTransaction();
            useTransaction = true;
        } catch {
            // fallback
        }

        try {
            // Fresh read of original script inside transaction
            const freshOriginal = await AnswerScript.findOne({ _id: scriptId }).session(session);
            if (!freshOriginal) throw new HttpError('Original script not found during transaction', 404);
            if (version !== undefined && freshOriginal.__v !== version) {
                throw new HttpError('Concurrency conflict: The script has been modified', 409);
            }

            const newScripts: IAnswerScript[] = [];
            const resultingScriptsData: unknown[] = [];

            // Loop groups to update/create scripts and update page linkages
            for (let i = 0; i < groups.length; i++) {
                const groupPageIds = groups[i];
                const groupPages = originalPages.filter(p => groupPageIds.includes(p._id.toString()));

                // Sort pages by pageNumber to calculate range
                groupPages.sort((a, b) => a.pageNumber - b.pageNumber);
                const startPageNumber = groupPages[0].pageNumber;
                const endPageNumber = groupPages[groupPages.length - 1].pageNumber;
                const pageCount = groupPages.length;

                if (i === inheritingGroupIndex) {
                    // Update freshOriginal script ranges/counts
                    freshOriginal.startPageNumber = startPageNumber;
                    freshOriginal.endPageNumber = endPageNumber;
                    freshOriginal.pageCount = pageCount;
                    freshOriginal.__v = (freshOriginal.__v || 0) + 1;
                    await freshOriginal.save({ session });

                    // Pages in inheriting group are already linked, but let's confirm linkage
                    await IngestionPage.updateMany(
                        { _id: { $in: groupPageIds.map(id => new mongoose.Types.ObjectId(id)) } },
                        { $set: { answerScript: freshOriginal._id } },
                        { session }
                    );

                    resultingScriptsData.push({
                        scriptId: freshOriginal._id.toString(),
                        startPageNumber,
                        endPageNumber,
                        pageCount,
                        student: freshOriginal.student?.toString() || null,
                        isInherited: true
                    });
                } else {
                    // Create new unidentified script
                    const newScript = new AnswerScript({
                        exam: freshOriginal.exam,
                        batchId: freshOriginal.batchId,
                        fileIndex: freshOriginal.fileIndex,
                        filePath: freshOriginal.filePath,
                        filename: freshOriginal.filename,
                        student: null,
                        candidateStudentId: null,
                        identificationSource: null,
                        identificationStatus: IdentificationStatus.UNIDENTIFIED,
                        needsManualId: true,
                        manualIdReason: ManualIdReason.NO_CODE_FOUND,
                        startPageNumber,
                        endPageNumber,
                        pageCount,
                        isActive: true
                    });
                    await newScript.save({ session });

                    // Update pages' answerScript reference to new script
                    await IngestionPage.updateMany(
                        { _id: { $in: groupPageIds.map(id => new mongoose.Types.ObjectId(id)) } },
                        { $set: { answerScript: newScript._id } },
                        { session }
                    );

                    newScripts.push(newScript);
                    resultingScriptsData.push({
                        scriptId: newScript._id.toString(),
                        startPageNumber,
                        endPageNumber,
                        pageCount,
                        student: null,
                        isInherited: false
                    });
                }
            }

            // Validate startPageNumber uniqueness
            const allCreatedIds = [freshOriginal._id, ...newScripts.map(s => s._id)];
            const otherScripts = await AnswerScript.find({
                batchId,
                fileIndex: freshOriginal.fileIndex,
                isActive: true,
                _id: { $nin: allCreatedIds }
            }).session(session);

            const usedStarts = new Set(otherScripts.map(s => s.startPageNumber));
            const newStarts = resultingScriptsData.map(d => (d as { startPageNumber: number }).startPageNumber);
            for (const start of newStarts) {
                if (usedStarts.has(start)) {
                    throw new HttpError(`Duplicate startPageNumber ${start} detected during split`, 400);
                }
                usedStarts.add(start);
            }

            // Verify there are no duplicate starts within the new/updated scripts themselves
            const newStartsSet = new Set(newStarts);
            if (newStartsSet.size !== newStarts.length) {
                throw new HttpError('Duplicate startPageNumber detected among resulting scripts of the split', 400);
            }

            // Audit log write (inside transaction)
            await AuditLog.create([{
                user: new mongoose.Types.ObjectId(context.actingUserId),
                action: 'SCRIPT_SPLIT',
                outcome: 'SUCCESS',
                entityId: freshOriginal._id,
                entityType: 'AnswerScript',
                details: {
                    batchId,
                    originalScriptId: freshOriginal._id.toString(),
                    splitResult: resultingScriptsData
                },
                ipAddress: context.ipAddress
            }], { session });

            if (useTransaction) {
                await session.commitTransaction();
            }

            return {
                originalScript: freshOriginal,
                newScripts
            };
        } catch (error) {
            if (useTransaction) {
                await session.abortTransaction();
            }
            throw error;
        } finally {
            session.endSession();
        }
    }

    async reorderPages(
        batchId: string,
        scriptId: string,
        version: number,
        orderedPageIds: string[],
        context: CorrectionAuditContext
    ): Promise<{ script: IAnswerScript }> {
        // Verify batch ownership
        const batch = await BatchRepository.getBatchById(batchId, context.actingUserId, context.actingUserRole);
        if (!batch) {
            throw new HttpError('Batch not found or access denied', 404);
        }

        // Gate: block corrections if exam ingestion is approved (AE-074)
        await this.assertIngestionNotApproved(batch.exam);

        const script = await AnswerScript.findOne({ _id: scriptId, batchId, isActive: true });
        if (!script) {
            throw new HttpError('AnswerScript not found or does not belong to the batch', 404);
        }

        // Optimistic locking check
        if (version !== undefined && script.__v !== version) {
            throw new HttpError('Concurrency conflict: The script has been modified', 409);
        }

        const pages = await IngestionPage.find({ answerScript: script._id }).sort({ pageNumber: 1 });
        const pageIds = pages.map(p => p._id.toString());

        // Validate input orderedPageIds
        if (!orderedPageIds || orderedPageIds.length !== pages.length) {
            throw new HttpError('Invalid orderedPageIds length. Must match script pages count.', 400);
        }

        const inputSet = new Set(orderedPageIds);
        const originalSet = new Set(pageIds);
        if (inputSet.size !== orderedPageIds.length) {
            throw new HttpError('Duplicate page IDs in reorder input', 400);
        }
        for (const id of orderedPageIds) {
            if (!originalSet.has(id)) {
                throw new HttpError(`Page ID ${id} does not belong to the script`, 400);
            }
        }

        const session = await mongoose.startSession();
        let useTransaction = false;
        try {
            session.startTransaction();
            useTransaction = true;
        } catch {
            // fallback
        }

        try {
            const freshScript = await AnswerScript.findOne({ _id: scriptId }).session(session);
            if (!freshScript) throw new HttpError('Script not found during transaction', 404);
            if (version !== undefined && freshScript.__v !== version) {
                throw new HttpError('Concurrency conflict: The script has been modified', 409);
            }

            // Get original page numbers in sorted order (asc) so we reassign the same exact page numbers
            const sortedPageNumbers = pages.map(p => p.pageNumber);

            // Step 1: Assign offset values to avoid index collisions (with min: 1 validation constraint)
            for (let i = 0; i < orderedPageIds.length; i++) {
                const pageId = orderedPageIds[i];
                await IngestionPage.updateOne(
                    { _id: new mongoose.Types.ObjectId(pageId) },
                    { $set: { pageNumber: 100000 + i } },
                    { session }
                );
            }

            // Step 2: Assign final page numbers
            for (let i = 0; i < orderedPageIds.length; i++) {
                const pageId = orderedPageIds[i];
                const finalPageNumber = sortedPageNumbers[i];
                await IngestionPage.updateOne(
                    { _id: new mongoose.Types.ObjectId(pageId) },
                    { $set: { pageNumber: finalPageNumber } },
                    { session }
                );
            }

            // Recompute range/counts from database
            const finalPages = await IngestionPage.find({ answerScript: freshScript._id })
                .sort({ pageNumber: 1 })
                .session(session);

            const previousPageOrder = pages.map(p => ({ pageId: p._id.toString(), pageNumber: p.pageNumber }));
            const newPageOrder = finalPages.map(p => ({ pageId: p._id.toString(), pageNumber: p.pageNumber }));

            freshScript.startPageNumber = finalPages[0].pageNumber;
            freshScript.endPageNumber = finalPages[finalPages.length - 1].pageNumber;
            freshScript.pageCount = finalPages.length;
            freshScript.__v = (freshScript.__v || 0) + 1;
            await freshScript.save({ session });

            // Validate startPageNumber uniqueness
            const otherScripts = await AnswerScript.find({
                batchId,
                fileIndex: freshScript.fileIndex,
                isActive: true,
                _id: { $nin: [freshScript._id] }
            }).session(session);
            const usedStarts = new Set(otherScripts.map(s => s.startPageNumber));
            if (freshScript.startPageNumber !== undefined && usedStarts.has(freshScript.startPageNumber)) {
                throw new HttpError(`Duplicate startPageNumber ${freshScript.startPageNumber} detected for script after reorder`, 400);
            }

            // Audit log write (inside transaction)
            await AuditLog.create([{
                user: new mongoose.Types.ObjectId(context.actingUserId),
                action: 'SCRIPT_REORDER',
                outcome: 'SUCCESS',
                entityId: freshScript._id,
                entityType: 'AnswerScript',
                details: {
                    batchId,
                    scriptId: freshScript._id.toString(),
                    previousPageOrder,
                    newPageOrder
                },
                ipAddress: context.ipAddress
            }], { session });

            if (useTransaction) {
                await session.commitTransaction();
            }
            return { script: freshScript };
        } catch (error) {
            if (useTransaction) {
                await session.abortTransaction();
            }
            throw error;
        } finally {
            session.endSession();
        }
    }
}

const correctionService = new CorrectionService();
export default correctionService;
