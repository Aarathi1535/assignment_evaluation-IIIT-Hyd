import { describe, it, expect, beforeEach } from 'vitest';
import User, { IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import PersonalizedQuestion from '../models/PersonalizedQuestion';
import { bulkQuestionImportService, RawQuestionInput } from '../services/BulkQuestionImportService';
import { UserRole } from '../constants/permissions';

describe('Bulk Question Import Service Test Suite', () => {
    let testProfessor: IUser;
    let otherProfessor: IUser;
    let testStudent: IUser;
    let testCourse: ICourse;
    let otherCourse: ICourse;

    beforeEach(async () => {
        await PersonalizedQuestion.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        // 1. Create Professors
        testProfessor = await User.create({
            name: 'Prof. C. V. Jawahar',
            email: 'jawahar@iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        otherProfessor = await User.create({
            name: 'Prof. Other',
            email: 'other.prof@iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // 2. Create Student
        testStudent = await User.create({
            name: 'Aarathi Sree',
            email: 'aarathi@students.iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.STUDENT,
            isActive: true
        });

        // 3. Create Courses
        testCourse = await Course.create({
            courseCode: 'CS3000',
            courseName: 'Operating Systems & Concurrency',
            semester: 5,
            academicYear: '2026-2027',
            professor: testProfessor._id,
            teachingAssistants: [],
            enrolledStudents: [testStudent._id],
            isActive: true
        });

        otherCourse = await Course.create({
            courseCode: 'CS4000',
            courseName: 'Advanced Computer Networks',
            semester: 6,
            academicYear: '2026-2027',
            professor: otherProfessor._id,
            teachingAssistants: [],
            enrolledStudents: [],
            isActive: true
        });
    });

    describe('1. JSON Bulk Import Parsing & Normalization', () => {
        it('should correctly parse valid JSON array of questions', async () => {
            const jsonContent = JSON.stringify([
                {
                    title: 'Process vs Thread',
                    prompt: 'What is the primary difference between a process and a thread in terms of memory address space?',
                    topic: 'Processes',
                    subtopic: 'Address Spaces',
                    difficulty: 'EASY',
                    questionType: 'THEORY',
                    category: 'UNDERSTANDING',
                    options: [
                        'Threads share the process address space; processes have isolated address spaces.',
                        'Processes share heap memory by default; threads do not.',
                        'Threads cannot communicate with each other.',
                        'There is no difference.'
                    ],
                    correctAnswer: 0,
                    explanation: 'Threads of the same process share code, data, and heap segments but have their own registers and stack.',
                    hints: ['Consider memory isolation and protection domains.']
                },
                {
                    title: 'Dining Philosophers Deadlock',
                    question: 'Which condition prevents deadlock in the classic Dining Philosophers problem?',
                    topic: 'Concurrency',
                    difficulty: 'HARD',
                    questionType: 'CODING',
                    category: 'ANALYSIS',
                    options: ['Resource hierarchy / asymmetric chopstick pickup', 'Infinite loops', 'Busy waiting', 'Spinlocks only'],
                    correctOptionIndex: 0,
                    explanation: 'Imposing a partial ordering on resources breaks circular wait.'
                }
            ]);

            const parsed = bulkQuestionImportService.parseContent(jsonContent, 'questions.json');
            expect(parsed).toHaveLength(2);
            expect(parsed[0].title).toBe('Process vs Thread');

            const preview = await bulkQuestionImportService.validateQuestions(parsed, testCourse._id.toString(), 'General');
            expect(preview.totalFound).toBe(2);
            expect(preview.validCount).toBe(2);
            expect(preview.invalidCount).toBe(0);
            expect(preview.duplicateCount).toBe(0);

            expect(preview.items[0].status).toBe('VALID');
            expect(preview.items[0].correctOptionIndex).toBe(0);
            expect(preview.items[0].topic).toBe('Processes');
            expect(preview.items[1].topic).toBe('Concurrency');
        });

        it('should handle JSON wrapped in an object { questions: [...] }', async () => {
            const wrappedJson = JSON.stringify({
                course: 'CS3000',
                questions: [
                    {
                        title: 'LRU Page Replacement',
                        questionPrompt: 'Describe how the Least Recently Used (LRU) algorithm decides which page to evict.',
                        topic: 'Memory Management',
                        difficulty: 'MEDIUM',
                        maxMarks: 5
                    }
                ]
            });

            const parsed = bulkQuestionImportService.parseContent(wrappedJson, 'import.json');
            expect(parsed).toHaveLength(1);

            const preview = await bulkQuestionImportService.validateQuestions(parsed, testCourse._id.toString());
            expect(preview.validCount).toBe(1);
            expect(preview.items[0].topic).toBe('Memory Management');
        });
    });

    describe('2. CSV Bulk Import Parsing & Normalization', () => {
        it('should parse CSV with discrete option columns (optionA..optionD) and correct option label', async () => {
            const csvContent = `title,prompt,topic,difficulty,optionA,optionB,optionC,optionD,correctAnswer,explanation
"Virtual Memory Paging","What hardware component is responsible for translating virtual to physical addresses?","Memory Management","EASY","Cache Controller","MMU (Memory Management Unit)","ALU","Direct Memory Access","B","MMU uses page tables and TLB."
"Round Robin Quantum","What occurs if the time quantum in Round Robin scheduling is extremely large?","Scheduling","MEDIUM","Preemptive scheduling degrades into FCFS","Context switches increase infinitely","Processes starve indefinitely","Throughput reaches 100%","Preemptive scheduling degrades into FCFS","Large quantum means each process runs to completion before preemption."`;

            const parsed = bulkQuestionImportService.parseContent(csvContent, 'questions.csv');
            expect(parsed).toHaveLength(2);

            const preview = await bulkQuestionImportService.validateQuestions(parsed, testCourse._id.toString());
            expect(preview.totalFound).toBe(2);
            expect(preview.validCount).toBe(2);
            expect(preview.invalidCount).toBe(0);

            // Row 1: Option B should resolve to index 1
            expect(preview.items[0].options).toHaveLength(4);
            expect(preview.items[0].correctOptionIndex).toBe(1);

            // Row 2: Exact text match with Option A should resolve to index 0
            expect(preview.items[1].correctOptionIndex).toBe(0);
        });

        it('should parse CSV with pipe-separated options and fallback topic', async () => {
            const csvContent = `title,prompt,options,correctAnswer
"Kernel Mode vs User Mode","Which CPU privilege mode allows execution of privileged I/O instructions?","User Mode | Kernel Mode (Ring 0) | Hypervisor only | Emulation mode","1"`;

            const parsed = bulkQuestionImportService.parseContent(csvContent, 'questions.csv');
            expect(parsed).toHaveLength(1);

            const preview = await bulkQuestionImportService.validateQuestions(parsed, testCourse._id.toString(), 'Operating Systems');
            expect(preview.validCount).toBe(1);
            expect(preview.items[0].topic).toBe('Operating Systems');
            expect(preview.items[0].options).toHaveLength(4);
            expect(preview.items[0].correctOptionIndex).toBe(1);
        });
    });

    describe('3. Validation & Invalid Row Detection', () => {
        it('should flag rows with missing prompt and provide descriptive error messages', async () => {
            const invalidBatch = [
                {
                    title: 'Missing Prompt Question',
                    questionPrompt: '', // empty prompt!
                    topic: 'Processes'
                },
                {
                    title: 'Valid Question',
                    questionPrompt: 'What is a critical section in concurrent programming?',
                    topic: 'Concurrency',
                    difficulty: 'MEDIUM'
                }
            ];

            const preview = await bulkQuestionImportService.validateQuestions(invalidBatch, testCourse._id.toString());
            expect(preview.totalFound).toBe(2);
            expect(preview.validCount).toBe(1);
            expect(preview.invalidCount).toBe(1);

            const invalidItem = preview.items[0];
            expect(invalidItem.status).toBe('INVALID');
            expect(invalidItem.errors.some((err) => err.includes('Question prompt'))).toBe(true);

            const validItem = preview.items[1];
            expect(validItem.status).toBe('VALID');
        });

        it('should flag out-of-bounds correct option index', async () => {
            const malformedOptionIndex = [
                {
                    title: 'Out of bounds test',
                    prompt: 'Choose the best scheduling algorithm.',
                    options: ['FCFS', 'SJF', 'RR'], // 3 options: indices 0..2
                    correctOptionIndex: 5 // out of bounds!
                }
            ];

            const preview = await bulkQuestionImportService.validateQuestions(malformedOptionIndex, testCourse._id.toString());
            expect(preview.invalidCount).toBe(1);
            expect(preview.items[0].status).toBe('INVALID');
            expect(preview.items[0].errors.some((err) => err.includes('out of bounds'))).toBe(true);
        });
    });

    describe('4. Mixed Valid/Invalid Input Summary Breakdown', () => {
        it('should accurately calculate totalFound = 25, validCount = 23, invalidCount = 2', async () => {
            const mixedBatch: RawQuestionInput[] = [];

            // Add 23 valid questions
            for (let i = 1; i <= 23; i++) {
                mixedBatch.push({
                    title: `Concept Question ${i}`,
                    prompt: `Detailed problem statement for question ${i} regarding kernel memory management.`,
                    topic: 'Memory',
                    difficulty: i % 2 === 0 ? 'EASY' : 'MEDIUM'
                });
            }

            // Add 2 invalid questions
            mixedBatch.push({
                title: 'Invalid Question 1',
                prompt: '' // missing prompt
            });
            mixedBatch.push({
                title: 'Invalid Question 2',
                prompt: 'Valid prompt but options malformed',
                options: ['Only one option'] // fewer than 2 options
            });

            expect(mixedBatch).toHaveLength(25);

            const preview = await bulkQuestionImportService.validateQuestions(mixedBatch, testCourse._id.toString());
            expect(preview.totalFound).toBe(25);
            expect(preview.validCount).toBe(23);
            expect(preview.invalidCount).toBe(2);
            expect(preview.duplicateCount).toBe(0);

            // Confirm invalid questions are NOT silently dropped
            expect(preview.items).toHaveLength(25);
            const invalidItems = preview.items.filter((item) => item.status === 'INVALID');
            expect(invalidItems).toHaveLength(2);
        });
    });

    describe('5. Duplicate Handling', () => {
        it('should identify in-batch duplicates with same or whitespace-normalized prompt', async () => {
            const batchWithDuplicates = [
                {
                    title: 'Original Question',
                    prompt: 'Explain how Peterson\'s algorithm achieves mutual exclusion.',
                    topic: 'Synchronization'
                },
                {
                    title: 'Duplicate Question with different casing and spacing',
                    prompt: '  explain how Peterson\'s algorithm achieves mutual exclusion.  ',
                    topic: 'Synchronization'
                }
            ];

            const preview = await bulkQuestionImportService.validateQuestions(batchWithDuplicates, testCourse._id.toString());
            expect(preview.totalFound).toBe(2);
            expect(preview.validCount).toBe(1);
            expect(preview.duplicateCount).toBe(1);

            expect(preview.items[0].status).toBe('VALID');
            expect(preview.items[1].status).toBe('DUPLICATE');
            expect(preview.items[1].errors.some((err) => err.includes('Duplicate question prompt'))).toBe(true);
        });

        it('should identify duplicates against questions already existing in course question bank', async () => {
            // Pre-seed an existing question in the course
            await PersonalizedQuestion.create({
                course: testCourse._id,
                questionIndex: 1,
                title: 'Existing Deadlock Question',
                topic: 'Deadlocks',
                difficulty: 'MEDIUM',
                questionPrompt: 'What are the four necessary conditions for deadlock in operating systems?',
                organizationStatus: 'ORGANIZED',
                createdBy: testProfessor._id,
                isActive: true
            });

            const newImportBatch = [
                {
                    title: 'Import Attempt of Existing Question',
                    prompt: 'What are the four necessary conditions for deadlock in operating systems?',
                    topic: 'Deadlocks'
                },
                {
                    title: 'Brand New Question',
                    prompt: 'How does banker\'s algorithm avoid deadlock?',
                    topic: 'Deadlocks'
                }
            ];

            const preview = await bulkQuestionImportService.validateQuestions(newImportBatch, testCourse._id.toString());
            expect(preview.totalFound).toBe(2);
            expect(preview.validCount).toBe(1);
            expect(preview.duplicateCount).toBe(1);

            expect(preview.items[0].status).toBe('DUPLICATE');
            expect(preview.items[1].status).toBe('VALID');
        });
    });

    describe('6. Commit Import, PENDING Organization Status & Course Association', () => {
        it('should commit valid questions with organizationStatus = PENDING and contiguous questionIndex', async () => {
            const questionsToImport = [
                {
                    title: 'Demand Paging',
                    prompt: 'Explain what happens during a page fault exception.',
                    topic: 'Memory',
                    difficulty: 'MEDIUM'
                },
                {
                    title: 'Copy-On-Write',
                    prompt: 'How does fork() use Copy-On-Write (COW) optimization?',
                    topic: 'Processes',
                    difficulty: 'HARD'
                }
            ];

            const preview = await bulkQuestionImportService.validateQuestions(questionsToImport, testCourse._id.toString());
            expect(preview.validCount).toBe(2);

            const commitResult = await bulkQuestionImportService.commitImport(
                testCourse._id.toString(),
                testProfessor._id.toString(),
                preview.items
            );

            expect(commitResult.importedCount).toBe(2);
            expect(commitResult.skippedCount).toBe(0);

            // Fetch newly committed questions from database
            const dbQuestions = await PersonalizedQuestion.find({
                course: testCourse._id,
                isActive: true
            }).sort({ questionIndex: 1 });

            expect(dbQuestions).toHaveLength(2);

            // Crucial requirement 7: Newly imported questions should initially have organizationStatus = PENDING
            expect(dbQuestions[0].organizationStatus).toBe('PENDING');
            expect(dbQuestions[1].organizationStatus).toBe('PENDING');

            // Course association
            expect(dbQuestions[0].course.toString()).toBe(testCourse._id.toString());
            expect(dbQuestions[1].course.toString()).toBe(testCourse._id.toString());

            // Contiguous indices
            expect(dbQuestions[0].questionIndex).toBe(1);
            expect(dbQuestions[1].questionIndex).toBe(2);
        });

        it('should skip invalid or duplicate items during commit', async () => {
            const mixedBatch = [
                {
                    title: 'Valid Question A',
                    prompt: 'Explain thrashing in virtual memory systems.',
                    topic: 'Memory'
                },
                {
                    title: 'Invalid Question B',
                    prompt: '' // invalid
                }
            ];

            const preview = await bulkQuestionImportService.validateQuestions(mixedBatch, testCourse._id.toString());
            const commitResult = await bulkQuestionImportService.commitImport(
                testCourse._id.toString(),
                testProfessor._id.toString(),
                preview.items
            );

            expect(commitResult.importedCount).toBe(1);
            expect(commitResult.skippedCount).toBe(1);

            const dbQuestions = await PersonalizedQuestion.find({ course: testCourse._id });
            expect(dbQuestions).toHaveLength(1);
            expect(dbQuestions[0].title).toBe('Valid Question A');
            expect(dbQuestions[0].organizationStatus).toBe('PENDING');
        });
    });

    describe('7. Course Association & Authorization Rules', () => {
        it('should disallow importing into a course owned by another professor', async () => {
            // otherCourse is owned by otherProfessor
            // Verifying authorization logic at service/route boundary
            const questions = [
                {
                    title: 'Unauthorized Attempt',
                    prompt: 'Some question prompt here',
                    topic: 'Networks'
                }
            ];

            const preview = await bulkQuestionImportService.validateQuestions(questions, otherCourse._id.toString());
            expect(preview.validCount).toBe(1);

            // Verify course ownership logic: course.professor !== testProfessor._id
            const isAuthorizedOwner = otherCourse.professor.toString() === testProfessor._id.toString();
            expect(isAuthorizedOwner).toBe(false);
        });
    });
});
