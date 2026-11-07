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
import { GET } from '../app/api/analytics/exams/[id]/graders/route';
import {
    calculateGraderConsistency,
    MIN_GRADER_CONSISTENCY_SAMPLE_SIZE
} from '../lib/stats';

describe('AE-211 TA grading consistency metric', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('compares graders only within equivalent rubric-question groups', () => {
        const metrics = calculateGraderConsistency([
            { graderId: 'ta-a', comparableGroup: 'rubric-1:q1', scorePercentage: 40 },
            { graderId: 'ta-b', comparableGroup: 'rubric-1:q1', scorePercentage: 60 },
            { graderId: 'ta-a', comparableGroup: 'rubric-1:q1', scorePercentage: 50 },
            { graderId: 'ta-b', comparableGroup: 'rubric-1:q1', scorePercentage: 50 },
            { graderId: 'ta-a', comparableGroup: 'rubric-2:q1', scorePercentage: 0 }
        ]);

        expect(metrics).toEqual([
            {
                graderId: 'ta-a',
                comparisonCount: 2,
                meanAbsoluteDeviationPercentagePoints: 5,
                sampleSizeStatus: 'INSUFFICIENT'
            },
            {
                graderId: 'ta-b',
                comparisonCount: 2,
                meanAbsoluteDeviationPercentagePoints: 5,
                sampleSizeStatus: 'INSUFFICIENT'
            }
        ]);
    });

    it('marks adequately sized samples and ignores missing or invalid observations', () => {
        const observations = Array.from({ length: MIN_GRADER_CONSISTENCY_SAMPLE_SIZE }, (_, index) => [
            { graderId: 'ta-a', comparableGroup: 'rubric-1:q2', scorePercentage: 40 + index },
            { graderId: 'ta-b', comparableGroup: 'rubric-1:q2', scorePercentage: 60 - index }
        ]).flat();
        observations.push(
            { graderId: 'ta-a', comparableGroup: 'rubric-1:q2', scorePercentage: Number.NaN },
            { graderId: 'ta-a', comparableGroup: 'rubric-2:q2', scorePercentage: 50 }
        );

        expect(calculateGraderConsistency(observations)).toEqual([
            {
                graderId: 'ta-a',
                comparisonCount: MIN_GRADER_CONSISTENCY_SAMPLE_SIZE,
                meanAbsoluteDeviationPercentagePoints: 8,
                sampleSizeStatus: 'SUFFICIENT'
            },
            {
                graderId: 'ta-b',
                comparisonCount: MIN_GRADER_CONSISTENCY_SAMPLE_SIZE,
                meanAbsoluteDeviationPercentagePoints: 8,
                sampleSizeStatus: 'SUFFICIENT'
            }
        ]);
    });

    it('returns no metric when there is no comparable grading data', () => {
        expect(calculateGraderConsistency([])).toEqual([]);
        expect(calculateGraderConsistency([
            { graderId: 'ta-a', comparableGroup: 'rubric-1:q1', scorePercentage: 75 },
            { graderId: 'ta-a', comparableGroup: 'rubric-1:q2', scorePercentage: 80 }
        ])).toEqual([]);
    });

    it('rejects invalid minimum sample-size configuration', () => {
        expect(() => calculateGraderConsistency([], 0)).toThrow(
            'Minimum sample size must be a positive integer'
        );
    });

    it('reports released scores by TA and excludes unpublished grading work', async () => {
        const professor = await User.create({
            name: 'Consistency Professor',
            email: 'consistency-professor@example.test',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        const [taA, taB] = await Promise.all(['a', 'b'].map(suffix => User.create({
            name: `TA ${suffix.toUpperCase()}`,
            email: `consistency-ta-${suffix}@example.test`,
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        })));
        const students = await Promise.all([1, 2, 3].map(index => User.create({
            name: `Consistency Student ${index}`,
            email: `consistency-student-${index}@example.test`,
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        })));
        const course = await Course.create({
            courseCode: 'CONS-211',
            courseName: 'Grading Consistency',
            academicYear: '2026-2027',
            semester: 1,
            professor: professor._id,
            enrolledStudents: students.map(student => student._id),
            teachingAssistants: [taA._id, taB._id],
            isActive: true
        });
        const exam = await Exam.create({
            title: 'Consistency Exam',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date('2026-11-03'),
            totalMarks: 10,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            isActive: true
        });
        const rubric = await Rubric.create({
            exam: exam._id,
            createdBy: professor._id,
            scoreStep: 0.5,
            questions: [{
                questionNumber: 1,
                maxMarks: 10,
                criteria: [{ criterionName: 'Accuracy', points: 10 }]
            }],
            isActive: true
        });

        for (const [index, ta, score, isFinal] of [
            [0, taA, 4, true],
            [1, taB, 6, true],
            [2, taA, 10, false]
        ] as const) {
            const script = await AnswerScript.create({
                exam: exam._id,
                student: students[index]._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: script._id,
                rubric: rubric._id,
                gradedBy: ta._id,
                question: 1,
                marksAwarded: [{ criterionName: 'Accuracy', score }],
                totalScore: score,
                isFinal
            });
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
            new NextRequest(`http://localhost/api/analytics/exams/${exam._id}/graders`),
            { params: Promise.resolve({ id: exam._id.toString() }) }
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.metric.minimumSampleSize).toBe(MIN_GRADER_CONSISTENCY_SAMPLE_SIZE);
        expect(body.data.graders).toEqual(expect.arrayContaining([
            expect.objectContaining({
                graderId: taA._id.toString(),
                comparisonCount: 1,
                meanAbsoluteDeviationPercentagePoints: 10,
                sampleSizeStatus: 'INSUFFICIENT'
            }),
            expect.objectContaining({
                graderId: taB._id.toString(),
                comparisonCount: 1,
                meanAbsoluteDeviationPercentagePoints: 10,
                sampleSizeStatus: 'INSUFFICIENT'
            })
        ]));
    });
});
