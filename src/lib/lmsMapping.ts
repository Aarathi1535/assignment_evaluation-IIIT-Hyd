import mongoose from 'mongoose';
import Course from '../models/Course';
import { IExam, ExamStatus } from '../models/Exam';
import User, { IUser } from '../models/User';
import StudentMapping from '../models/StudentMapping';
import Rubric from '../models/Rubric';
import { HttpError } from './errors';
import studentResultService from '../services/StudentResultService';
import { normalizeRollNumber } from '../utils/studentMappingUtils';
import { csvCell } from './gradeExport';

export type LmsMappingStatus =
    | 'MAPPED'
    | 'UNMAPPED'
    | 'MISSING_IN_COURSE'
    | 'DUPLICATE_LMS_ID'
    | 'DUPLICATE_STUDENT'
    | 'INVALID_IDENTIFIER'
    | 'INVALID_GRADE';

export interface LmsStudentInput {
    lmsStudentId: string;
    email?: string;
    rollNumber?: string;
    studentId?: string;
}

export interface LmsGradeMappingRecord {
    lmsStudentId: string;
    studentId?: string;
    rollNumber?: string;
    ltiSub?: string;
    studentName?: string;
    email?: string;
    grade: number | null;
    maxGrade: number;
    status: LmsMappingStatus;
    validationMessage?: string;
}

export interface LmsMappingResult {
    examId: string;
    examTitle: string;
    courseCode: string;
    totalMarks: number;
    records: LmsGradeMappingRecord[];
    summary: {
        totalInputs: number;
        mappedCount: number;
        unmappedCount: number;
        duplicateCount: number;
        invalidCount: number;
        missingCount: number;
    };
}

/**
 * Validates an LMS student identifier.
 * Must be a non-empty string under 100 characters, without control characters.
 */
export function isValidLmsIdentifier(id: unknown): id is string {
    if (typeof id !== 'string') {
        return false;
    }
    const trimmed = id.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
        return false;
    }
    // Reject ASCII control characters
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed)) {
        return false;
    }
    return true;
}

/**
 * Validates grade value boundaries.
 */
export function isValidGradeValue(grade: unknown, maxGrade: number): boolean {
    if (typeof grade !== 'number' || !Number.isFinite(grade)) {
        return false;
    }
    return grade >= 0 && grade <= maxGrade;
}

/**
 * Core service to map LMS student identifiers to internal student records and grades.
 * Enforces course-scoped authorization to prevent cross-student or cross-course data exposure.
 */
