/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import AnswerScript, {
    IAnswerScript,
    ManualIdReason,
    IdentificationSource,
    IdentificationStatus
} from '../models/AnswerScript';
import IngestionPage from '../models/IngestionPage';
import Course from '../models/Course';
import StudentMapping from '../models/StudentMapping';
import User, { IUser } from '../models/User';
import BatchRepository from '../repositories/BatchRepository';
import ExamRepository from '../repositories/ExamRepository';
import { HttpError } from '../lib/errors';
import { normalizeRollNumber } from '../utils/studentMappingUtils';
import { SplittingStrategyType, IngestionApprovalStatus } from '../models/Exam';
import { PageSplittingStrategy } from './splitting/PageSplittingStrategy';
import { CoverBoundarySplittingStrategy } from './splitting/CoverBoundarySplittingStrategy';
import { FixedPageSplittingStrategy } from './splitting/FixedPageSplittingStrategy';


export interface AuditContext {
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

export interface AnswerScriptGroup {
    batchId: string;
    fileIndex: number;
    startPageNumber: number;
    endPageNumber: number;
    pageCount: number;
    candidateStudentId: string | null;
    decodeOutcome: string | null;
    coverStorageKey?: string;
    pages: any[];
}

export class StudentRosterMappingService {
    /**
     * Assembles AnswerScripts from IngestionPages and performs automated student identification
     * mapping according to AE-051 and AE-053 specifications.
     * 
     * Core Rule:
     * Every assembled answer script MUST be persisted. Identification failure or ambiguity
     * must NEVER cause AnswerScript creation to fail or discard the script.
     * 
     * Required processing order:
     * IngestionPage records -> assemble AnswerScript -> attempt automatic identification ->
     * either identified student OR needsManualId=true with explicit manualIdReason.
     */
    async assembleAndMapAnswerScripts(
        batchId: string,
        context?: AuditContext
    ): Promise<IAnswerScript[]> {
        // Step 1: Owner scoping & authorization verification
        if (!context?.actingUserId?.trim() || !context?.actingUserRole?.trim()) {
            throw new HttpError('Authorization context required', 401);
        }

        const batch = await BatchRepository.getBatchById(
            batchId,
            context.actingUserId,
            context.actingUserRole
        );
        if (!batch) {
            // Deny-by-default: unauthorized resources are indistinguishable from missing resources (404)
            throw new HttpError('Batch not found', 404);
        }

        if (!batch.exam) {
            // If batch is not associated with an exam, AnswerScripts cannot be linked
            return [];
        }

        // Verify exam association and owner scoping
        const exam = await ExamRepository.getExamById(
            batch.exam.toString(),
            context.actingUserId,
            context.actingUserRole
        );
        if (!exam) {
            throw new HttpError('Exam not found', 404);
        }

        if (exam.ingestionApprovalStatus === IngestionApprovalStatus.APPROVED) {
            throw new HttpError(
                'Ingestion has been approved. Revoke approval before making corrections.',
                409
            );
        }

        // Step 2: Fetch IngestionPages sorted canonically by (fileIndex ASC, pageNumber ASC)
        const pages = await IngestionPage.find({ batchId }).sort({
            fileIndex: 1,
            pageNumber: 1
        });

        if (!pages || pages.length === 0) {
            return [];
        }

        // Clear all existing page -> AnswerScript links for this batch to ensure idempotency
        await IngestionPage.updateMany(
            { batchId },
            { $set: { answerScript: null } }
        );

        // Step 3: Page Splitting Strategy Execution
        const strategyType = exam.splittingStrategy || SplittingStrategyType.COVER_PAGE;
        let strategy: PageSplittingStrategy;
        if (strategyType === SplittingStrategyType.FIXED_PAGE) {
            const n = exam.fixedPageCount;
            if (n === undefined || n === null || n <= 0 || !Number.isInteger(n)) {
                throw new HttpError('Invalid fixed page count configuration for exam', 400);
            }
            strategy = new FixedPageSplittingStrategy(n);
        } else {
            strategy = new CoverBoundarySplittingStrategy();
        }

        const ranges = strategy.split(pages);

        const groups: AnswerScriptGroup[] = ranges.map(range => {
            const coverPage = range.pages[0];
            return {
                batchId,
                fileIndex: range.fileIndex,
                startPageNumber: range.startPageNumber,
                endPageNumber: range.endPageNumber,
                pageCount: range.pageCount,
                candidateStudentId: coverPage.candidateStudentId || null,
                decodeOutcome: coverPage.decodeOutcome || null,
                coverStorageKey: coverPage.storageKey,
                pages: range.pages
            };
        });

        if (groups.length === 0) {
            return [];
        }

        // Step 4: Load Exam Roster (Exam.enrolledStudents, StudentMapping, Course.enrolledStudents)
        const enrolledUserIds = new Set<string>();

        if (exam.enrolledStudents && Array.isArray(exam.enrolledStudents)) {
            for (const sid of exam.enrolledStudents) {
                if (sid) enrolledUserIds.add(sid.toString());
            }
        }

        const studentMappings = await StudentMapping.find({ exam: exam._id });
        for (const mapping of studentMappings) {
            if (mapping.student) {
                enrolledUserIds.add(mapping.student.toString());
            }
        }

        if (exam.course) {
            const course = await Course.findOne({ _id: exam.course, isActive: true });
            if (course?.enrolledStudents && Array.isArray(course.enrolledStudents)) {
                for (const sid of course.enrolledStudents) {
                    if (sid) enrolledUserIds.add(sid.toString());
                }
            }
        }

        // Load full user records for all enrolled students
        const enrolledUsers = await User.find({
            _id: { $in: Array.from(enrolledUserIds).map(id => new mongoose.Types.ObjectId(id)) },
            isActive: true
        });

        const userByIdMap = new Map<string, IUser>();
        const userByEmailMap = new Map<string, IUser>();
        for (const u of enrolledUsers) {
            userByIdMap.set(u._id.toString(), u);
            if (u.email) {
                userByEmailMap.set(u.email.toLowerCase().trim(), u);
            }
        }

        const userByAnonIdMap = new Map<string, IUser>();
        const userByRollNumberMap = new Map<string, IUser>();
        for (const mapping of studentMappings) {
            if (mapping.student) {
                const u = userByIdMap.get(mapping.student.toString());
                if (u) {
                    if (mapping.anonymousId) {
                        userByAnonIdMap.set(mapping.anonymousId.trim(), u);
                    }
                    if (mapping.rollNumber) {
                        const normalizedRoll = normalizeRollNumber(mapping.rollNumber);
                        if (normalizedRoll) {
                            userByRollNumberMap.set(normalizedRoll, u);
                        }
                    }
                }
            }
        }

        const results: IAnswerScript[] = [];
        const filesByFileIndex = new Map(batch.files.map((f: any) => [f.fileIndex, f]));

        // Step 5: Process each group, resolve student, detect duplicates, and upsert AnswerScript
        for (const group of groups) {
            const coverPage = group.pages[0];
            let qrStudentId: string | null = null;
            let qrDecodeOutcome: string | null = null;

            if (coverPage) {
                if (coverPage.qrStudentId !== undefined && coverPage.qrStudentId !== null) {
                    qrStudentId = coverPage.qrStudentId;
                } else {
                    qrStudentId = coverPage.candidateStudentId || group.candidateStudentId || null;
                }

                if (coverPage.qrDecodeOutcome !== undefined && coverPage.qrDecodeOutcome !== null) {
                    qrDecodeOutcome = coverPage.qrDecodeOutcome;
                } else {
                    qrDecodeOutcome = coverPage.decodeOutcome || group.decodeOutcome || null;
                }
            } else {
                qrStudentId = group.candidateStudentId || null;
                qrDecodeOutcome = group.decodeOutcome || null;
            }

            const omrStudentId = coverPage && coverPage.omrStudentId !== undefined ? coverPage.omrStudentId : null;
            const omrDecodeOutcome = coverPage && coverPage.omrDecodeOutcome !== undefined ? coverPage.omrDecodeOutcome : null;

            // Resolve QR user
            let qrMatchedUser: IUser | null = null;
            if (qrStudentId && qrDecodeOutcome === 'found') {
                qrMatchedUser = this.resolveStudentFromRoster(
                    qrStudentId,
                    userByIdMap,
                    userByEmailMap,
                    userByAnonIdMap,
                    userByRollNumberMap
                );
            }

            // Resolve OMR user
            let omrMatchedUser: IUser | null = null;
            if (omrStudentId && omrDecodeOutcome === 'found') {
                omrMatchedUser = this.resolveStudentFromRoster(
                    omrStudentId,
                    userByIdMap,
                    userByEmailMap,
                    userByAnonIdMap,
                    userByRollNumberMap
                );
            }

            const checkStatus = async (
                studentId: string | null,
                decodeOutcome: string | null,
                matchedUser: IUser | null
            ) => {
                let isValid = false;
                let user: IUser | null = null;
                let reason: ManualIdReason | null = null;

                if (decodeOutcome === 'multiple') {
                    reason = ManualIdReason.MULTIPLE_CODES;
                } else if (!studentId || decodeOutcome === 'not_found') {
                    reason = ManualIdReason.NO_CODE_FOUND;
                } else if (!matchedUser || !enrolledUserIds.has(matchedUser._id.toString())) {
                    reason = ManualIdReason.NOT_IN_ROSTER;
                } else {
                    const existingScript = await AnswerScript.findOne({
                        exam: exam._id,
                        student: matchedUser._id,
                        isActive: true
                    });
                    const isDuplicate = existingScript && (
                        existingScript.batchId !== batchId ||
                        existingScript.fileIndex !== group.fileIndex ||
                        existingScript.startPageNumber !== group.startPageNumber
                    );
                    if (isDuplicate) {
                        reason = ManualIdReason.DUPLICATE_STUDENT;
                    } else {
                        isValid = true;
                        user = matchedUser;
                    }
                }

                return { isValid, user, reason };
            };

            const qrStatus = await checkStatus(qrStudentId, qrDecodeOutcome, qrMatchedUser);
            const omrStatus = await checkStatus(omrStudentId, omrDecodeOutcome, omrMatchedUser);

            let resolvedStudentId: mongoose.Types.ObjectId | null = null;
            let candidateStudentId: string | null = null;
            let identificationSource: IdentificationSource | null = null;
            let identificationStatus: IdentificationStatus = IdentificationStatus.UNIDENTIFIED;
            let needsManualId = false;
            let manualIdReason: ManualIdReason | null = null;

            if (qrStatus.isValid) {
                resolvedStudentId = qrStatus.user!._id as mongoose.Types.ObjectId;
                candidateStudentId = qrStudentId;
                identificationSource = IdentificationSource.QR;
                identificationStatus = IdentificationStatus.IDENTIFIED;
                needsManualId = false;
                manualIdReason = null;
            } else if (omrStatus.isValid) {
                resolvedStudentId = omrStatus.user!._id as mongoose.Types.ObjectId;
                candidateStudentId = omrStudentId;
                identificationSource = IdentificationSource.OMR;
                identificationStatus = IdentificationStatus.IDENTIFIED;
                needsManualId = false;
                manualIdReason = null;
            } else {
                resolvedStudentId = null;
                identificationStatus = IdentificationStatus.UNIDENTIFIED;
                needsManualId = true;

                // Determine failed candidate and source
                let failedSource: IdentificationSource | null = null;
                let failedCandidate: string | null = null;

                if (qrStudentId) {
                    failedSource = IdentificationSource.QR;
                    failedCandidate = qrStudentId;
                } else if (omrStudentId) {
                    failedSource = IdentificationSource.OMR;
                    failedCandidate = omrStudentId;
                }

                candidateStudentId = failedCandidate;
                identificationSource = failedSource;

                if (qrStatus.reason === ManualIdReason.DUPLICATE_STUDENT || omrStatus.reason === ManualIdReason.DUPLICATE_STUDENT) {
                    manualIdReason = ManualIdReason.DUPLICATE_STUDENT;
                } else if (qrStatus.reason === ManualIdReason.NOT_IN_ROSTER || omrStatus.reason === ManualIdReason.NOT_IN_ROSTER) {
                    manualIdReason = ManualIdReason.NOT_IN_ROSTER;
                } else if (qrStatus.reason === ManualIdReason.MULTIPLE_CODES || omrStatus.reason === ManualIdReason.MULTIPLE_CODES) {
                    manualIdReason = ManualIdReason.MULTIPLE_CODES;
                } else {
                    manualIdReason = ManualIdReason.NO_CODE_FOUND;
                }
            }

            const hasIdentificationConflict = !!(
                qrStudentId &&
                omrStudentId &&
                qrStudentId.trim() !== omrStudentId.trim()
            );

            // Verify if the script is already identified (e.g. by an operator or previous scan).
            // Automatic processing must not silently overwrite manual operator identifications.
            const existingIdentifiedScript = await AnswerScript.findOne({
                batchId,
                fileIndex: group.fileIndex,
                startPageNumber: group.startPageNumber
            });

            const identificationHistory = existingIdentifiedScript?.identificationHistory || [];

            const precedenceMap: Record<string, number> = {
                'OPERATOR': 4,
                'QR': 3,
                'OMR': 2,
                'OCR': 1
            };

            const existingPrecedence = existingIdentifiedScript?.identificationSource
                ? (precedenceMap[existingIdentifiedScript.identificationSource] || 0)
                : 0;

            const newPrecedence = identificationSource
                ? (precedenceMap[identificationSource] || 0)
                : 0;

            const identityChanged =
                String(existingIdentifiedScript?.student || '') !==
                String(resolvedStudentId || '');

            const shouldOverwrite =
                existingIdentifiedScript &&
                existingPrecedence > 0 &&
                (
                    newPrecedence > existingPrecedence ||
                    (newPrecedence === existingPrecedence && identityChanged)
                );

            if (existingIdentifiedScript && existingIdentifiedScript.student && !shouldOverwrite) {
                resolvedStudentId = existingIdentifiedScript.student as mongoose.Types.ObjectId | null;
                identificationStatus = existingIdentifiedScript.identificationStatus as IdentificationStatus;
                identificationSource = existingIdentifiedScript.identificationSource as any;
                needsManualId = existingIdentifiedScript.needsManualId || false;
                manualIdReason = (existingIdentifiedScript.manualIdReason as ManualIdReason | null) || null;
                candidateStudentId = candidateStudentId || existingIdentifiedScript.candidateStudentId || null;
            } else {
                const isIdentityChanging = existingIdentifiedScript && (
                    String(existingIdentifiedScript.student || '') !== String(resolvedStudentId || '') ||
                    existingIdentifiedScript.identificationSource !== identificationSource ||
                    existingIdentifiedScript.identificationStatus !== identificationStatus
                );

                if (isIdentityChanging) {
                    identificationHistory.push({
                        student: existingIdentifiedScript.student || null,
                        candidateStudentId: existingIdentifiedScript.candidateStudentId || null,
                        identificationSource: existingIdentifiedScript.identificationSource || null,
                        identificationStatus: existingIdentifiedScript.identificationStatus || null,
                        updatedAt: existingIdentifiedScript.updatedAt || new Date()
                    });
                }
            }

            // Enforce incomplete script rule for fixed-page splitting
            if (strategyType === SplittingStrategyType.FIXED_PAGE && group.pageCount < exam.fixedPageCount!) {
                needsManualId = true;
                manualIdReason = ManualIdReason.INCOMPLETE_SCRIPT;
                resolvedStudentId = null;
                identificationStatus = IdentificationStatus.UNIDENTIFIED;
            }

            const sourceFile = filesByFileIndex.get(group.fileIndex);
            const scriptFilePath = group.coverStorageKey || sourceFile?.storageKey || `batches/${batchId}/${group.fileIndex}`;
            const scriptFilename = sourceFile?.originalFilename || `script_${group.fileIndex}_${group.startPageNumber}.pdf`;

            let persistedScript: IAnswerScript | null = null;

            // Step 6: Idempotent upsert enforcing (batchId, fileIndex, startPageNumber) source identity
            try {
                const answerScript = await AnswerScript.findOneAndUpdate(
                    {
                        batchId,
                        fileIndex: group.fileIndex,
                        startPageNumber: group.startPageNumber
                    },
                    {
                        $set: {
                            exam: exam._id,
                            student: resolvedStudentId,
                            filePath: scriptFilePath,
                            filename: scriptFilename,
                            batchId,
                            fileIndex: group.fileIndex,
                            startPageNumber: group.startPageNumber,
                            endPageNumber: group.endPageNumber,
                            pageCount: group.pageCount,
                            candidateStudentId,
                            identificationSource,
                            identificationStatus,
                            decodeOutcome: group.decodeOutcome || null,
                            needsManualId,
                            manualIdReason,
                            qrStudentId,
                            qrDecodeOutcome,
                            omrStudentId,
                            omrDecodeOutcome,
                            hasIdentificationConflict,
                            identificationHistory,
                            isActive: true
                        }
                    },
                    { upsert: true, returnDocument: 'after', runValidators: true }
                );

                if (answerScript) {
                    results.push(answerScript);
                    persistedScript = answerScript;
                }
            } catch (upsertErr: any) {
                // Safe race-condition fallback for (exam, student) duplicate key error
                if (upsertErr.code === 11000 && resolvedStudentId) {
                    const fallbackScript = await AnswerScript.findOneAndUpdate(
                        {
                            batchId,
                            fileIndex: group.fileIndex,
                            startPageNumber: group.startPageNumber
                        },
                        {
                            $set: {
                                exam: exam._id,
                                student: null,
                                filePath: scriptFilePath,
                                filename: scriptFilename,
                                batchId,
                                fileIndex: group.fileIndex,
                                startPageNumber: group.startPageNumber,
                                endPageNumber: group.endPageNumber,
                                pageCount: group.pageCount,
                                candidateStudentId,
                                identificationSource,
                                identificationStatus: IdentificationStatus.UNIDENTIFIED,
                                decodeOutcome: group.decodeOutcome || null,
                                needsManualId: true,
                                manualIdReason: ManualIdReason.DUPLICATE_STUDENT,
                                qrStudentId,
                                qrDecodeOutcome,
                                omrStudentId,
                                omrDecodeOutcome,
                                hasIdentificationConflict,
                                identificationHistory,
                                isActive: true
                            }
                        },
                        { upsert: true, returnDocument: 'after', runValidators: true }
                    );

                    if (fallbackScript) {
                        results.push(fallbackScript);
                        persistedScript = fallbackScript;
                    }
                } else {
                    throw upsertErr;
                }
            }

            if (persistedScript) {
                const pageIds = group.pages.map((p: any) => p._id);
                await IngestionPage.updateMany(
                    { _id: { $in: pageIds } },
                    { $set: { answerScript: persistedScript._id } }
                );
            }
        }

        // Clean up obsolete AnswerScript records that were not recreated during this run (soft deletion)
        const processedScriptIds = results.map(s => s._id);
        await AnswerScript.updateMany(
            {
                batchId,
                _id: { $nin: processedScriptIds }
            },
            {
                $set: {
                    isActive: false,
                    student: null
                }
            }
        );

        return results;
    }

