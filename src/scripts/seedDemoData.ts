/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from '@next/env';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createCanvas } from '@napi-rs/canvas';
import defaultDerivedStorageService from '../services/DerivedStorageService';

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
    password?: string;
}

export interface SeedDemoResult {
    courseIds: string[];
    examIds: string[];
    taIds: string[];
    studentIds: string[];
    scriptIds: string[];
    allocationIds: string[];
    gradeIds: string[];
    pageIds: string[];
    generatedPassword?: string;
    stats: {
        courses: number;
        exams: number;
        tas: number;
        students: number;
        scripts: number;
        pages: number;
        allocations: number;
        grades: number;
    };
}

/**
 * Validates whether the target MongoDB host is permitted for demo data generation.
 * Only local development/test hosts or explicitly configured demo clusters are allowed.
 * Reject malformed URIs, unknown hosts, and substring matches.
 */
export function isDatabaseHostAllowed(uri?: string): boolean {
    if (!uri || typeof uri !== 'string') return false;
    try {
        const trimmed = uri.trim();
        if (!trimmed.startsWith('mongodb://') && !trimmed.startsWith('mongodb+srv://')) {
            return false;
        }

        const parsed = new URL(trimmed.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
        if (!parsed.host) return false;

        const hosts = parsed.host.split(',');
        const demoClusterHost = process.env.DEMO_CLUSTER_HOST?.toLowerCase().trim();

        return hosts.every(h => {
            if (!h) return false;
            let hostname = h.trim();
            if (hostname.startsWith('[')) {
                const closeBracketIdx = hostname.indexOf(']');
                if (closeBracketIdx !== -1) {
                    hostname = hostname.substring(1, closeBracketIdx);
                }
            } else {
                hostname = hostname.split(':')[0];
            }
            hostname = hostname.toLowerCase();

            return (
                hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname === '::1' ||
                (Boolean(demoClusterHost) && hostname === demoClusterHost)
            );
        });
    } catch {
        return false;
    }
}

/**
 * Generates synthetic page image buffer for demo AnswerScript pages.
 */
function createDemoPageBuffer(title: string, pageNumber: number, totalPages: number): Buffer {
    try {
        const canvas = createCanvas(800, 1000);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 800, 1000);

        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(title, 50, 70);

        ctx.fillStyle = '#64748b';
        ctx.font = '16px sans-serif';
        ctx.fillText(`Page ${pageNumber} of ${totalPages} - Demo Answer Sheet`, 50, 105);

        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(50, 130, 700, 820);

        ctx.fillStyle = '#334155';
        ctx.font = '14px sans-serif';
        ctx.fillText(`Question ${pageNumber}: Candidate Response`, 70, 170);
        ctx.fillText('------------------------------------------------------------', 70, 195);
        ctx.fillText('Demonstration answer text with verified handwriting and figures.', 70, 220);
        ctx.fillText('Step 1: Parse input parameters and validate preconditions.', 70, 250);
        ctx.fillText('Step 2: Apply dynamic programming recurrence relation.', 70, 280);
        ctx.fillText('Step 3: Return authoritative evaluated result.', 70, 310);

        return canvas.toBuffer('image/png');
    } catch {
        // Fallback minimal 1x1 valid PNG if canvas rendering is unavailable
        return Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64'
        );
    }
}

