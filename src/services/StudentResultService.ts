import mongoose from 'mongoose';
import { HttpError } from '../lib/errors';
import { isStudentResultsEnabled } from '../config/env';
import User, { IUser, UserRole } from '../models/User';
import Exam, { IExam, ExamStatus } from '../models/Exam';
import Course, { ICourse } from '../models/Course';
import AnswerScript, { IAnswerScript, IdentificationStatus } from '../models/AnswerScript';
import Grade, { IGrade } from '../models/Grade';
import Allocation, { AllocationStatus, IAllocation } from '../models/Allocation';
import StudentMapping from '../models/StudentMapping';
import Rubric, { IRubric } from '../models/Rubric';

export type ResultReleaseStatus = 'RELEASED' | 'NOT_AVAILABLE';

export interface StudentResultItemDto {
    examId: string;
    examTitle: string;
    courseCode: string;
    examDate: Date | string;
    status: ResultReleaseStatus;
    scriptId?: string;
    total?: number;
    maxMarks?: number;
}

export interface ReleasedStudentResultDto {
    examId: string;
    examTitle: string;
    courseCode: string;
    examDate: Date | string;
    status: 'RELEASED';
    scriptId: string;
    total: number;
    maxMarks: number;
}

export interface CriterionResultDto {
    name: string;
    score: number;
    points: number;
    feedback?: string;
}

export interface QuestionResultDto {
    questionNumber: number | null;
    maxMarks: number;
    awarded: number;
    feedback?: string;
    criteria: CriterionResultDto[];
}

export interface ItemizedResultDto {
    exam: {
        title: string;
        totalMarks: number;
    };
    mode: 'QUESTION' | 'WHOLE';
    questions: QuestionResultDto[];
    total: number;
    maxTotal: number;
}
export class StudentResultService {
    /**
     * Validates that the request is made by an authenticated, active student
     * and that the student results feature flag is enabled.
     * Enforces:
     * 1. STUDENT_RESULTS_ENABLED feature flag is ON (generic 404 if off).
     * 2. Authenticated session role is STUDENT (401 if unauthenticated, 403 if non-student).
     * 3. Database user is active and has role STUDENT (403 if deactivated or role mismatch).
     */
    async validateStudentAccess(actingUserId?: string, actingUserRole?: string): Promise<IUser> {
        // Condition 1: Feature flag check
        if (!isStudentResultsEnabled()) {
            throw new HttpError('Not found', 404);
        }

        // Condition 2: Session authentication & role
        if (!actingUserId) {
            throw new HttpError('Unauthorized', 401);
        }

        const normalizedSessionRole = actingUserRole?.toUpperCase();
        if (normalizedSessionRole !== UserRole.STUDENT) {
            throw new HttpError('Forbidden', 403);
        }

        if (!mongoose.Types.ObjectId.isValid(actingUserId)) {
            throw new HttpError('Forbidden', 403);
        }

        // Condition 3: Reload user from DB to verify active status and current role
        const user = await User.findById(actingUserId);
        if (!user) {
            throw new HttpError('Forbidden', 403);
        }

        if (!user.isActive || user.role !== UserRole.STUDENT) {
            throw new HttpError('Forbidden', 403);
        }

        return user;
    }

