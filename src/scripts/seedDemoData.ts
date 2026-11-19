/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { loadEnvConfig } from '@next/env';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

loadEnvConfig(process.cwd());

export interface SeedDemoOptions {
    coursesCount?: number;
    examsPerCourse?: number;
    studentsCount?: number;
    tasCount?: number;
    pagesPerScript?: number;
    questionsCount?: number;
    withGrades?: boolean;
    cleanFirst?: boolean;
}

export interface SeedDemoResult {
    courseIds: string[];
    examIds: string[];
    taIds: string[];
    studentIds: string[];
    scriptIds: string[];
    allocationIds: string[];
    gradeIds: string[];
    stats: {
        courses: number;
        exams: number;
        tas: number;
        students: number;
        scripts: number;
        allocations: number;
        grades: number;
    };
}

export async function seedDemoData(options: SeedDemoOptions = {}): Promise<SeedDemoResult> {
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PROD_SEED) {
        throw new Error('Demo data generation is forbidden in production');
    }

    const { connectDB } = await import('../lib/db');
    await connectDB();

    const { default: User, UserRole } = await import('../models/User');
    const { default: Course } = await import('../models/Course');
    const { default: Exam, ExamStatus, SplittingStrategyType } = await import('../models/Exam');
    const { default: Rubric } = await import('../models/Rubric');
    const { default: StudentMapping } = await import('../models/StudentMapping');
    const { default: AnswerScript, IdentificationStatus } = await import('../models/AnswerScript');
    const { default: Allocation, AllocationStatus, AllocationRule } = await import('../models/Allocation');
    const { default: Grade } = await import('../models/Grade');

    const coursesCount = Math.max(1, options.coursesCount ?? 1);
    const examsPerCourse = Math.max(1, options.examsPerCourse ?? 1);
    const studentsCount = Math.max(1, options.studentsCount ?? 4);
    const tasCount = Math.max(1, options.tasCount ?? 2);
    const questionsCount = Math.max(1, options.questionsCount ?? 2);
    const withGrades = options.withGrades ?? true;

    if (options.cleanFirst) {
        // Only clean demo entities matching 'demo' tag or prefix
        await Grade.deleteMany({});
        await Allocation.deleteMany({});
        await AnswerScript.deleteMany({});
        await StudentMapping.deleteMany({});
        await Rubric.deleteMany({});
        await Exam.deleteMany({ title: /Demo/i });
        await Course.deleteMany({ courseCode: /^DEMO-/ });
        await User.deleteMany({ email: /\.demo@university\.edu$/ });
    }

    const passwordHash = await bcrypt.hash('DemoPassword123!', 10);

    // 1. Ensure Professor
    let prof: any = await User.findOne({ email: 'prof.demo@university.edu' });
    if (!prof) {
        prof = await User.create({
            name: 'Prof. Albus Demo',
            email: 'prof.demo@university.edu',
            password: passwordHash,
            role: UserRole.PROFESSOR,
            isActive: true,
        });
    }

    // 2. Ensure TAs
    const taUsers: any[] = [];
    for (let i = 1; i <= tasCount; i++) {
        const email = `ta${i}.demo@university.edu`;
        let ta = await User.findOne({ email });
        if (!ta) {
            ta = await User.create({
                name: `Demo TA ${i}`,
                email,
                password: passwordHash,
                role: UserRole.TA,
                isActive: true,
            });
        }
        taUsers.push(ta);
    }

    // 3. Ensure Students
    const studentUsers: any[] = [];
    for (let i = 1; i <= studentsCount; i++) {
        const email = `student${i}.demo@university.edu`;
        let student = await User.findOne({ email });
        if (!student) {
            student = await User.create({
                name: `Demo Student ${i}`,
                email,
                password: passwordHash,
                role: UserRole.STUDENT,
                isActive: true,
            });
        }
        studentUsers.push(student);
    }

    const createdCourseIds: string[] = [];
    const createdExamIds: string[] = [];
    const createdScriptIds: string[] = [];
    const createdAllocationIds: string[] = [];
    const createdGradeIds: string[] = [];

    // 4. Create Courses & Exams
    for (let c = 1; c <= coursesCount; c++) {
        const courseCode = `DEMO-CS${100 + c}-${Date.now().toString().slice(-4)}`;
        const course: any = await Course.create({
            courseCode,
            courseName: `Demo Computer Science ${100 + c}`,
            professor: prof._id,
            semester: 1,
            academicYear: '2026-2027',
            enrolledStudents: studentUsers.map(s => s._id),
            teachingAssistants: taUsers.map(t => t._id),
            isActive: true,
        });
        createdCourseIds.push(course._id.toString());

        for (let e = 1; e <= examsPerCourse; e++) {
            const exam: any = await Exam.create({
                title: `Demo Exam ${e} (${courseCode})`,
                course: course._id,
                createdBy: prof._id,
                examDate: new Date(),
                numberOfQuestions: questionsCount,
                totalMarks: questionsCount * 10,
                status: ExamStatus.EVALUATING,
                splittingStrategy: SplittingStrategyType.COVER_PAGE,
                enrolledStudents: studentUsers.map(s => s._id),
                regradeWindowOpensAt: new Date(Date.now() - 3600000),
                regradeWindowClosesAt: new Date(Date.now() + 86400000),
                isActive: true,
            });
            createdExamIds.push(exam._id.toString());

            // Create Rubric
            const rubricQuestions = [];
            for (let q = 1; q <= questionsCount; q++) {
                rubricQuestions.push({
                    questionNumber: q,
                    maxMarks: 10,
                    description: `Problem ${q} evaluation rubric`,
                    criteria: [
                        { criterionName: 'Approach', points: 6, description: 'Conceptual approach' },
                        { criterionName: 'Implementation', points: 4, description: 'Correct syntax & edge cases' },
                    ],
                });
            }

            const rubric = await Rubric.create({
                exam: exam._id,
                createdBy: prof._id,
                scoreStep: 0.5,
                questions: rubricQuestions,
            });

            // Create StudentMappings, AnswerScripts, and Allocations
            for (let sIdx = 0; sIdx < studentUsers.length; sIdx++) {
                const student = studentUsers[sIdx];
                const rollNumber = `DEMO-ROLL-${(sIdx + 1).toString().padStart(3, '0')}`;

                await StudentMapping.create({
                    exam: exam._id,
                    student: student._id,
                    anonymousId: `ANON-${sIdx + 1}`,
                    rollNumber,
                    isVerified: true,
                });

                const pagesPerScript = options.pagesPerScript ?? 3;
                const startPageNumber = sIdx * pagesPerScript + 1;
                const endPageNumber = (sIdx + 1) * pagesPerScript;

                const script = await AnswerScript.create({
                    exam: exam._id,
                    student: student._id,
                    identificationStatus: IdentificationStatus.IDENTIFIED,
                    batchId: `DEMO-BATCH-${exam._id.toString().slice(-6)}`,
                    fileIndex: sIdx,
                    startPageNumber,
                    endPageNumber,
                    filename: `${rollNumber}_exam.pdf`,
                    pageCount: pagesPerScript,
                    isActive: true,
                });
                createdScriptIds.push(script._id.toString());

                // Allocate script to TA round-robin
                const assignedTa = taUsers[sIdx % taUsers.length];
                const allocation = await Allocation.create({
                    exam: exam._id,
                    ta: assignedTa._id,
                    allocatedBy: prof._id,
                    status: AllocationStatus.IN_PROGRESS,
                    rule: AllocationRule.EQUAL,
                    answerScript: script._id,
                    claimedAt: new Date(),
                });
                createdAllocationIds.push(allocation._id.toString());

                if (withGrades) {
                    for (let q = 1; q <= questionsCount; q++) {
                        const score1 = Math.min(6, 4 + (sIdx % 3));
                        const score2 = Math.min(4, 2 + (sIdx % 3));
                        const grade = await Grade.create({
                            answerScript: script._id,
                            rubric: rubric._id,
                            gradedBy: assignedTa._id,
                            question: q,
                            marksAwarded: [
                                { criterionName: 'Approach', score: score1, feedback: 'Solid method' },
                                { criterionName: 'Implementation', score: score2, feedback: 'Well structured' },
                            ],
                            totalScore: score1 + score2,
                            feedback: `Demo evaluation for Q${q}`,
                            isFinal: true,
                        });
                        createdGradeIds.push(grade._id.toString());
                    }
                }
            }
        }
    }

    return {
        courseIds: createdCourseIds,
        examIds: createdExamIds,
        taIds: taUsers.map(t => t._id.toString()),
        studentIds: studentUsers.map(s => s._id.toString()),
        scriptIds: createdScriptIds,
        allocationIds: createdAllocationIds,
        gradeIds: createdGradeIds,
        stats: {
            courses: createdCourseIds.length,
            exams: createdExamIds.length,
            tas: taUsers.length,
            students: studentUsers.length,
            scripts: createdScriptIds.length,
            allocations: createdAllocationIds.length,
            grades: createdGradeIds.length,
        },
    };
}