export async function seedDemoData(options: SeedDemoOptions = {}): Promise<SeedDemoResult> {
    // 1. Strict production & host allowlist guard
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Demo data generation is forbidden in production');
    }

    const mongoUri = process.env.MONGODB_URI;
    if (!isDatabaseHostAllowed(mongoUri)) {
        throw new Error(
            'Demo data generation is forbidden on non-allowlisted database hosts. Refusing connection to host outside allowlist (allowed: localhost, 127.0.0.1, or explicit demo cluster).'
        );
    }

    const { connectDB } = await import('../lib/db');
    await connectDB();

    const { default: User, UserRole } = await import('../models/User');
    const { default: Course } = await import('../models/Course');
    const { default: Exam, ExamStatus, SplittingStrategyType } = await import('../models/Exam');
    const { default: Rubric } = await import('../models/Rubric');
    const { default: StudentMapping } = await import('../models/StudentMapping');
    const { default: AnswerScript, IdentificationStatus } = await import('../models/AnswerScript');
    const { default: Page } = await import('../models/Page');
    const { default: Allocation, AllocationStatus, AllocationRule } = await import('../models/Allocation');
    const { default: Grade } = await import('../models/Grade');

    const coursesCount = Math.max(1, options.coursesCount ?? 1);
    const examsPerCourse = Math.max(1, options.examsPerCourse ?? 1);
    const studentsCount = Math.max(1, options.studentsCount ?? 4);
    const tasCount = Math.max(1, options.tasCount ?? 2);
    const questionsCount = Math.max(1, options.questionsCount ?? 2);
    const pagesPerScript = Math.max(1, options.pagesPerScript ?? 3);
    const withGrades = options.withGrades ?? true;

    // 2. Safe selective clean: ONLY delete records tagged by demo identifiers
    if (options.cleanFirst) {
        const demoCourses = await Course.find({ courseCode: /^DEMO-/ }).select('_id');
        const demoCourseIds = demoCourses.map(c => c._id);

        const demoExams = await Exam.find({
            course: { $in: demoCourseIds }
        }).select('_id');
        const demoExamIds = demoExams.map(e => e._id);

        const demoRubrics = await Rubric.find({ exam: { $in: demoExamIds } }).select('_id');
        const demoRubricIds = demoRubrics.map(r => r._id);

        const demoScripts = await AnswerScript.find({
            exam: { $in: demoExamIds }
        }).select('_id');
        const demoScriptIds = demoScripts.map(s => s._id);

        await Grade.deleteMany({
            $or: [{ answerScript: { $in: demoScriptIds } }, { rubric: { $in: demoRubricIds } }]
        });
        await Allocation.deleteMany({
            $or: [{ exam: { $in: demoExamIds } }, { answerScript: { $in: demoScriptIds } }]
        });
        await Page.deleteMany({ answerScript: { $in: demoScriptIds } });
        await AnswerScript.deleteMany({ _id: { $in: demoScriptIds } });
        await StudentMapping.deleteMany({ exam: { $in: demoExamIds } });
        await Rubric.deleteMany({ _id: { $in: demoRubricIds } });
        await Exam.deleteMany({ _id: { $in: demoExamIds } });
        await Course.deleteMany({ _id: { $in: demoCourseIds } });
        await User.deleteMany({ email: /\.demo@university\.edu$/ });
    }

    // 3. Dynamic or configured password
    const effectivePassword = options.password || process.env.DEMO_PASSWORD || (crypto.randomBytes(9).toString('base64url') + '!Aa1');
    const passwordHash = await bcrypt.hash(effectivePassword, 10);

    // 4. Ensure / Upsert Professor
    let prof: any = await User.findOne({ email: 'prof.demo@university.edu' });
    if (!prof) {
        prof = await User.create({
            name: 'Prof. Albus Demo',
            email: 'prof.demo@university.edu',
            password: passwordHash,
            role: UserRole.PROFESSOR,
            isActive: true,
        });
    } else {
        await User.updateOne({ _id: prof._id }, { $set: { password: passwordHash, isActive: true } });
    }

    // 5. Ensure / Upsert TAs
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
        } else {
            await User.updateOne({ _id: ta._id }, { $set: { password: passwordHash, isActive: true } });
        }
        taUsers.push(ta);
    }

    // 6. Ensure / Upsert Students
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
        } else {
            await User.updateOne({ _id: student._id }, { $set: { password: passwordHash, isActive: true } });
        }
        studentUsers.push(student);
    }

    const createdCourseIds: string[] = [];
    const createdExamIds: string[] = [];
    const createdScriptIds: string[] = [];
    const createdAllocationIds: string[] = [];
    const createdGradeIds: string[] = [];
    const createdPageIds: string[] = [];

    // 7. Idempotent Course & Exam Generation (Deterministic demo keys)
    for (let c = 1; c <= coursesCount; c++) {
        const courseCode = `DEMO-CS${100 + c}`;
        let course: any = await Course.findOne({ courseCode });
        if (!course) {
            course = await Course.create({
                courseCode,
                courseName: `Demo Computer Science ${100 + c}`,
                professor: prof._id,
                semester: 1,
                academicYear: '2026-2027',
                enrolledStudents: studentUsers.map(s => s._id),
                teachingAssistants: taUsers.map(t => t._id),
                isActive: true,
            });
        } else {
            await Course.updateOne(
                { _id: course._id },
                {
                    $set: {
                        professor: prof._id,
                        enrolledStudents: studentUsers.map(s => s._id),
                        teachingAssistants: taUsers.map(t => t._id),
                        isActive: true,
                    },
                }
            );
        }
        createdCourseIds.push(course._id.toString());

        for (let e = 1; e <= examsPerCourse; e++) {
            const examTitle = `Demo Exam ${e} (${courseCode})`;
            let exam: any = await Exam.findOne({ course: course._id, title: examTitle });
            if (!exam) {
                exam = await Exam.create({
                    title: examTitle,
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
            } else {
                await Exam.updateOne(
                    { _id: exam._id },
                    {
                        $set: {
                            numberOfQuestions: questionsCount,
                            totalMarks: questionsCount * 10,
                            enrolledStudents: studentUsers.map(s => s._id),
                            isActive: true,
                        },
                    }
                );
            }
            createdExamIds.push(exam._id.toString());

            // 8. Idempotent Rubric
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

            let rubric: any = await Rubric.findOne({ exam: exam._id });
            if (!rubric) {
                rubric = await Rubric.create({
                    exam: exam._id,
                    createdBy: prof._id,
                    scoreStep: 0.5,
                    questions: rubricQuestions,
                    isActive: true,
                });
            } else {
                await Rubric.updateOne(
                    { _id: rubric._id },
                    { $set: { questions: rubricQuestions, isActive: true } }
                );
            }

            // 9. Idempotent Student Mappings, Answer Scripts, Pages, Allocations, and Grades
            const batchId = `DEMO-BATCH-${exam._id.toString().slice(-6)}`;
            for (let sIdx = 0; sIdx < studentUsers.length; sIdx++) {
                const student = studentUsers[sIdx];
                const rollNumber = `DEMO-ROLL-${(sIdx + 1).toString().padStart(3, '0')}`;

                await StudentMapping.findOneAndUpdate(
                    { exam: exam._id, student: student._id },
                    {
                        $set: {
                            anonymousId: `ANON-${sIdx + 1}`,
                            rollNumber,
                            isVerified: true,
                        },
                    },
                    { upsert: true, new: true }
                );

                const startPageNumber = sIdx * pagesPerScript + 1;
                const endPageNumber = (sIdx + 1) * pagesPerScript;

                let script: any = await AnswerScript.findOne({ exam: exam._id, student: student._id });
                if (!script) {
                    script = await AnswerScript.create({
                        exam: exam._id,
                        student: student._id,
                        identificationStatus: IdentificationStatus.IDENTIFIED,
                        batchId,
                        fileIndex: sIdx,
                        startPageNumber,
                        endPageNumber,
                        filename: `${rollNumber}_exam.pdf`,
                        pageCount: pagesPerScript,
                        isActive: true,
                    });
                } else {
                    await AnswerScript.updateOne(
                        { _id: script._id },
                        {
                            $set: {
                                batchId,
                                fileIndex: sIdx,
                                startPageNumber,
                                endPageNumber,
                                filename: `${rollNumber}_exam.pdf`,
                                pageCount: pagesPerScript,
                                isActive: true,
                            },
                        }
                    );
                }
                createdScriptIds.push(script._id.toString());

                // Generate and persist Page documents and image files
                for (let p = 1; p <= pagesPerScript; p++) {
                    const pageBuffer = createDemoPageBuffer(examTitle, p, pagesPerScript);
                    const stored = await defaultDerivedStorageService.storeDerivedPage({
                        batchId: script.batchId,
                        fileId: script._id.toString(),
                        pageNumber: p,
                        buffer: pageBuffer,
                        format: 'png',
                    });

                    const pageDoc = await Page.findOneAndUpdate(
                        { answerScript: script._id, pageNumber: p },
                        {
                            $set: {
                                imagePath: stored.storageKey,
                                width: 800,
                                height: 1000,
                                isActive: true,
                            },
                        },
                        { upsert: true, new: true }
                    );
                    createdPageIds.push(pageDoc._id.toString());
                }

                // Allocate script to TA round-robin
                const assignedTa = taUsers[sIdx % taUsers.length];
                let allocation: any = await Allocation.findOne({
                    exam: exam._id,
                    ta: assignedTa._id,
                    answerScript: script._id,
                });
                if (!allocation) {
                    allocation = await Allocation.create({
                        exam: exam._id,
                        ta: assignedTa._id,
                        allocatedBy: prof._id,
                        status: AllocationStatus.IN_PROGRESS,
                        rule: AllocationRule.EQUAL,
                        answerScript: script._id,
                        claimedAt: new Date(),
                    });
                } else {
                    await Allocation.updateOne(
                        { _id: allocation._id },
                        { $set: { status: AllocationStatus.IN_PROGRESS, claimedAt: new Date() } }
                    );
                }
                createdAllocationIds.push(allocation._id.toString());

                if (withGrades) {
                    for (let q = 1; q <= questionsCount; q++) {
                        const score1 = Math.min(6, 4 + (sIdx % 3));
                        const score2 = Math.min(4, 2 + (sIdx % 3));
                        const gradeDoc = await Grade.findOneAndUpdate(
                            { answerScript: script._id, question: q },
                            {
                                $set: {
                                    rubric: rubric._id,
                                    gradedBy: assignedTa._id,
                                    marksAwarded: [
                                        { criterionName: 'Approach', score: score1, feedback: 'Solid method' },
                                        { criterionName: 'Implementation', score: score2, feedback: 'Well structured' },
                                    ],
                                    totalScore: score1 + score2,
                                    feedback: `Demo evaluation for Q${q}`,
                                    isFinal: true,
                                },
                            },
                            { upsert: true, new: true }
                        );
                        createdGradeIds.push(gradeDoc._id.toString());
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
        pageIds: createdPageIds,
        generatedPassword: effectivePassword,
        stats: {
            courses: createdCourseIds.length,
            exams: createdExamIds.length,
            tas: taUsers.length,
            students: studentUsers.length,
            scripts: createdScriptIds.length,
            pages: createdPageIds.length,
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
            console.log(`Courses Created/Updated: ${result.stats.courses}`);
            console.log(`Exams Created/Updated: ${result.stats.exams}`);
            console.log(`TAs Configured: ${result.stats.tas}`);
            console.log(`Students Enrolled: ${result.stats.students}`);
            console.log(`Answer Scripts Generated: ${result.stats.scripts}`);
            console.log(`Pages & Images Generated: ${result.stats.pages}`);
            console.log(`Allocations Assigned: ${result.stats.allocations}`);
            console.log(`Grades Recorded: ${result.stats.grades}`);
            console.log(`\nGenerated / Configured credentials (password: ${result.generatedPassword}):`);
            console.log('  Professor: prof.demo@university.edu');
            console.log('  TA:        ta1.demo@university.edu');
            console.log('  Student:   student1.demo@university.edu');
            process.exit(0);
        })
        .catch(err => {
            console.error('Seed demo data failed:', err);
            process.exit(1);
        });
}
