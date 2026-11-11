import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as apiAuth from '../lib/apiAuth';
import { UserRole } from '../constants/permissions';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import { calculateQuestionPerformance } from '../lib/stats';
import { GET } from '../app/api/analytics/exams/[id]/route';

describe('AE-213 question-level exam analytics', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('normalizes each question by its own maximum and ignores invalid grades', () => {
        expect(calculateQuestionPerformance(
            [
                { questionNumber: 1, maxMarks: 10 },
                { questionNumber: 2, maxMarks: 20 },
                { questionNumber: 3, maxMarks: 0 }
            ],
            [
                { questionNumber: 1, score: 5, maxMarks: 10 },
                { questionNumber: 1, score: 10, maxMarks: 10 },
                { questionNumber: 1, score: 11, maxMarks: 10 },
                { questionNumber: 2, score: 10, maxMarks: 20 },
                { questionNumber: 2, score: 15, maxMarks: 20 },
                { questionNumber: 3, score: 0, maxMarks: 0 },
                { questionNumber: 4, score: 5, maxMarks: 10 }
            ]
        )).toEqual([
            {
                questionNumber: 1,
                maxMarks: 10,
                gradedCount: 2,
                meanScorePercentage: 75,
                standardDeviationPercentagePoints: 25,
                difficultyIndexPercentage: 25
            },
            {
                questionNumber: 2,
                maxMarks: 20,
                gradedCount: 2,
                meanScorePercentage: 62.5,
                standardDeviationPercentagePoints: 12.5,
                difficultyIndexPercentage: 37.5
            },
            {
                questionNumber: 3,
                maxMarks: 0,
                gradedCount: 0,
                meanScorePercentage: null,
                standardDeviationPercentagePoints: null,
                difficultyIndexPercentage: null
            }
        ]);
    });

    it('returns question analytics only from released question grades', async () => {
        const professor = await User.create({
            name: 'Question Analytics Professor',
            email: 'question-analytics-professor@example.test',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        const students = await Promise.all([1, 2].map(index => User.create({
            name: `Question Analytics Student ${index}`,
            email: `question-analytics-student-${index}@example.test`,
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        })));
        const course = await Course.create({
            courseCode: 'QANA-213',
            courseName: 'Question Analytics',
            academicYear: '2026-2027',
            semester: 1,
            professor: professor._id,
            enrolledStudents: students.map(student => student._id),
            teachingAssistants: [],
            isActive: true
        });
        const exam = await Exam.create({
            title: 'Question Analytics Exam',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date('2026-11-04'),
            totalMarks: 30,
            numberOfQuestions: 2,
            status: ExamStatus.PUBLISHED,
            isActive: true
        });
        const rubric = await Rubric.create({
            exam: exam._id,
            createdBy: professor._id,
            scoreStep: 0.5,
            questions: [
                { questionNumber: 1, maxMarks: 10, criteria: [{ criterionName: 'Q1', points: 10 }] },
                { questionNumber: 2, maxMarks: 20, criteria: [{ criterionName: 'Q2', points: 20 }] }
            ],
            isActive: true
        });
        await Exam.findByIdAndUpdate(exam._id, { rubric: rubric._id });

        for (const [index, scores] of [
            [0, [5, 10]],
            [1, [10, 15]]
        ] as const) {
            const script = await AnswerScript.create({
                exam: exam._id,
                student: students[index]._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create([
                {
                    answerScript: script._id,
                    rubric: rubric._id,
                    gradedBy: professor._id,
                    question: 1,
                    marksAwarded: [{ criterionName: 'Q1', score: scores[0] }],
                    totalScore: scores[0],
                    isFinal: true
                },
                {
                    answerScript: script._id,
                    rubric: rubric._id,
                    gradedBy: professor._id,
                    question: 2,
                    marksAwarded: [{ criterionName: 'Q2', score: scores[1] }],
                    totalScore: scores[1],
                    isFinal: true
                }
            ]);
        }

        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            response: null,
            user: {
                id: professor._id.toString(),
                email: professor.email,
                name: professor.name,
                role: UserRole.PROFESSOR
            }
        });
        const response = await GET(
            new NextRequest(`http://localhost/api/analytics/exams/${exam._id}`),
            { params: Promise.resolve({ id: exam._id.toString() }) }
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.questionStatistics).toEqual([
            {
                questionNumber: 1,
                maxMarks: 10,
                gradedCount: 2,
                meanScorePercentage: 75,
                standardDeviationPercentagePoints: 25,
                difficultyIndexPercentage: 25
            },
            {
                questionNumber: 2,
                maxMarks: 20,
                gradedCount: 2,
                meanScorePercentage: 62.5,
                standardDeviationPercentagePoints: 12.5,
                difficultyIndexPercentage: 37.5
            }
        ]);
        expect(body.data.questionMetric.difficultyFormula).toContain('100 - mean score percentage');
    });
});
