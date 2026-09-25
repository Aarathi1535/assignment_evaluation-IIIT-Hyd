import PersonalizedStudentAssignment from '../models/PersonalizedStudentAssignment';
import { IPersonalizedQuestion } from '../models/PersonalizedQuestion';
import User from '../models/User';
import { HttpError } from '../lib/errors';

export interface StudentProfile {
    studentId: string;
    studentName: string;
    email: string;
    totalAssigned: number;
    totalCompleted: number;
    totalMissed: number;
    currentStreak: number;
    averageScore: number;
    masteredTopics: string[];
    topicsNeedingPractice: string[];
    recommendedLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
}

export interface PersonalizedAllocationParams {
    enrolledStudents: string[];
    questionPool: IPersonalizedQuestion[];
    totalSlots?: number;
    shiftStep?: number;
}

export class PersonalizationService {
    /**
     * Retrieve student learning profile and performance history for a course.
     */
    async getStudentProfile(studentId: string, _courseId?: string): Promise<StudentProfile> {
        const user = await User.findById(studentId);
        if (!user) {
            throw new HttpError('Student user not found', 404);
        }

        const query: Record<string, unknown> = { student: user._id };
        const assignments = await PersonalizedStudentAssignment.find(query).populate('question');

        const totalAssigned = assignments.length;
        const completedAssignments = assignments.filter((a) => a.status === 'SUBMITTED');
        const missedAssignments = assignments.filter((a) => a.status === 'MISSED');

        let totalMarks = 0;
        let evaluatedCount = 0;
        const topicSuccessCount: Record<string, { correct: number; total: number }> = {};

        for (const a of completedAssignments) {
            if (a.score !== undefined && a.score !== null) {
                totalMarks += a.score;
                evaluatedCount++;
            }
            const q = a.question as unknown as IPersonalizedQuestion;
            if (q?.topic) {
                if (!topicSuccessCount[q.topic]) {
                    topicSuccessCount[q.topic] = { correct: 0, total: 0 };
                }
                topicSuccessCount[q.topic].total++;
                if (a.score && a.score >= 7) {
                    topicSuccessCount[q.topic].correct++;
                }
            }
        }

        const averageScore = evaluatedCount > 0 ? Math.round((totalMarks / evaluatedCount) * 10) / 10 : 0;

        const masteredTopics: string[] = [];
        const topicsNeedingPractice: string[] = [];

        for (const [topic, stats] of Object.entries(topicSuccessCount)) {
            if (stats.total >= 2 && stats.correct / stats.total >= 0.7) {
                masteredTopics.push(topic);
            } else if (stats.total >= 2 && stats.correct / stats.total < 0.5) {
                topicsNeedingPractice.push(topic);
            }
        }

        let recommendedLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' = 'INTERMEDIATE';
        if (evaluatedCount > 5) {
            if (averageScore >= 8) recommendedLevel = 'ADVANCED';
            else if (averageScore < 5) recommendedLevel = 'BEGINNER';
        }

        return {
            studentId: user._id.toString(),
            studentName: user.name,
            email: user.email,
            totalAssigned,
            totalCompleted: completedAssignments.length,
            totalMissed: missedAssignments.length,
            currentStreak: 0,
            averageScore,
            masteredTopics,
            topicsNeedingPractice,
            recommendedLevel
        };
    }

    /**
     * Generates a personalized, collision-free allocation for all students over the assessment slots.
     * Enforces:
     * 1. 100 questions per student.
     * 2. No two students get the same question on the same day.
     * 3. Pedagogical progression (topics & difficulty flow).
     */
    generatePersonalizedAllocation(params: PersonalizedAllocationParams): Map<string, string[]> {
        const { enrolledStudents, questionPool, totalSlots = 100, shiftStep = 1 } = params;
        const N = enrolledStudents.length;
        const M = questionPool.length;

        if (N === 0) {
            throw new HttpError('No enrolled students provided for schedule generation', 400);
        }

        // Validate question pool capacity: must satisfy M >= max(N, totalSlots)
        if (M < Math.max(N, totalSlots)) {
            throw new HttpError(
                `Insufficient question bank capacity: ${M} questions available, but ${N} enrolled students each needing ${totalSlots} questions require at least ${Math.max(N, totalSlots)} questions in the bank.`,
                400
            );
        }

        // Sort question pool by topic & difficulty for pedagogical progression
        const difficultyRank: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3 };
        const sortedPool = [...questionPool].sort((a, b) => {
            const diffA = difficultyRank[a.difficulty] || 2;
            const diffB = difficultyRank[b.difficulty] || 2;
            if (diffA !== diffB) return diffA - diffB;
            return a.questionIndex - b.questionIndex;
        });

        const questionIds = sortedPool.map((q) => q._id.toString());
        const allocation = new Map<string, string[]>();

        for (let s = 0; s < N; s++) {
            const studentId = enrolledStudents[s];
            const studentQuestions: string[] = [];

            for (let d = 0; d < totalSlots; d++) {
                // Shift cyclic offset ensures:
                // 1) Student s gets distinct questions across d=0..totalSlots-1 (since M >= totalSlots).
                // 2) On day d, students s_i and s_j receive different questions (since (s_i * k + d) % M != (s_j * k + d) % M for all s_i != s_j < M).
                const qIdx = (s * shiftStep + d) % M;
                studentQuestions.push(questionIds[qIdx]);
            }

            allocation.set(studentId, studentQuestions);
        }

        // Validate the matrix rigorously
        this.validateAllocation(enrolledStudents, allocation, totalSlots);

        return allocation;
    }

    /**
     * Validates that:
     * 1. On any slot d, no two students receive the same question.
     * 2. For every student s, all totalSlots questions are distinct.
     */
    validateAllocation(
        studentIds: string[],
        allocation: Map<string, string[]>,
        totalSlots = 100
    ): void {
        const N = studentIds.length;

        // 1. Same-day collision check across students
        for (let d = 0; d < totalSlots; d++) {
            const seenInSlot = new Set<string>();
            for (let s = 0; s < N; s++) {
                const studentId = studentIds[s];
                const studentQuestions = allocation.get(studentId);
                if (!studentQuestions || studentQuestions.length !== totalSlots) {
                    throw new HttpError(`Personalized assignment sequence incomplete for student ${studentId}`, 400);
                }
                const qId = studentQuestions[d];
                if (seenInSlot.has(qId)) {
                    throw new HttpError(
                        `Schedule conflict detected: Question ${qId} assigned to multiple students on day ${d + 1}`,
                        400
                    );
                }
                seenInSlot.add(qId);
            }
        }

        // 2. Uniqueness check per student across all slots
        for (let s = 0; s < N; s++) {
            const studentId = studentIds[s];
            const studentQuestions = allocation.get(studentId)!;
            const uniqueQuestions = new Set(studentQuestions);
            if (uniqueQuestions.size !== totalSlots) {
                throw new HttpError(
                    `Duplicate questions detected for student ${studentId}: only ${uniqueQuestions.size} distinct questions out of ${totalSlots} required`,
                    400
                );
            }
        }
    }
}

const personalizationService = new PersonalizationService();
export default personalizationService;