export async function mapLmsStudentIdsToGrades(
    exam: IExam,
    lmsInputs?: LmsStudentInput[]
): Promise<LmsMappingResult> {
    if (!exam.isActive || exam.status !== ExamStatus.PUBLISHED) {
        throw new HttpError('Grade mapping is available only for published exams', 409);
    }

    if (lmsInputs !== undefined) {
        if (!Array.isArray(lmsInputs)) {
            throw new HttpError('lmsInputs must be an array', 400);
        }
        if (lmsInputs.length > 2000) {
            throw new HttpError('lmsInputs exceeds maximum size of 2000 students', 400);
        }
    }

    // 1. Resolve Course to enforce course-scoping boundary
    const course = await Course.findById(exam.course).select('courseCode enrolledStudents isActive').lean();
    if (!course) {
        throw new HttpError('Associated course not found', 404);
    }
    if (!course.isActive) {
        throw new HttpError('Associated course is inactive', 409);
    }

    const enrolledStudentIds = new Set(
        (course.enrolledStudents || []).map(id => id.toString())
    );

    // 2. Fetch released grades fulfilling all release conditions
    const releasedScores = await studentResultService.getPublishedExamScores(exam);
    const scoreByStudentId = new Map(
        releasedScores.map(r => [r.studentId, r.score])
    );

    // 3. Load all enrolled students and student mappings for this exam
    const enrolledObjectIds = Array.from(enrolledStudentIds, id => new mongoose.Types.ObjectId(id));
    const [enrolledUsers, studentMappings] = await Promise.all([
        enrolledObjectIds.length > 0
            ? User.find({ _id: { $in: enrolledObjectIds }, isActive: true }).select('_id name email role').lean()
            : [],
        enrolledObjectIds.length > 0
            ? StudentMapping.find({ exam: exam._id, student: { $in: enrolledObjectIds } }).select('student rollNumber anonymousId ltiSub').lean()
            : []
    ]);

    // Build lookup maps strictly scoped to enrolled students
    const userById = new Map<string, IUser>();
    const userByEmail = new Map<string, IUser>();
    const mappingByStudentId = new Map<string, { rollNumber?: string | null; anonymousId?: string; ltiSub?: string | null }>();
    const studentIdByRollNumber = new Map<string, string>();
    const studentIdByAnonymousId = new Map<string, string>();
    const studentIdByLtiSub = new Map<string, string>();

    for (const mapping of studentMappings) {
        const sid = mapping.student.toString();
        const sub = mapping.ltiSub;
        mappingByStudentId.set(sid, {
            rollNumber: mapping.rollNumber,
            anonymousId: mapping.anonymousId,
            ltiSub: sub
        });
        if (mapping.rollNumber) {
            const normalized = normalizeRollNumber(mapping.rollNumber);
            if (normalized) {
                studentIdByRollNumber.set(normalized, sid);
            }
        }
        if (mapping.anonymousId) {
            studentIdByAnonymousId.set(mapping.anonymousId.trim(), sid);
        }
        if (sub && typeof sub === 'string' && sub.trim()) {
            studentIdByLtiSub.set(sub.trim(), sid);
        }
    }

    for (const user of enrolledUsers) {
        const uid = user._id.toString();
        userById.set(uid, user as unknown as IUser);
        if (user.email) {
            userByEmail.set(user.email.toLowerCase().trim(), user as unknown as IUser);
        }
    }

    const records: LmsGradeMappingRecord[] = [];
    // Ensure maxGrade uses rubric total as single source of truth consistent with StudentResultService
    const rubricRef = exam.rubric;
    const rubricId = rubricRef && typeof rubricRef === 'object' && '_id' in rubricRef
        ? (rubricRef as { _id: mongoose.Types.ObjectId })._id
        : rubricRef;
    const rubric = (rubricRef && typeof rubricRef === 'object' && 'questions' in rubricRef && Array.isArray((rubricRef as { questions?: unknown[] }).questions))
        ? (rubricRef as { questions?: Array<{ maxMarks?: number }> })
        : (rubricId ? await Rubric.findById(rubricId).lean() : await Rubric.findOne({ exam: exam._id }).lean());
    const rubricTotal = rubric?.questions?.reduce((sum: number, q: { maxMarks?: number }) => sum + (Number(q.maxMarks) || 0), 0);
    const maxGrade = (rubricTotal !== undefined && rubricTotal > 0)
        ? rubricTotal
        : (releasedScores.length > 0 && releasedScores[0].maxMarks > 0)
            ? releasedScores[0].maxMarks
            : exam.totalMarks;

    // Mode A: External LMS input mapping list provided
    if (lmsInputs && lmsInputs.length > 0) {
        // Track frequency of LMS IDs to detect duplicate LMS inputs
        const lmsIdCounts = new Map<string, number>();
        for (const input of lmsInputs) {
            if (!input || typeof input !== 'object') continue;
            const trimmed = typeof input.lmsStudentId === 'string' ? input.lmsStudentId.trim() : '';
            if (trimmed) {
                lmsIdCounts.set(trimmed, (lmsIdCounts.get(trimmed) || 0) + 1);
            }
        }

        // First pass: resolve matches and check duplicates
        const resolvedMatches: Array<{
            input: LmsStudentInput;
            matchedStudentId?: string;
            user?: IUser;
            status: LmsMappingStatus;
            validationMessage?: string;
        }> = [];

        const studentIdMatchCount = new Map<string, number>();

        for (const input of lmsInputs) {
            if (!input || typeof input !== 'object') {
                resolvedMatches.push({
                    input: { lmsStudentId: '' },
                    status: 'INVALID_IDENTIFIER',
                    validationMessage: 'LMS student input entry is null or invalid'
                });
                continue;
            }
            if (!isValidLmsIdentifier(input.lmsStudentId)) {
                resolvedMatches.push({
                    input,
                    status: 'INVALID_IDENTIFIER',
                    validationMessage: 'LMS student identifier is invalid, empty, or exceeds 100 characters'
                });
                continue;
            }

            const trimmedLmsId = input.lmsStudentId.trim();
            if ((lmsIdCounts.get(trimmedLmsId) || 0) > 1) {
                resolvedMatches.push({
                    input,
                    status: 'DUPLICATE_LMS_ID',
                    validationMessage: 'Duplicate LMS student identifier detected in export input'
                });
                continue;
            }

            // Attempt resolution:
            // 1. By LTI platform sub (if student was mapped to an LTI platform sub)
            let matchedUser: IUser | undefined;
            if (studentIdByLtiSub.has(trimmedLmsId)) {
                const sid = studentIdByLtiSub.get(trimmedLmsId)!;
                if (enrolledStudentIds.has(sid)) {
                    matchedUser = userById.get(sid);
                }
            }

            // 2. By internal studentId (if valid ObjectId and enrolled)
            if (!matchedUser) {
                if (input.studentId && mongoose.Types.ObjectId.isValid(input.studentId) && enrolledStudentIds.has(input.studentId)) {
                    matchedUser = userById.get(input.studentId);
                } else if (mongoose.Types.ObjectId.isValid(trimmedLmsId) && enrolledStudentIds.has(trimmedLmsId)) {
                    matchedUser = userById.get(trimmedLmsId);
                }
            }

            // 3. By rollNumber
            if (!matchedUser) {
                const rollToLookup = input.rollNumber || trimmedLmsId;
                const normalized = normalizeRollNumber(rollToLookup);
                if (normalized) {
                    const sid = studentIdByRollNumber.get(normalized);
                    if (sid && enrolledStudentIds.has(sid)) {
                        matchedUser = userById.get(sid);
                    }
                }
            }

            // 4. By email
            if (!matchedUser) {
                const emailToLookup = (input.email || trimmedLmsId).toLowerCase().trim();
                const u = userByEmail.get(emailToLookup);
                if (u && enrolledStudentIds.has(u._id.toString())) {
                    matchedUser = u;
                }
            }

            // 5. By anonymousId
            if (!matchedUser) {
                const sid = studentIdByAnonymousId.get(trimmedLmsId);
                if (sid && enrolledStudentIds.has(sid)) {
                    matchedUser = userById.get(sid);
                }
            }

            if (!matchedUser) {
                resolvedMatches.push({
                    input,
                    status: 'MISSING_IN_COURSE',
                    validationMessage: 'LMS student identifier was not found among enrolled students in this course'
                });
                continue;
            }

            const sid = matchedUser._id.toString();
            studentIdMatchCount.set(sid, (studentIdMatchCount.get(sid) || 0) + 1);

            resolvedMatches.push({
                input,
                matchedStudentId: sid,
                user: matchedUser,
                status: 'MAPPED'
            });
        }

        // Second pass: check for multiple LMS IDs pointing to the same internal student
        for (const item of resolvedMatches) {
            const rawLmsId = typeof item.input.lmsStudentId === 'string' ? item.input.lmsStudentId.trim() : '';

            if (item.status === 'INVALID_IDENTIFIER' || item.status === 'DUPLICATE_LMS_ID' || item.status === 'MISSING_IN_COURSE') {
                records.push({
                    lmsStudentId: rawLmsId,
                    grade: null,
                    maxGrade,
                    status: item.status,
                    validationMessage: item.validationMessage
                });
                continue;
            }

            const sid = item.matchedStudentId!;
            if ((studentIdMatchCount.get(sid) || 0) > 1) {
                records.push({
                    lmsStudentId: rawLmsId,
                    studentId: sid,
                    studentName: item.user?.name,
                    email: item.user?.email,
                    grade: null,
                    maxGrade,
                    status: 'DUPLICATE_STUDENT',
                    validationMessage: 'Multiple LMS identifiers resolved to the same internal student'
                });
                continue;
            }

            const mapping = mappingByStudentId.get(sid);
            const score = scoreByStudentId.get(sid);

            if (score === undefined) {
                records.push({
                    lmsStudentId: rawLmsId,
                    studentId: sid,
                    rollNumber: mapping?.rollNumber || undefined,
                    studentName: item.user?.name,
                    email: item.user?.email,
                    grade: null,
                    maxGrade,
                    status: 'UNMAPPED',
                    validationMessage: 'No published, finalized grade available for student'
                });
                continue;
            }

            if (!isValidGradeValue(score, maxGrade)) {
                records.push({
                    lmsStudentId: rawLmsId,
                    studentId: sid,
                    rollNumber: mapping?.rollNumber || undefined,
                    studentName: item.user?.name,
                    email: item.user?.email,
                    grade: score,
                    maxGrade,
                    status: 'INVALID_GRADE',
                    validationMessage: `Grade value ${score} is outside valid bounds (0-${maxGrade})`
                });
                continue;
            }

            records.push({
                lmsStudentId: rawLmsId,
                studentId: sid,
                rollNumber: mapping?.rollNumber || undefined,
                ltiSub: mapping?.ltiSub || (studentIdByLtiSub.has(rawLmsId) ? rawLmsId : undefined),
                studentName: item.user?.name,
                email: item.user?.email,
                grade: score,
                maxGrade,
                status: 'MAPPED'
            });
        }
    } else {
        // Mode B: Generate from all enrolled students for the exam
        for (const user of enrolledUsers) {
            const sid = user._id.toString();
            const mapping = mappingByStudentId.get(sid);
            const lmsStudentId = mapping?.rollNumber || user.email || sid;
            const score = scoreByStudentId.get(sid);

            if (score === undefined) {
                records.push({
                    lmsStudentId,
                    studentId: sid,
                    rollNumber: mapping?.rollNumber || undefined,
                    ltiSub: mapping?.ltiSub || undefined,
                    studentName: user.name,
                    email: user.email,
                    grade: null,
                    maxGrade,
                    status: 'UNMAPPED',
                    validationMessage: 'Grade not finalized or unreleased'
                });
            } else if (!isValidGradeValue(score, maxGrade)) {
                records.push({
                    lmsStudentId,
                    studentId: sid,
                    rollNumber: mapping?.rollNumber || undefined,
                    ltiSub: mapping?.ltiSub || undefined,
                    studentName: user.name,
                    email: user.email,
                    grade: score,
                    maxGrade,
                    status: 'INVALID_GRADE',
                    validationMessage: `Grade value ${score} is outside valid bounds (0-${maxGrade})`
                });
            } else {
                records.push({
                    lmsStudentId,
                    studentId: sid,
                    rollNumber: mapping?.rollNumber || undefined,
                    ltiSub: mapping?.ltiSub || undefined,
                    studentName: user.name,
                    email: user.email,
                    grade: score,
                    maxGrade,
                    status: 'MAPPED'
                });
            }
        }
    }

    // Summary counts
    const mappedCount = records.filter(r => r.status === 'MAPPED').length;
    const unmappedCount = records.filter(r => r.status === 'UNMAPPED').length;
    const duplicateCount = records.filter(r => r.status === 'DUPLICATE_LMS_ID' || r.status === 'DUPLICATE_STUDENT').length;
    const invalidCount = records.filter(r => r.status === 'INVALID_IDENTIFIER' || r.status === 'INVALID_GRADE').length;
    const missingCount = records.filter(r => r.status === 'MISSING_IN_COURSE').length;

    return {
        examId: exam._id.toString(),
        examTitle: exam.title,
        courseCode: course.courseCode,
        totalMarks: maxGrade,
        records,
        summary: {
            totalInputs: records.length,
            mappedCount,
            unmappedCount,
            duplicateCount,
            invalidCount,
            missingCount
        }
    };
}

