import mongoose from 'mongoose';
import AnswerScript, { IAnswerScript } from '../models/AnswerScript';
import IngestionPage, { IIngestionPage } from '../models/IngestionPage';
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
    candidateStudentId?: string | null;
    decodeOutcome?: string | null;
    coverStorageKey?: string;
    pages: IIngestionPage[];
}

export class StudentRosterMappingService {
    /**
     * Assembles AnswerScript groups from IngestionPage records of a batch and resolves
     * candidate student identifiers against the associated exam's enrolled roster.
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
                    candidateStudentId: page.candidateStudentId,
                    decodeOutcome: page.decodeOutcome,
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
        const filesByFileIndex = new Map(batch.files.map(f => [f.fileIndex, f]));

        // Step 5: Process each group, resolve student, detect duplicates, and upsert AnswerScript
        for (const group of groups) {
            let matchedUser: IUser | null = null;
            const candidateRaw = group.candidateStudentId?.trim();

            if (candidateRaw) {
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

            // Ensure matched user is verified to be enrolled in the exam
            let resolvedStudentId: mongoose.Types.ObjectId | null = null;
            let isDuplicateStudentConflict = false;

            if (matchedUser && enrolledUserIds.has(matchedUser._id.toString())) {
                // Check if another AnswerScript for (exam, student) already exists from a different source group
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
                    // Duplicate student conflict detected!
                    // Do NOT overwrite existing script, do NOT bypass unique constraint, leave student null
                    isDuplicateStudentConflict = true;
                    resolvedStudentId = null;
                } else {
                    resolvedStudentId = matchedUser._id as mongoose.Types.ObjectId;
                }
            }

            const sourceFile = filesByFileIndex.get(group.fileIndex);
            const scriptFilePath = group.coverStorageKey || sourceFile?.storageKey || `batches/${batchId}/${group.fileIndex}`;
            const scriptFilename = sourceFile?.originalFilename || `script_${group.fileIndex}_${group.startPageNumber}.pdf`;

            // Step 6: Idempotent upsert enforcing (batchId, fileIndex, startPageNumber) source identity
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
                        needsManualId: isDuplicateStudentConflict ? true : false,
                        manualIdReason: isDuplicateStudentConflict ? 'duplicate_student' : null,
                        isActive: true
                    }
                },
                { upsert: true, returnDocument: 'after', runValidators: true }
            );

            if (answerScript) {
                results.push(answerScript);
            }
        }

        return results;
    }
}

export const defaultStudentRosterMappingService = new StudentRosterMappingService();
export default defaultStudentRosterMappingService;