    /**
     * Checks if all release conditions are met for an answer script and its exam:
     * - Script belongs to the authenticated student
     * - Script is active, IDENTIFIED, no conflict, needsManualId === false
     * - Exam is active and PUBLISHED
     * - All required grading work is complete (handles whole-script and question-wise grading)
     * - Every required grade has isFinal === true
     * - No associated allocation remains PENDING or IN_PROGRESS
     * - Derives maxMarks strictly from the persisted rubric version referenced by Grade.rubric
     */
    private async evaluateReleaseConditions(
        studentId: mongoose.Types.ObjectId,
        exam: { _id?: mongoose.Types.ObjectId | string; isActive: boolean; status: ExamStatus; rubric?: mongoose.Types.ObjectId | null },
        script: IAnswerScript | null
    ): Promise<{ isReleased: boolean; total?: number; scriptId?: string; maxMarks?: number }> {
        if (!script) {
            return { isReleased: false };
        }

        // Condition 4: Script belongs to student
        if (!script.student || !script.student.equals(studentId)) {
            return { isReleased: false };
        }

        // Condition 5: Active, IDENTIFIED, no conflict, no manual identification needed
        if (!script.isActive) {
            return { isReleased: false };
        }
        if (script.identificationStatus !== IdentificationStatus.IDENTIFIED) {
            return { isReleased: false };
        }
        if (script.hasIdentificationConflict) {
            return { isReleased: false };
        }
        if (script.needsManualId) {
            return { isReleased: false };
        }

        // Condition 6: Exam is active and PUBLISHED
        if (!exam.isActive || exam.status !== ExamStatus.PUBLISHED) {
            return { isReleased: false };
        }

        // Condition 7: Check allocations and grades completeness
        const allocations: IAllocation[] = await Allocation.find({ answerScript: script._id });
        const hasUnfinishedAllocations = allocations.some(
            a => a.status === AllocationStatus.PENDING || a.status === AllocationStatus.IN_PROGRESS
        );
        if (hasUnfinishedAllocations) {
            return { isReleased: false };
        }

        const grades: IGrade[] = await Grade.find({ answerScript: script._id });
        if (grades.length === 0) {
            return { isReleased: false };
        }

        const allGradesFinal = grades.every(g => g.isFinal === true);
        if (!allGradesFinal) {
            return { isReleased: false };
        }

        const examIdStr = exam._id ? exam._id.toString() : script.exam.toString();

        // Check for whole-script grade (question == null or undefined)
        const wholeScriptGrade = grades.find(g => g.question === null || g.question === undefined);

        if (wholeScriptGrade) {
            // Whole-script finality: explicitly verify isFinal === true before releasing
            if (wholeScriptGrade.isFinal !== true) {
                return { isReleased: false };
            }

            // In whole-script grade mode, only a single whole-script grade may exist
            if (grades.length !== 1) {
                return { isReleased: false };
            }

            // If allocations exist, ensure there are no conflicting question-wise allocations
            if (allocations.some(a => a.question !== null && a.question !== undefined)) {
                return { isReleased: false };
            }

            // If allocations exist, at least one whole-script allocation must be COMPLETED
            if (allocations.length > 0 && !allocations.some(a => a.status === AllocationStatus.COMPLETED)) {
                return { isReleased: false };
            }

            if (!wholeScriptGrade.rubric) {
                return { isReleased: false };
            }

            const rubric: IRubric | null = await Rubric.findById(wholeScriptGrade.rubric);
            if (!rubric || !rubric.questions || rubric.questions.length === 0) {
                return { isReleased: false };
            }

            if (rubric.exam.toString() !== examIdStr) {
                return { isReleased: false };
            }

            if (wholeScriptGrade.marksAwarded && wholeScriptGrade.marksAwarded.length > 0) {
                const allRubricCriteriaNames = new Set(
                    (rubric.questions || []).flatMap(q => q.criteria || []).map(c => c.criterionName)
                );
                const hasInvalidCriterion = wholeScriptGrade.marksAwarded.some(
                    m => !allRubricCriteriaNames.has(m.criterionName)
                );
                if (hasInvalidCriterion) {
                    return { isReleased: false };
                }
            }

            const maxMarks = rubric.questions.reduce((sum, q) => sum + (Number(q.maxMarks) || 0), 0);
            if (maxMarks <= 0) {
                return { isReleased: false };
            }

            return {
                isReleased: true,
                total: Math.round(Number(wholeScriptGrade.totalScore) * 100) / 100,
                scriptId: script._id.toString(),
                maxMarks: Math.round(maxMarks * 100) / 100
            };
        }

        // Question-wise grading mode:
        // Reject if any grade has invalid/non-numeric question
        if (grades.some(g => typeof g.question !== 'number')) {
            return { isReleased: false };
        }

        // 1. Rubric version integrity: Use the persisted Grade.rubric references as the source of truth.
        // Ensure all grades reference a rubric and share a consistent rubric/version.
        const rubricIdStrings = Array.from(new Set(grades.map(g => g.rubric?.toString()).filter(Boolean)));
        if (rubricIdStrings.length !== 1) {
            // Missing rubric references or inconsistent/mixed rubric versions across grades
            return { isReleased: false };
        }

        const persistedRubricId = rubricIdStrings[0];
        const rubric: IRubric | null = await Rubric.findById(persistedRubricId);
        if (!rubric || !rubric.questions || rubric.questions.length === 0) {
            return { isReleased: false };
        }

        // Ensure the persisted rubric belongs to this exam
        if (rubric.exam.toString() !== examIdStr) {
            return { isReleased: false };
        }

        const requiredRubricQuestions = rubric.questions.map(q => q.questionNumber);
        const finalGradedQuestionSet = new Set(
            grades
                .filter(g => g.isFinal && typeof g.question === 'number')
                .map(g => g.question as number)
        );

        // Every required question from the rubric version must be graded and finalized
        const hasMissingRubricQuestions = requiredRubricQuestions.some(qNum => !finalGradedQuestionSet.has(qNum));
        if (hasMissingRubricQuestions) {
            return { isReleased: false };
        }

        // Validate that no duplicate or extraneous question grades exist
        if (grades.length !== requiredRubricQuestions.length) {
            return { isReleased: false };
        }

        // Validate that each question grade's marksAwarded criteria exist in the referenced rubric
        for (const grade of grades) {
            const qRubric = rubric.questions.find(q => q.questionNumber === grade.question);
            if (!qRubric) {
                return { isReleased: false };
            }
            if (grade.marksAwarded && grade.marksAwarded.length > 0) {
                const qCriteriaNames = new Set((qRubric.criteria || []).map(c => c.criterionName));
                const hasInvalidCriterion = grade.marksAwarded.some(m => !qCriteriaNames.has(m.criterionName));
                if (hasInvalidCriterion) {
                    return { isReleased: false };
                }
            }
        }

        // 2. Allocation policy for question-wise grading:
        // In the Assignment Evaluator grading workflow (GradingService.ts lines 405-420, 965-1000),
        // professors and administrators possess authoritative grading privileges (UserRole.PROFESSOR,
        // UserRole.ADMIN) and evaluate scripts directly without requiring TA allocations. Allocations
        // are only created when an instructor delegates grading to Teaching Assistants (/api/exams/[id]/allocate).
        // Therefore:
        // - When allocations exist for the answer script, they are mandatory: any PENDING or IN_PROGRESS
        //   allocation blocks release, and every required question must have a COMPLETED allocation.
        // - When no allocations exist for the answer script (e.g. direct faculty evaluation),
        //   grading completeness is determined strictly by the finalized grades against the rubric version.
        const questionWiseAllocations = allocations.filter(a => a.question !== null && a.question !== undefined);
        if (questionWiseAllocations.length > 0) {
            const completedAllocQuestionSet = new Set(
                questionWiseAllocations
                    .filter(a => a.status === AllocationStatus.COMPLETED && typeof a.question === 'number')
                    .map(a => a.question as number)
            );
            const hasMissingAllocation = requiredRubricQuestions.some(qNum => !completedAllocQuestionSet.has(qNum));
            if (hasMissingAllocation) {
                return { isReleased: false };
            }
        } else if (allocations.length > 0) {
            // Whole-script allocation for question-wise grading must be COMPLETED
            const hasCompletedWholeAlloc = allocations.some(a => a.question == null && a.status === AllocationStatus.COMPLETED);
            if (!hasCompletedWholeAlloc) {
                return { isReleased: false };
            }
        }

        const maxMarks = rubric.questions.reduce((sum, q) => sum + (Number(q.maxMarks) || 0), 0);
        if (maxMarks <= 0) {
            return { isReleased: false };
        }

        // Compute total score across all finalized question grades
        const total = grades.reduce((sum, g) => sum + (Number(g.totalScore) || 0), 0);
        const roundedTotal = Math.round(total * 100) / 100;

        return {
            isReleased: true,
            total: roundedTotal,
            scriptId: script._id.toString(),
            maxMarks: Math.round(maxMarks * 100) / 100
        };
    }

