/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import AnswerScript, { IAnswerScript, ManualIdReason } from '../models/AnswerScript';
import IngestionPage from '../models/IngestionPage';
import Exam from '../models/Exam';
import Course from '../models/Course';
import StudentMapping from '../models/StudentMapping';
import User, { IUser } from '../models/User';
import BatchRepository from '../repositories/BatchRepository';
import ExamRepository from '../repositories/ExamRepository';
import { HttpError } from '../lib/errors';

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
        let batch;
        if (context?.actingUserId || context?.actingUserRole) {
            batch = await BatchRepository.getBatchById(
                batchId,
                context.actingUserId,
                context.actingUserRole
            );
            if (!batch) {
                // Deny-by-default: unauthorized resources are indistinguishable from missing resources (404)
                throw new HttpError('Batch not found', 404);
            }
        } else {
            // Internal / background worker invocation
            batch = await BatchRepository.getBatchByBatchIdInternal(batchId);
            if (!batch) {
                throw new HttpError('Batch not found', 404);
            }
        }

        if (!batch.exam) {
            // If batch is not associated with an exam, AnswerScripts cannot be linked
            return [];
        }

        // Verify exam association and owner scoping
        let exam;
        if (context?.actingUserId || context?.actingUserRole) {
            exam = await ExamRepository.getExamById(
                batch.exam.toString(),
                context.actingUserId,
                context.actingUserRole
            );
            if (!exam) {
                throw new HttpError('Exam not found', 404);
            }
        } else {
            exam = await Exam.findOne({ _id: batch.exam, isActive: true });
            if (!exam) {
                throw new HttpError('Exam not found', 404);
            }
        }

        // Step 2: Fetch IngestionPages sorted canonically by (fileIndex ASC, pageNumber ASC)
        const pages = await IngestionPage.find({ batchId }).sort({
            fileIndex: 1,
            pageNumber: 1
        });

        if (!pages || pages.length === 0) {
            return [];
        }

        // Step 3: Cover-Sheet Grouping Rule
        // - First detected cover (isCoverPage === true) starts a script
        // - Pages from cover N through the page immediately before cover N+1 belong to that script
        // - Next detected cover starts the next script
        // - Guaranteed persistence fallback: if no cover flag exists, group from page 1
        const groups: AnswerScriptGroup[] = [];
        let currentGroup: AnswerScriptGroup | null = null;

        for (const page of pages) {
            if (page.isCoverPage === true) {
                if (currentGroup) {
                    groups.push(currentGroup);
                }
                currentGroup = {
                    batchId,
                    fileIndex: page.fileIndex,
                    startPageNumber: page.pageNumber,
                    endPageNumber: page.pageNumber,
                    pageCount: 1,
                    candidateStudentId: page.candidateStudentId || null,
                    decodeOutcome: page.decodeOutcome || null,
                    coverStorageKey: page.storageKey,
                    pages: [page]
                };
            } else if (currentGroup) {
                currentGroup.endPageNumber = page.pageNumber;
                currentGroup.pageCount += 1;
                currentGroup.pages.push(page);
            }
        }

        if (currentGroup) {
            groups.push(currentGroup);
        }

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
        for (const mapping of studentMappings) {
            if (mapping.anonymousId && mapping.student) {
                const u = userByIdMap.get(mapping.student.toString());
                if (u) {
                    userByAnonIdMap.set(mapping.anonymousId.trim(), u);
                }
            }
        }

        const results: IAnswerScript[] = [];
        const filesByFileIndex = new Map(batch.files.map((f: any) => [f.fileIndex, f]));

        // Step 5: Process each group, resolve student, detect duplicates, and upsert AnswerScript
        for (const group of groups) {
            let matchedUser: IUser | null = null;
            let candidateRaw = group.candidateStudentId?.trim();

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
            }

            // Step 5.1: Determine AE-053 identification state
            let resolvedStudentId: mongoose.Types.ObjectId | null = null;
            let needsManualId = false;
            let manualIdReason: ManualIdReason | null = null;

            if (group.decodeOutcome === 'multiple') {
                // Outcome C: MULTIPLE_CODES
                needsManualId = true;
                manualIdReason = ManualIdReason.MULTIPLE_CODES;
                resolvedStudentId = null;
            } else if (!group.candidateStudentId || group.decodeOutcome === 'not_found') {
                // Outcome B: NO_CODE_FOUND
                needsManualId = true;
                manualIdReason = ManualIdReason.NO_CODE_FOUND;
                resolvedStudentId = null;
            } else if (!matchedUser || !enrolledUserIds.has(matchedUser._id.toString())) {
                // Outcome D: NOT_IN_ROSTER
                needsManualId = true;
                manualIdReason = ManualIdReason.NOT_IN_ROSTER;
                resolvedStudentId = null;
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
                } else {
                    // Outcome A: SUCCESSFULLY_IDENTIFIED
                    resolvedStudentId = matchedUser._id as mongoose.Types.ObjectId;
                    needsManualId = false;
                    manualIdReason = null;
                }
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
                            candidateStudentId: group.candidateStudentId || null,
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
                                candidateStudentId: group.candidateStudentId || null,
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