/**
 * Builds documented LMS gradebook CSV files (Canvas or Standard format).
 * Protects against CSV formula injection.
 */
export function buildLmsCsv(
    result: LmsMappingResult,
    format: 'canvas' | 'standard' = 'standard'
): string {
    if (format === 'canvas') {
        // Canvas-style CSV format (untested)
        // Columns: Student, ID, SIS User ID, SIS Login ID, Section, <Assignment Name> (<Points>)
        // Row 2:     Points Possible,,,,,30
        // Canvas uses 'ID' for its internal numeric user ID; IIIT numeric roll numbers must NOT be placed into 'ID'.
        // Leaving 'ID' blank prevents Canvas from mis-matching against its internal user IDs and allows matching
        // on SIS User ID (roll number) or SIS Login ID (email).
        // Any additional trailing column like 'Status' would be parsed by Canvas as a new assignment, so omit it.
        const header = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', `${result.examTitle} (${result.totalMarks})`];
        const pointsRow = ['    Points Possible', '', '', '', '', result.totalMarks];

        const rows: (string | number)[][] = result.records.map(r => {
            const name = r.studentName || '';
            const trimmedLmsId = (r.lmsStudentId || '').trim();
            const canvasId = ''; // Canvas internal ID left blank to avoid collision with numeric roll numbers
            const sisUserId = r.rollNumber || trimmedLmsId;
            const sisLoginId = r.email || '';
            const gradeVal = r.grade !== null ? r.grade : '';

            return [
                name,
                canvasId,
                sisUserId,
                sisLoginId,
                result.courseCode,
                gradeVal
            ];
        });

        const csvHeader = header.map(csvCell).join(',') + '\r\n';
        const csvPoints = pointsRow.map(csvCell).join(',') + '\r\n';
        const csvData = rows.map(row => row.map(csvCell).join(',') + '\r\n').join('');
        return csvHeader + csvPoints + csvData;
    }

    // Documented Standard LMS Format
    // Columns: LMS Student ID, Student Name, Email, Roll Number, Grade, Max Grade, Status, Validation Message
    const headers = [
        'LMS Student ID',
        'Student Name',
        'Email',
        'Roll Number',
        'Grade',
        'Max Grade',
        'Status',
        'Validation Notes'
    ];

    const rows: (string | number)[][] = result.records.map(r => [
        r.lmsStudentId,
        r.studentName || '',
        r.email || '',
        r.rollNumber || '',
        r.grade !== null ? r.grade : '',
        r.maxGrade,
        r.status,
        r.validationMessage || ''
    ]);

    const csvHeader = headers.map(csvCell).join(',') + '\r\n';
    const csvData = rows.map(row => row.map(csvCell).join(',') + '\r\n').join('');
    return csvHeader + csvData;
}