    /**
     * Retrieves the results list for the authenticated student.
     * Only returns exams that are active and PUBLISHED where the student is enrolled.
     * Scores are included only when all release criteria are fulfilled.
     */
    async getStudentResults(actingUserId?: string, actingUserRole?: string): Promise<StudentResultItemDto[]> {
        const student = await this.validateStudentAccess(actingUserId, actingUserRole);

        // Find enrolled published exams for this student
        const studentMappings = await StudentMapping.find({ student: student._id });
        const enrolledExamIds = new Set(studentMappings.map(m => m.exam.toString()));

        const assignedScriptExamIds = await AnswerScript.distinct('exam', {
            student: student._id,
            isActive: true
        });
        for (const examId of assignedScriptExamIds) {
            enrolledExamIds.add(examId.toString());
        }

        const enrolledCourses = await Course.find({ enrolledStudents: student._id, isActive: true });
        const enrolledCourseIds = enrolledCourses.map(c => c._id);

        const examQuery: mongoose.QueryFilter<IExam> = {
            isActive: true,
            status: ExamStatus.PUBLISHED,
            $or: [
                { _id: { $in: Array.from(enrolledExamIds, id => new mongoose.Types.ObjectId(id)) } },
                { course: { $in: enrolledCourseIds } }
            ]
        };

        const exams = await Exam.find(examQuery)
            .sort({ examDate: -1, createdAt: -1 })
            .populate<{ course: ICourse }>('course');

        const results: StudentResultItemDto[] = [];

        for (const exam of exams) {
            const courseCode = exam.course && typeof exam.course === 'object' && 'courseCode' in exam.course
                ? exam.course.courseCode
                : '';

            // Find the student's script for this exam
            const script = await AnswerScript.findOne({
                exam: exam._id,
                student: student._id,
                isActive: true
            });

            const { isReleased, total, scriptId, maxMarks } = await this.evaluateReleaseConditions(
                student._id as mongoose.Types.ObjectId,
                exam,
                script
            );

            if (isReleased && total !== undefined && scriptId && maxMarks !== undefined) {
                results.push({
                    examId: exam._id.toString(),
                    examTitle: exam.title,
                    courseCode,
                    examDate: exam.examDate,
                    status: 'RELEASED',
                    scriptId,
                    total,
                    maxMarks
                });
            } else {
                results.push({
                    examId: exam._id.toString(),
                    examTitle: exam.title,
                    courseCode,
                    examDate: exam.examDate,
                    status: 'NOT_AVAILABLE'
                });
            }
        }

        return results;
    }

