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
import { calculateDescriptiveStatistics } from '../lib/stats';
import { GET } from '../app/api/analytics/exams/[id]/route';

describe('AE-210 exam statistics', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calculates descriptive statistics for a known released-score cohort', async () => {
        const professor = await User.create({
            name: 'Professor',
            email: 'analytics-professor@example.test',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        const students = await Promise.all([1, 2, 3, 4].map(index => User.create({
            name: `Student ${index}`,
            email: `analytics-student-${index}@example.test`,
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        })));
        const course = await Course.create({
            courseCode: 'STAT-101',
            courseName: 'Statistics',
            academicYear: '2026-2027',
            semester: 1,
            professor: professor._id,
            enrolledStudents: students.map(student => student._id),
            teachingAssistants: [],
            isActive: true
        });
        const exam = await Exam.create({
            title: 'Statistics Midterm',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date('2026-11-01'),
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

        for (const [index, score] of [2, 4, 6].entries()) {
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
                gradedBy: professor._id,
                marksAwarded: [{ criterionName: 'Accuracy', score }],
                totalScore: score,
                isFinal: true
            });
        }

        const incompleteScript = await AnswerScript.create({
            exam: exam._id,
            student: students[3]._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });
        await Grade.create({
            answerScript: incompleteScript._id,
            rubric: rubric._id,
            gradedBy: professor._id,
            marksAwarded: [{ criterionName: 'Accuracy', score: 9 }],
            totalScore: 9,
            isFinal: false
        });

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
        expect(body.data.classStatistics).toMatchObject({
            count: 3,
            mean: 4,
            median: 4,
            standardDeviationMethod: 'population'
        });
        expect(body.data.classStatistics.standardDeviation).toBeCloseTo(Math.sqrt(8 / 3), 10);
    });

    it('returns null metrics for an empty cohort and restricts access to authorized owners', async () => {
        const owner = await User.create({
            name: 'Owner',
            email: 'analytics-owner@example.test',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        const otherProfessor = await User.create({
            name: 'Other Professor',
            email: 'analytics-other@example.test',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        const course = await Course.create({
            courseCode: 'STAT-102',
            courseName: 'Statistics II',
            academicYear: '2026-2027',
            semester: 1,
            professor: owner._id,
            enrolledStudents: [],
            teachingAssistants: [],
            isActive: true
        });
        const exam = await Exam.create({
            title: 'Empty Cohort Exam',
            course: course._id,
            createdBy: owner._id,
            examDate: new Date('2026-11-02'),
            totalMarks: 10,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            isActive: true
        });
        const authorized = vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            response: null,
            user: {
                id: owner._id.toString(),
                email: owner.email,
                name: owner.name,
                role: UserRole.PROFESSOR
            }
        });

        const response = await GET(
            new NextRequest(`http://localhost/api/analytics/exams/${exam._id}`),
            { params: Promise.resolve({ id: exam._id.toString() }) }
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.classStatistics).toEqual({
            count: 0,
            mean: null,
            median: null,
            standardDeviation: null,
            standardDeviationMethod: 'population'
        });

        authorized.mockResolvedValue({
            authorized: true,
            response: null,
            user: {
                id: otherProfessor._id.toString(),
                email: otherProfessor.email,
                name: otherProfessor.name,
                role: UserRole.PROFESSOR
            }
        });
        const denied = await GET(
            new NextRequest(`http://localhost/api/analytics/exams/${exam._id}`),
            { params: Promise.resolve({ id: exam._id.toString() }) }
        );
        expect(denied.status).toBe(404);
    });

    it('uses the population standard deviation and ignores missing numeric scores', () => {
        expect(calculateDescriptiveStatistics([1, Number.NaN, 3])).toEqual({
            count: 2,
            mean: 2,
            median: 2,
            standardDeviation: 1
        });
        expect(calculateDescriptiveStatistics([])).toEqual({
            count: 0,
            mean: null,
            median: null,
            standardDeviation: null
        });
    });
});