    private resolveStudentFromRoster(
        candidateRaw: string,
        userByIdMap: Map<string, IUser>,
        userByEmailMap: Map<string, IUser>,
        userByAnonIdMap: Map<string, IUser>,
        userByRollNumberMap: Map<string, IUser>
    ): IUser | null {
        let queryStr = candidateRaw.trim();
        if (queryStr.includes(':')) {
            const parts = queryStr.split(':');
            if (parts.length === 2 && parts[1]) {
                queryStr = parts[1].trim();
            }
        }

        // Try matching by ObjectId
        if (mongoose.Types.ObjectId.isValid(queryStr) && userByIdMap.has(queryStr)) {
            return userByIdMap.get(queryStr) || null;
        }
        // Try matching by email
        if (userByEmailMap.has(queryStr.toLowerCase())) {
            return userByEmailMap.get(queryStr.toLowerCase()) || null;
        }
        // Try matching by anonymousId
        if (userByAnonIdMap.has(queryStr)) {
            return userByAnonIdMap.get(queryStr) || null;
        }
        // Try matching by rollNumber
        const normalized = normalizeRollNumber(queryStr);
        if (normalized && userByRollNumberMap.has(normalized)) {
            return userByRollNumberMap.get(normalized) || null;
        }
        return null;
    }
}

export const defaultStudentRosterMappingService = new StudentRosterMappingService();
export default defaultStudentRosterMappingService;

