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
import { SplittingStrategyType } from '../models/Exam';
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

        // Step 2: Fetch IngestionPages sorted canonically by (fileIndex ASC, pageNumber ASC)
        const pages = await IngestionPage.find({ batchId }).sort({
            fileIndex: 1,
            pageNumber: 1
        });

        if (!pages || pages.length === 0) {
            return [];
        }

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
            // Promote candidate from IngestionPage cover to AnswerScript
            let candidateStudentId = group.candidateStudentId ? group.candidateStudentId.trim() : null;
            let identificationSource = candidateStudentId ? IdentificationSource.QR : null;

            let matchedUser: IUser | null = null;
            let candidateRaw = candidateStudentId;

            if (candidateRaw) {
                // Support AE-052 deterministic payload: examId:studentId
                if (candidateRaw.includes(':')) {
                    const parts = candidateRaw.split(':');
                    if (parts.length === 2 && parts[1]) {
                        candidateRaw = parts[1].trim();
                    }
                }

                // Try matching by ObjectId
                if (mongoose.Types.ObjectId.isValid(candidateRaw) && userByIdMap.has(candidateRaw)) {
                    matchedUser = userByIdMap.get(candidateRaw) || null;
                }
                // Try matching by email
                else if (userByEmailMap.has(candidateRaw.toLowerCase())) {
                    matchedUser = userByEmailMap.get(candidateRaw.toLowerCase()) || null;
                }
                // Try matching by anonymousId
                else if (userByAnonIdMap.has(candidateRaw)) {
                    matchedUser = userByAnonIdMap.get(candidateRaw) || null;
                }
                // Try matching by rollNumber
                else {
                    const normalized = normalizeRollNumber(candidateRaw);
                    if (normalized && userByRollNumberMap.has(normalized)) {
                        matchedUser = userByRollNumberMap.get(normalized) || null;
                    }
                }
            }

            // Step 5.1: Determine AE-053 identification state
            let resolvedStudentId: mongoose.Types.ObjectId | null = null;
            let needsManualId = false;
            let manualIdReason: ManualIdReason | null = null;
            let identificationStatus: IdentificationStatus = IdentificationStatus.UNIDENTIFIED;

            if (group.decodeOutcome === 'multiple') {
                // Outcome C: MULTIPLE_CODES
                needsManualId = true;
                manualIdReason = ManualIdReason.MULTIPLE_CODES;
                resolvedStudentId = null;
                identificationStatus = IdentificationStatus.UNIDENTIFIED;
            } else if (!candidateStudentId || group.decodeOutcome === 'not_found') {
                // Outcome B: NO_CODE_FOUND
                needsManualId = true;
                manualIdReason = ManualIdReason.NO_CODE_FOUND;
                resolvedStudentId = null;
                identificationStatus = IdentificationStatus.UNIDENTIFIED;
            } else if (!matchedUser || !enrolledUserIds.has(matchedUser._id.toString())) {
                // Outcome D: NOT_IN_ROSTER
                needsManualId = true;
                manualIdReason = ManualIdReason.NOT_IN_ROSTER;
                resolvedStudentId = null;
                identificationStatus = IdentificationStatus.UNIDENTIFIED;
            } else {
                // Check if another identified AnswerScript for (exam, student) already exists
                const existingScript = await AnswerScript.findOne({
                    exam: exam._id,
                    student: matchedUser._id,
                    isActive: true
                });

                if (
                    existingScript &&
                    (existingScript.batchId !== batchId ||
                        existingScript.fileIndex !== group.fileIndex ||
                        existingScript.startPageNumber !== group.startPageNumber)
                ) {
                    // Outcome E: DUPLICATE_STUDENT
                    needsManualId = true;
                    manualIdReason = ManualIdReason.DUPLICATE_STUDENT;
                    resolvedStudentId = null;
                    identificationStatus = IdentificationStatus.UNIDENTIFIED;
                } else {
                    // Outcome A: SUCCESSFULLY_IDENTIFIED
                    resolvedStudentId = matchedUser._id as mongoose.Types.ObjectId;
                    needsManualId = false;
                    manualIdReason = null;
                    identificationStatus = IdentificationStatus.IDENTIFIED;
                }
            }

            // Verify if the script is already identified (e.g. by an operator or previous scan).
            // Automatic processing must not silently overwrite manual operator identifications.
            const existingIdentifiedScript = await AnswerScript.findOne({
                batchId,
                fileIndex: group.fileIndex,
                startPageNumber: group.startPageNumber
            });

            if (existingIdentifiedScript && existingIdentifiedScript.identificationStatus === IdentificationStatus.IDENTIFIED) {
                resolvedStudentId = existingIdentifiedScript.student as mongoose.Types.ObjectId | null;
                identificationStatus = existingIdentifiedScript.identificationStatus as IdentificationStatus;
                identificationSource = existingIdentifiedScript.identificationSource as any;
                needsManualId = existingIdentifiedScript.needsManualId || false;
                manualIdReason = (existingIdentifiedScript.manualIdReason as ManualIdReason | null) || null;
                if (!candidateStudentId) {
                    candidateStudentId = existingIdentifiedScript.candidateStudentId || null;
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
                            isActive: true
                        }
                    },
                    { upsert: true, returnDocument: 'after', runValidators: true }
                );

                if (answerScript) {
                    results.push(answerScript);
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
                                isActive: true
                            }
                        },
                        { upsert: true, returnDocument: 'after', runValidators: true }
                    );

                    if (fallbackScript) {
                        results.push(fallbackScript);
                    }
                } else {
                    throw upsertErr;
                }
            }
        }

        return results;
    }
}

export const defaultStudentRosterMappingService = new StudentRosterMappingService();
export default defaultStudentRosterMappingService;

