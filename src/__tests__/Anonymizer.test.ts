/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import mongoose from 'mongoose';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import StudentMapping from '../models/StudentMapping';
import AnswerScript from '../models/AnswerScript';
import Grade from '../models/Grade';
import { Anonymizer } from '../lib/anonymizer';

describe('AE-090 Anonymization Serializer Tests', () => {
    let profUser: any;
    let taUser: any;
    let studentUser: any;
    let course: any;
    let examBlind: any;
    let examBlind2: any;
    let examNonBlind: any;
    let mapping: any;
    let mapping2: any;
    let answerScript: any;
    let grade: any;

    beforeAll(async () => {
        await Exam.init();
        await Course.init();
        await User.init();
        await StudentMapping.init();
        await AnswerScript.init();
        await Grade.init();
    });

    beforeEach(async () => {
        // Clear collections
        await Grade.deleteMany({});
        await AnswerScript.deleteMany({});
        await StudentMapping.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        // Create Users
        profUser = await User.create({
            name: 'Professor Snape',
            email: 'snape@hogwarts.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        taUser = await User.create({
            name: 'Hermione Granger',
            email: 'hermione@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        studentUser = await User.create({
            name: 'Harry Potter',
            email: 'harry@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: 'POTIONS-101',
            courseName: 'Intro to Potions',
            semester: 1,
            academicYear: '2026',
            professor: profUser._id,
            enrolledStudents: [studentUser._id],
            isActive: true
        });

        // Exam 1: Blind Grading Active
        examBlind = await Exam.create({
            title: 'Potions Midterm',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 4,
            enrolledStudents: [studentUser._id],
            blindGrading: true,
            isActive: true
        });

        // Exam 2: Blind Grading Active (Regression Test for Composite Mapping)
        examBlind2 = await Exam.create({
            title: 'Potions Quiz',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 50,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 2,
            enrolledStudents: [studentUser._id],
            blindGrading: true,
            isActive: true
        });

        // Exam 3: Blind Grading Inactive
        examNonBlind = await Exam.create({
            title: 'Potions Final',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 4,
            enrolledStudents: [studentUser._id],
            blindGrading: false,
            isActive: true
        });

        // Student mapping to Exam 1
        mapping = await StudentMapping.create({
            exam: examBlind._id,
            student: studentUser._id,
            anonymousId: 'ANON-POTTER-777',
            isVerified: true
        });

        // Student mapping to Exam 2
        mapping2 = await StudentMapping.create({
            exam: examBlind2._id,
            student: studentUser._id,
            anonymousId: 'ANON-POTTER-888',
            isVerified: true
        });

        // Create populated AnswerScript mockup for Exam 1
        answerScript = await AnswerScript.create({
            exam: examBlind._id,
            student: studentUser._id,
            filePath: '/scans/potions/script1.pdf',
            filename: 'script1.pdf',
            batchId: 'batch-abc-123',
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 4,
            pageCount: 4,
            candidateStudentId: `${examBlind._id}:${studentUser._id}`,
            isActive: true,
            decodeOutcome: 'found',
            metadata: {
                scannedCode: `${examBlind._id}:${studentUser._id}`,
                ipAddress: '127.0.0.1'
            }
        });

        // Create Grade referencing the answer script
        grade = await Grade.create({
            answerScript: answerScript._id,
            rubric: new mongoose.Types.ObjectId(),
            gradedBy: taUser._id,
            marksAwarded: [
                { criterionName: 'Accuracy', score: 10, feedback: 'Good starting.' }
            ],
            totalScore: 10,
            feedback: 'Satisfactory performance',
            isFinal: false,
            question: 0
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('A. AnswerScript Serialization & Allowlist Enforcement', () => {
        it('should correctly return blind-mode TA output (strict minimal allowlist of safe fields)', async () => {
            const viewer = { id: taUser._id.toString(), role: UserRole.TA };
            const result = await Anonymizer.serializeAnswerScript(answerScript, viewer);

            // Allowed safe fields
            expect(result).toHaveProperty('_id');
            expect(result.exam).toBe(examBlind._id.toString());
            expect(result.anonymousId).toBe('ANON-POTTER-777');
            expect(result.scriptReference).toBe('Script #ANON-POTTER-777');
            expect(result.startPageNumber).toBe(1);
            expect(result.endPageNumber).toBe(4);
            expect(result.pageCount).toBe(4);
            expect(result.isActive).toBe(true);

            // Strict omission of diagnostics, file paths, and metadata
            expect(result.student).toBeUndefined();
            expect(result.candidateStudentId).toBeUndefined();
            expect(result.filePath).toBeUndefined();
            expect(result.filename).toBeUndefined();
            expect(result.batchId).toBeUndefined();
            expect(result.fileIndex).toBeUndefined();
            expect(result.needsManualId).toBeUndefined();
            expect(result.manualIdReason).toBeUndefined();
            expect(result.decodeOutcome).toBeUndefined();
            expect(result.metadata).toBeUndefined();
        });

        it('should return full detailed output for authorized professor/admin', async () => {
            const viewer = { id: profUser._id.toString(), role: UserRole.PROFESSOR };
            const result = await Anonymizer.serializeAnswerScript(answerScript, viewer);

            // Full access verification
            expect(result.student.toString()).toBe(studentUser._id.toString());
            expect(result.candidateStudentId).toBe(`${examBlind._id}:${studentUser._id}`);
            expect(result.filePath).toBe('/scans/potions/script1.pdf');
            expect(result.filename).toBe('script1.pdf');
            expect(result.batchId).toBe('batch-abc-123');
            expect(result.metadata).toBeDefined();
        });

        it('should return full detailed output when blind grading is disabled even for TAs', async () => {
            const nonBlindScript = await AnswerScript.create({
                exam: examNonBlind._id,
                student: studentUser._id,
                filePath: '/scans/potions/script2.pdf',
                filename: 'script2.pdf',
                isActive: true
            });

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };
            const result = await Anonymizer.serializeAnswerScript(nonBlindScript, viewer);

            expect(result.student.toString()).toBe(studentUser._id.toString());
            expect(result.filePath).toBe('/scans/potions/script2.pdf');
        });

        it('should completely strip populated student details and nested student PII in blind-mode', async () => {
            const populatedScript = await AnswerScript.findById(answerScript._id)
                .populate('student')
                .exec();

            expect(populatedScript!.student).toHaveProperty('name');

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };
            const result = await Anonymizer.serializeAnswerScript(populatedScript, viewer);

            expect(result.student).toBeUndefined();
            expect(result.anonymousId).toBe('ANON-POTTER-777');
        });

        it('should prevent attempts to include unexpected identifying fields by ignoring them', async () => {
            const maliciousScriptObj = {
                ...answerScript.toObject(),
                customSecretField: 'Super Secret Stolen Identifier',
                dangerousPayload: { nestedPII: 'potter-home-address' }
            };

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };
            const result = await Anonymizer.serializeAnswerScript(maliciousScriptObj, viewer);

            expect(result.customSecretField).toBeUndefined();
            expect(result.dangerousPayload).toBeUndefined();
            expect(result.anonymousId).toBe('ANON-POTTER-777');
        });

        it('should bulk serialize multiple scripts efficiently using serializeAnswerScripts', async () => {
            const scripts = [answerScript];
            const viewer = { id: taUser._id.toString(), role: UserRole.TA };
            const results = await Anonymizer.serializeAnswerScripts(scripts, viewer);

            expect(results.length).toBe(1);
            expect(results[0].anonymousId).toBe('ANON-POTTER-777');
            expect(results[0].student).toBeUndefined();
        });
    });

    describe('B. Grade Serialization & Allowlist Enforcement', () => {
        it('should correctly return blind-mode TA output for Grade (safe allowlist and nested script serialization)', async () => {
            const populatedGrade = await Grade.findById(grade._id)
                .populate('answerScript')
                .exec();

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };
            const result = await Anonymizer.serializeGrade(populatedGrade, viewer);

            // Grade allowlist fields
            expect(result).toHaveProperty('_id');
            expect(result.totalScore).toBe(10);
            expect(result.feedback).toBe('Satisfactory performance');

            // Nested script allowlist fields
            expect(result.answerScript).toBeDefined();
            expect(result.answerScript.anonymousId).toBe('ANON-POTTER-777');
            expect(result.answerScript.scriptReference).toBe('Script #ANON-POTTER-777');
            expect(result.answerScript.student).toBeUndefined();
            expect(result.answerScript.filePath).toBeUndefined();
        });

        it('should return un-anonymized Grade to Professor/Admin', async () => {
            const populatedGrade = await Grade.findById(grade._id)
                .populate('answerScript')
                .exec();

            const viewer = { id: profUser._id.toString(), role: UserRole.PROFESSOR };
            const result = await Anonymizer.serializeGrade(populatedGrade, viewer);

            expect(result.totalScore).toBe(10);
            expect(result.answerScript.student.toString()).toBe(studentUser._id.toString());
            expect(result.answerScript.filePath).toBe('/scans/potions/script1.pdf');
        });

        it('should bulk serialize multiple grades efficiently using serializeGrades', async () => {
            const populatedGrade = await Grade.findById(grade._id)
                .populate('answerScript')
                .exec();

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };
            const results = await Anonymizer.serializeGrades([populatedGrade], viewer);

            expect(results.length).toBe(1);
            expect(results[0].answerScript.anonymousId).toBe('ANON-POTTER-777');
            expect(results[0].answerScript.student).toBeUndefined();
        });
    });

    describe('C. Multi-Exam Composite Key Regression Tests (AE-090 Correctness)', () => {
        it('should correctly resolve different anonymousId values for the same student across different exams in bulk serialization', async () => {
            // Script for Exam 1 (blind grading, anonymousId: ANON-POTTER-777)
            const script1 = answerScript;

            // Script for Exam 2 (blind grading, anonymousId: ANON-POTTER-888)
            const script2 = await AnswerScript.create({
                exam: examBlind2._id,
                student: studentUser._id,
                filePath: '/scans/potions/script_quiz.pdf',
                filename: 'script_quiz.pdf',
                isActive: true
            });

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };

            // Spy on StudentMapping.find to verify N+1 prevention
            const findSpy = vi.spyOn(StudentMapping, 'find');

            // Bulk serialize both scripts together
            const serializedResults = await Anonymizer.serializeAnswerScripts([script1, script2], viewer);

            expect(serializedResults.length).toBe(2);

            // Script 1 gets the anonymous ID for Exam 1
            const res1 = serializedResults.find(r => r._id.toString() === script1._id.toString());
            expect(res1).toBeDefined();
            expect(res1!.anonymousId).toBe('ANON-POTTER-777');

            // Script 2 gets the anonymous ID for Exam 2
            const res2 = serializedResults.find(r => r._id.toString() === script2._id.toString());
            expect(res2).toBeDefined();
            expect(res2!.anonymousId).toBe('ANON-POTTER-888');

            // Verify bulk lookup logic was executed in exactly ONE query to StudentMapping (N+1 prevented)
            expect(findSpy).toHaveBeenCalledTimes(1);
        });

        it('should correctly resolve different anonymousId values for grades across different exams in bulk serialization', async () => {
            // Grade for Exam 1
            const grade1 = grade;

            // Script and Grade for Exam 2
            const script2 = await AnswerScript.create({
                exam: examBlind2._id,
                student: studentUser._id,
                filePath: '/scans/potions/script_quiz.pdf',
                filename: 'script_quiz.pdf',
                isActive: true
            });
            const grade2 = await Grade.create({
                answerScript: script2._id,
                rubric: new mongoose.Types.ObjectId(),
                gradedBy: taUser._id,
                marksAwarded: [
                    { criterionName: 'Accuracy', score: 5, feedback: 'Correct.' }
                ],
                totalScore: 5,
                feedback: 'Nice job',
                isFinal: false,
                question: 0
            });

            // Populate answerScript on both grades
            const populatedGrade1 = await Grade.findById(grade1._id).populate('answerScript').exec();
            const populatedGrade2 = await Grade.findById(grade2._id).populate('answerScript').exec();

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };

            // Spy on StudentMapping.find to verify N+1 prevention
            const findSpy = vi.spyOn(StudentMapping, 'find');

            // Bulk serialize grades
            const serializedResults = await Anonymizer.serializeGrades([populatedGrade1, populatedGrade2], viewer);

            expect(serializedResults.length).toBe(2);

            const res1 = serializedResults.find(r => r._id.toString() === grade1._id.toString());
            expect(res1!.answerScript.anonymousId).toBe('ANON-POTTER-777');

            const res2 = serializedResults.find(r => r._id.toString() === grade2._id.toString());
            expect(res2!.answerScript.anonymousId).toBe('ANON-POTTER-888');

            // Verify N+1 queries were prevented for grades bulk serialization
            expect(findSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('D. AE-092 Anonymized Script Reference ID Tests', () => {
        it('should return Script #anonymousId for identified students and protect student PII', async () => {
            const viewer = { id: taUser._id.toString(), role: UserRole.TA };
            const result = await Anonymizer.serializeAnswerScript(answerScript, viewer);

            expect(result.scriptReference).toBe('Script #ANON-POTTER-777');
            expect(result.student).toBeUndefined();
            expect(result.candidateStudentId).toBeUndefined();
        });

        it('should be stable and return identical scriptReference on repeated serialization', async () => {
            const viewer = { id: taUser._id.toString(), role: UserRole.TA };

            const result1 = await Anonymizer.serializeAnswerScript(answerScript, viewer);
            const result2 = await Anonymizer.serializeAnswerScript(answerScript, viewer);

            expect(result1.scriptReference).toBe('Script #ANON-POTTER-777');
            expect(result2.scriptReference).toBe(result1.scriptReference);
        });

        it('should handle unidentified students by returning a deterministic fallback containing no raw script ObjectId', async () => {
            const unassignedScript = await AnswerScript.create({
                exam: examBlind._id,
                student: null,
                filePath: '/scans/potions/unassigned.pdf',
                filename: 'unassigned.pdf',
                isActive: true
            });

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };

            const result1 = await Anonymizer.serializeAnswerScript(unassignedScript, viewer);
            const result2 = await Anonymizer.serializeAnswerScript(unassignedScript, viewer);

            // 1. Matches exact expected format (Script #UNASSIGNED-XXXXXX)
            expect(result1.scriptReference).toMatch(/^Script #UNASSIGNED-[A-Z0-9]{6}$/);

            // 2. Repeated serialization produces the same reference
            expect(result2.scriptReference).toBe(result1.scriptReference);

            // 3. Extract suffix using regex
            const match = result1.scriptReference.match(/^Script #UNASSIGNED-([A-Z0-9]{6})$/);
            expect(match).not.toBeNull();
            const suffix = match![1];

            // 4. Verify raw ObjectId is not exposed in the reference
            expect(result1.scriptReference).not.toContain(unassignedScript._id.toString());
            expect(unassignedScript._id.toString()).not.toContain(suffix.toLowerCase());
        });

        it('should fail/throw when process.env.ORIGINAL_STORAGE_HMAC_SECRET is missing for unidentified scripts', async () => {
            const unassignedScript = await AnswerScript.create({
                exam: examBlind._id,
                student: null,
                filePath: '/scans/potions/unassigned2.pdf',
                filename: 'unassigned2.pdf',
                isActive: true
            });

            const currentSecret = process.env.ORIGINAL_STORAGE_HMAC_SECRET;
            delete process.env.ORIGINAL_STORAGE_HMAC_SECRET;

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };

            await expect(Anonymizer.serializeAnswerScript(unassignedScript, viewer)).rejects.toThrow(
                'ORIGINAL_STORAGE_HMAC_SECRET is missing or not configured'
            );

            // Restore secret
            process.env.ORIGINAL_STORAGE_HMAC_SECRET = currentSecret;
        });

        it('should preserve cross-exam correctness for scriptReference', async () => {
            const script1 = answerScript;
            const script2 = await AnswerScript.create({
                exam: examBlind2._id,
                student: studentUser._id,
                filePath: '/scans/potions/script_quiz.pdf',
                filename: 'script_quiz.pdf',
                isActive: true
            });

            const viewer = { id: taUser._id.toString(), role: UserRole.TA };
            const results = await Anonymizer.serializeAnswerScripts([script1, script2], viewer);

            const res1 = results.find(r => r._id.toString() === script1._id.toString());
            expect(res1!.scriptReference).toBe('Script #ANON-POTTER-777');

            const res2 = results.find(r => r._id.toString() === script2._id.toString());
            expect(res2!.scriptReference).toBe('Script #ANON-POTTER-888');
        });
    });
});