    /**
     * Verifies student ownership and release conditions for a specific answer script (AE-183).
     * Returns student, script, and exam documents if authorized and released.
     * Throws generic 404 HttpError on any failure or missing resource to prevent information leakage.
     */
    async verifyStudentScriptAccess(
        scriptId: string,
        actingUserId?: string,
        actingUserRole?: string
    ): Promise<{ student: IUser; script: IAnswerScript; exam: IExam }> {
        const student = await this.validateStudentAccess(actingUserId, actingUserRole);

        if (!scriptId || !mongoose.Types.ObjectId.isValid(scriptId)) {
            throw new HttpError('Not found', 404);
        }

        const script = await AnswerScript.findOne({
            _id: new mongoose.Types.ObjectId(scriptId),
            isActive: true
        });

        if (!script) {
            throw new HttpError('Not found', 404);
        }

        // Script must belong to the authenticated student
        if (!script.student || script.student.toString() !== student._id.toString()) {
            throw new HttpError('Not found', 404);
        }

        const exam = await Exam.findOne({
            _id: script.exam,
            isActive: true,
            status: ExamStatus.PUBLISHED
        });

        if (!exam) {
            throw new HttpError('Not found', 404);
        }

        const { isReleased } = await this.evaluateReleaseConditions(
            student._id as mongoose.Types.ObjectId,
            exam,
            script
        );

        if (!isReleased) {
            throw new HttpError('Not found', 404);
        }

        return { student, script, exam };
    }