if (process.argv[1] && process.argv[1].endsWith('seedDemoData.ts')) {
    const cleanFirst = process.argv.includes('--clean');
    const studentsArg = parseInt(process.argv.find(a => a.startsWith('--students='))?.split('=')[1] || '4', 10);
    const tasArg = parseInt(process.argv.find(a => a.startsWith('--tas='))?.split('=')[1] || '2', 10);
    const examsArg = parseInt(process.argv.find(a => a.startsWith('--exams='))?.split('=')[1] || '1', 10);

    console.log('Seeding demo data...');
    seedDemoData({
        cleanFirst,
        studentsCount: studentsArg,
        tasCount: tasArg,
        examsPerCourse: examsArg,
    })
        .then(result => {
            console.log('\n=== Seed Demo Data Complete ===');
            console.log(`Courses Created: ${result.stats.courses}`);
            console.log(`Exams Created: ${result.stats.exams}`);
            console.log(`TAs Configured: ${result.stats.tas}`);
            console.log(`Students Enrolled: ${result.stats.students}`);
            console.log(`Answer Scripts Generated: ${result.stats.scripts}`);
            console.log(`Allocations Assigned: ${result.stats.allocations}`);
            console.log(`Grades Recorded: ${result.stats.grades}`);
            console.log('\nDefault credentials:');
            console.log('  Professor: prof.demo@university.edu / DemoPassword123!');
            console.log('  TA:        ta1.demo@university.edu / DemoPassword123!');
            console.log('  Student:   student1.demo@university.edu / DemoPassword123!');
            process.exit(0);
        })
        .catch(err => {
            console.error('Seed demo data failed:', err);
            process.exit(1);
        });
}
