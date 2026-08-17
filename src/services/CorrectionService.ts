import mongoose from 'mongoose';
import AnswerScript, { IAnswerScript, IdentificationStatus, ManualIdReason } from '../models/AnswerScript';
import IngestionPage, { IIngestionPage } from '../models/IngestionPage';
import AuditLog from '../models/AuditLog';
import BatchRepository from '../repositories/BatchRepository';
import { HttpError } from '../lib/errors';

export interface CorrectionAuditContext {
    actingUserId: string;
    actingUserRole: string;
    ipAddress?: string;
}

class CorrectionService {
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

            // Update page's answer script
            freshPage.answerScript = freshTarget._id as mongoose.Types.ObjectId;
            await freshPage.save({ session });

            // Recompute range/counts for source script
            const remainingPages = await IngestionPage.find({ answerScript: freshSource._id })
                .sort({ pageNumber: 1 })
                .session(session);

            let sourceDeleted = false;
            const previousSourceState = {
                startPageNumber: freshSource.startPageNumber,
                endPageNumber: freshSource.endPageNumber,
                pageCount: freshSource.pageCount
            };
            let newSourceState: unknown = null;

            if (remainingPages.length === 0) {
                await AnswerScript.deleteOne({ _id: freshSource._id }).session(session);
                sourceDeleted = true;
                newSourceState = 'DELETED';
            } else {
                freshSource.startPageNumber = remainingPages[0].pageNumber;
                freshSource.endPageNumber = remainingPages[remainingPages.length - 1].pageNumber;
                freshSource.pageCount = remainingPages.length;
                freshSource.__v = (freshSource.__v || 0) + 1;
                await freshSource.save({ session });
                newSourceState = {
                    startPageNumber: freshSource.startPageNumber,
                    endPageNumber: freshSource.endPageNumber,
                    pageCount: freshSource.pageCount
                };
            }

            // Recompute range/counts for target script
            const targetPages = await IngestionPage.find({ answerScript: freshTarget._id })
                .sort({ pageNumber: 1 })
                .session(session);

            const previousTargetState = {
                startPageNumber: freshTarget.startPageNumber,
                endPageNumber: freshTarget.endPageNumber,
                pageCount: freshTarget.pageCount
            };

            freshTarget.startPageNumber = targetPages[0].pageNumber;
            freshTarget.endPageNumber = targetPages[targetPages.length - 1].pageNumber;
            freshTarget.pageCount = targetPages.length;
            freshTarget.__v = (freshTarget.__v || 0) + 1;
            await freshTarget.save({ session });

            const newTargetState = {
                startPageNumber: freshTarget.startPageNumber,
                endPageNumber: freshTarget.endPageNumber,
                pageCount: freshTarget.pageCount
            };

            // Validate startPageNumber uniqueness
            const affectedIds = sourceDeleted ? [freshTarget._id] : [freshSource._id, freshTarget._id];
            const otherScripts = await AnswerScript.find({
                batchId,
                fileIndex: freshTarget.fileIndex,
                isActive: true,
                _id: { $nin: affectedIds }
            }).session(session);

            const usedStarts = new Set(otherScripts.map(s => s.startPageNumber));
            if (!sourceDeleted && freshSource.startPageNumber !== undefined) {
                if (usedStarts.has(freshSource.startPageNumber)) {
                    throw new HttpError(`Duplicate startPageNumber ${freshSource.startPageNumber} detected for source script`, 400);
                }
                usedStarts.add(freshSource.startPageNumber);
            }
            if (freshTarget.startPageNumber !== undefined) {
                if (usedStarts.has(freshTarget.startPageNumber)) {
                    throw new HttpError(`Duplicate startPageNumber ${freshTarget.startPageNumber} detected for target script`, 400);
                }
            }

            // Audit log write (inside transaction)
            await AuditLog.create([{
                user: new mongoose.Types.ObjectId(context.actingUserId),
                action: 'SCRIPT_REMAP',
                outcome: 'SUCCESS',
                entityId: freshPage._id,
                entityType: 'IngestionPage',
                details: {
                    batchId,
                    pageId: freshPage._id.toString(),
                    pageNumber: freshPage.pageNumber,
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
                remappedPage: freshPage
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

            // Recompute range/counts for target script
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

            // Validate startPageNumber uniqueness
            const otherScripts = await AnswerScript.find({
                batchId,
                fileIndex: freshTarget.fileIndex,
                isActive: true,
                _id: { $nin: [freshTarget._id] }
            }).session(session);
            const usedStarts = new Set(otherScripts.map(s => s.startPageNumber));
            if (freshTarget.startPageNumber !== undefined && usedStarts.has(freshTarget.startPageNumber)) {
                throw new HttpError(`Duplicate startPageNumber ${freshTarget.startPageNumber} detected for target script after merge`, 400);
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