    /**
     * Retrieves itemized scores and per-question/criterion feedback for an answer script (AE-184).
     * Enforces student ownership and release conditions via verifyStudentScriptAccess.
     * Obtains maxMarks and criterion points from the rubric version referenced by each persisted grade.
     * Computes the response total on the server from persisted Grade.totalScore.
     * Strictly excludes sensitive and internal grading metadata.
     */
    async getItemizedStudentResult(
        scriptId: string,
        actingUserId?: string,
        actingUserRole?: string
    ): Promise<ItemizedResultDto> {
        const { script, exam } = await this.verifyStudentScriptAccess(
            scriptId,
            actingUserId,
            actingUserRole
        );

        const grades = await Grade.find({ answerScript: script._id }).lean();
        if (!grades || grades.length === 0) {
            throw new HttpError('Not found', 404);
        }

        const isWholeScript = grades.some(g => g.question === null || g.question === undefined);
        const mode: 'QUESTION' | 'WHOLE' = isWholeScript ? 'WHOLE' : 'QUESTION';

        const rubricCache = new Map<string, IRubric>();
        const getRubric = async (rubricId: mongoose.Types.ObjectId | string): Promise<IRubric> => {
            const idStr = rubricId.toString();
            const cached = rubricCache.get(idStr);
            if (cached) {
                return cached;
            }
            const r = await Rubric.findById(rubricId).lean();
            if (!r) {
                throw new HttpError('Not found', 404);
            }
            rubricCache.set(idStr, r as unknown as IRubric);
            return r as unknown as IRubric;
        };

        const questions: QuestionResultDto[] = [];

        if (mode === 'QUESTION') {
            const sortedGrades = [...grades].sort(
                (a, b) => (Number(a.question) || 0) - (Number(b.question) || 0)
            );

            for (const grade of sortedGrades) {
                if (!grade.rubric) {
                    throw new HttpError('Not found', 404);
                }
                const rubric = await getRubric(grade.rubric);
                const rubricQuestion = rubric.questions?.find(
                    q => q.questionNumber === grade.question
                );
                if (!rubricQuestion) {
                    throw new HttpError('Not found', 404);
                }

                const criteria: CriterionResultDto[] = (grade.marksAwarded || []).map(m => {
                    const rubricCriterion = rubricQuestion.criteria?.find(
                        c => c.criterionName === m.criterionName
                    );
                    if (!rubricCriterion) {
                        throw new HttpError('Not found', 404);
                    }
                    const critObj: CriterionResultDto = {
                        name: m.criterionName,
                        score: m.score,
                        points: rubricCriterion.points,
                    };
                    if (m.feedback && m.feedback.trim()) {
                        critObj.feedback = m.feedback.trim();
                    }
                    return critObj;
                });

                const qDto: QuestionResultDto = {
                    questionNumber: grade.question as number,
                    maxMarks: rubricQuestion.maxMarks,
                    awarded: grade.totalScore,
                    criteria,
                };
                if (grade.feedback && grade.feedback.trim()) {
                    qDto.feedback = grade.feedback.trim();
                }

                questions.push(qDto);
            }
        } else {
            // Whole script mode
            const grade = grades[0];
            if (!grade.rubric) {
                throw new HttpError('Not found', 404);
            }
            const rubric = await getRubric(grade.rubric);
            const allRubricCriteria = (rubric.questions || []).flatMap(q => q.criteria || []);
            const totalRubricMarks = (rubric.questions || []).reduce(
                (sum, q) => sum + (Number(q.maxMarks) || 0),
                0
            );

            const criteria: CriterionResultDto[] = (grade.marksAwarded || []).map(m => {
                const rubricCriterion = allRubricCriteria.find(
                    c => c.criterionName === m.criterionName
                );
                if (!rubricCriterion) {
                    throw new HttpError('Not found', 404);
                }
                const critObj: CriterionResultDto = {
                    name: m.criterionName,
                    score: m.score,
                    points: rubricCriterion.points,
                };
                if (m.feedback && m.feedback.trim()) {
                    critObj.feedback = m.feedback.trim();
                }
                return critObj;
            });

            const qDto: QuestionResultDto = {
                questionNumber: null,
                maxMarks: totalRubricMarks,
                awarded: grade.totalScore,
                criteria,
            };
            if (grade.feedback && grade.feedback.trim()) {
                qDto.feedback = grade.feedback.trim();
            }

            questions.push(qDto);
        }

        const total = Math.round(
            grades.reduce((sum, g) => sum + (Number(g.totalScore) || 0), 0) * 100
        ) / 100;
        const maxTotal = questions.reduce((sum, q) => sum + (Number(q.maxMarks) || 0), 0);

        return {
            exam: {
                title: exam.title,
                totalMarks: exam.totalMarks,
            },
            mode,
            questions,
            total,
            maxTotal,
        };
    }
}

const studentResultService = new StudentResultService();
export default studentResultService;

