import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import PersonalizedQuestion, {
    IPersonalizedQuestion,
    QuestionDifficulty,
    QuestionCategory,
    QuestionType
} from '../models/PersonalizedQuestion';
import Course from '../models/Course';
import { HttpError } from '../lib/errors';
import personalizedAssessmentRepository from '../repositories/PersonalizedAssessmentRepository';
import { writeAuditLog } from '../lib/audit';

export interface RawQuestionInput {
    title?: string;
    questionPrompt?: string;
    prompt?: string;
    question?: string;
    text?: string;
    problem?: string;
    topic?: string;
    subtopic?: string;
    difficulty?: string;
    category?: string;
    questionType?: string;
    type?: string;
    options?: string[] | string;
    optionA?: string;
    optionB?: string;
    optionC?: string;
    optionD?: string;
    option1?: string;
    option2?: string;
    option3?: string;
    option4?: string;
    correctOptionIndex?: number | string | null;
    correctAnswer?: string | number;
    correctOption?: string | number;
    explanation?: string;
    referenceAnswer?: string;
    hints?: string[] | string;
    maxMarks?: number | string;
}

export interface ValidatedBulkQuestionItem {
    rowNumber: number;
    title: string;
    topic: string;
    subtopic?: string;
    difficulty: QuestionDifficulty;
    category?: QuestionCategory;
    questionType?: QuestionType;
    questionPrompt: string;
    options: string[];
    correctOptionIndex: number | null;
    explanation?: string;
    referenceAnswer?: string;
    hints: string[];
    maxMarks: number;
    status: 'VALID' | 'INVALID' | 'DUPLICATE';
    errors: string[];
}

export interface BulkPreviewResult {
    totalFound: number;
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
    items: ValidatedBulkQuestionItem[];
}

export interface BulkImportCommitResult {
    totalProcessed: number;
    importedCount: number;
    skippedCount: number;
    questions: IPersonalizedQuestion[];
}

export class BulkQuestionImportService {
    /**
     * Parse raw string content (JSON or CSV) into structured question records.
     */
    parseContent(content: string, filename?: string): RawQuestionInput[] {
        const trimmed = content.trim();
        if (!trimmed) {
            return [];
        }

        const isJson =
            filename?.toLowerCase().endsWith('.json') ||
            trimmed.startsWith('[') ||
            (trimmed.startsWith('{') && trimmed.includes('"questions"'));

        if (isJson) {
            return this.parseJsonContent(trimmed);
        } else {
            return this.parseCsvContent(trimmed);
        }
    }

    private parseJsonContent(content: string): RawQuestionInput[] {
        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Invalid JSON format';
            throw new HttpError(`Malformed JSON file: ${msg}`, 400);
        }

        if (Array.isArray(parsed)) {
            return parsed as RawQuestionInput[];
        }

        if (parsed && typeof parsed === 'object') {
            const obj = parsed as Record<string, unknown>;
            if (Array.isArray(obj.questions)) {
                return obj.questions as RawQuestionInput[];
            }
            if (Array.isArray(obj.data)) {
                return obj.data as RawQuestionInput[];
            }
        }

        throw new HttpError('JSON must be an array of questions or an object with a "questions" array', 400);
    }

    private parseCsvContent(content: string): RawQuestionInput[] {
        try {
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true
            }) as Record<string, string>[];

            return records.map((r) => {
                const norm: RawQuestionInput = {};

                // Normalize keys (case-insensitive & trim)
                for (const [k, v] of Object.entries(r)) {
                    const cleanKey = k.trim().toLowerCase();
                    const val = typeof v === 'string' ? v.trim() : v;

                    if (['prompt', 'question', 'questionprompt', 'text', 'problem'].includes(cleanKey)) {
                        norm.questionPrompt = val;
                    } else if (cleanKey === 'title') {
                        norm.title = val;
                    } else if (cleanKey === 'topic') {
                        norm.topic = val;
                    } else if (cleanKey === 'subtopic') {
                        norm.subtopic = val;
                    } else if (cleanKey === 'difficulty') {
                        norm.difficulty = val;
                    } else if (cleanKey === 'category') {
                        norm.category = val;
                    } else if (['type', 'questiontype'].includes(cleanKey)) {
                        norm.questionType = val;
                    } else if (['options', 'choices'].includes(cleanKey)) {
                        norm.options = val;
                    } else if (['optiona', 'option_a'].includes(cleanKey)) {
                        norm.optionA = val;
                    } else if (['optionb', 'option_b'].includes(cleanKey)) {
                        norm.optionB = val;
                    } else if (['optionc', 'option_c'].includes(cleanKey)) {
                        norm.optionC = val;
                    } else if (['optiond', 'option_d'].includes(cleanKey)) {
                        norm.optionD = val;
                    } else if (['option1', 'option_1'].includes(cleanKey)) {
                        norm.option1 = val;
                    } else if (['option2', 'option_2'].includes(cleanKey)) {
                        norm.option2 = val;
                    } else if (['option3', 'option_3'].includes(cleanKey)) {
                        norm.option3 = val;
                    } else if (['option4', 'option_4'].includes(cleanKey)) {
                        norm.option4 = val;
                    } else if (['correctoptionindex', 'correctindex', 'correct_index'].includes(cleanKey)) {
                        norm.correctOptionIndex = val;
                    } else if (['correctanswer', 'answer', 'correct_answer', 'correctoption', 'correct_option'].includes(cleanKey)) {
                        norm.correctAnswer = val;
                    } else if (['explanation', 'solution'].includes(cleanKey)) {
                        norm.explanation = val;
                    } else if (['referenceanswer', 'reference_answer'].includes(cleanKey)) {
                        norm.referenceAnswer = val;
                    } else if (['hints', 'hint'].includes(cleanKey)) {
                        norm.hints = val;
                    } else if (['maxmarks', 'marks', 'points'].includes(cleanKey)) {
                        norm.maxMarks = val;
                    }
                }

                return norm;
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Invalid CSV format';
            throw new HttpError(`Malformed CSV file: ${msg}`, 400);
        }
    }

    /**
     * Validates parsed question rows against requirements and detects duplicate entries.
     */
    async validateQuestions(
        rawItems: RawQuestionInput[],
        courseId: string | mongoose.Types.ObjectId,
        defaultTopic = 'General'
    ): Promise<BulkPreviewResult> {
        const courseOid = new mongoose.Types.ObjectId(courseId.toString());

        // Fetch existing course questions to cross-check duplicates
        const existingQuestions = await PersonalizedQuestion.find({
            course: courseOid,
            isActive: true
        }).select('title questionPrompt');

        const existingPromptSet = new Set(
            existingQuestions.map((q) => this.normalizePromptKey(q.questionPrompt))
        );
        const existingTitleSet = new Set(
            existingQuestions.map((q) => q.title.trim().toLowerCase())
        );

        const seenInBatchPromptSet = new Set<string>();
        const seenInBatchTitleSet = new Set<string>();

        const validatedItems: ValidatedBulkQuestionItem[] = [];

        for (let idx = 0; idx < rawItems.length; idx++) {
            const row = rawItems[idx];
            const rowNumber = idx + 1;
            const errors: string[] = [];

            // 1. Prompt / Question Text
            const prompt = (
                row.questionPrompt ||
                row.prompt ||
                row.question ||
                row.text ||
                row.problem ||
                ''
            ).trim();

            if (!prompt) {
                errors.push('Question prompt / problem statement is required');
            } else if (prompt.length < 5) {
                errors.push('Question prompt must be at least 5 characters');
            }

            // 2. Title
            let title = (row.title || '').trim();
            if (!title && prompt) {
                // Generate clean short title from prompt
                const cleanOneLine = prompt.replace(/\r?\n/g, ' ').trim();
                title = cleanOneLine.length > 50 ? `${cleanOneLine.slice(0, 47)}...` : cleanOneLine;
            }
            if (!title) {
                errors.push('Question title is required');
            } else if (title.length > 200) {
                errors.push('Title exceeds 200 characters');
            }

            // 3. Topic
            const topic = (row.topic || defaultTopic || 'General').trim();
            if (!topic) {
                errors.push('Topic is required');
            }

            // 4. Subtopic (optional)
            const subtopic = row.subtopic ? row.subtopic.trim() : undefined;

            // 5. Difficulty
            let difficulty: QuestionDifficulty = 'MEDIUM';
            if (row.difficulty) {
                const diffUpper = row.difficulty.toString().trim().toUpperCase();
                if (['EASY', 'MEDIUM', 'HARD'].includes(diffUpper)) {
                    difficulty = diffUpper as QuestionDifficulty;
                } else {
                    errors.push(`Invalid difficulty "${row.difficulty}". Must be EASY, MEDIUM, or HARD`);
                }
            }

            // 6. Category (optional)
            let category: QuestionCategory | undefined = undefined;
            if (row.category) {
                const catUpper = row.category.toString().trim().toUpperCase();
                if (['CONCEPTUAL', 'APPLICATION', 'ANALYSIS', 'DESIGN'].includes(catUpper)) {
                    category = catUpper as QuestionCategory;
                }
            }

            // 7. Question Type (optional)
            let questionType: QuestionType | undefined = undefined;
            const rawType = (row.questionType || row.type || '').toString().trim().toUpperCase();
            if (rawType) {
                const validTypes: QuestionType[] = [
                    'CODING',
                    'DEBUGGING',
                    'ANALYTICAL',
                    'NUMERICAL',
                    'THEORY',
                    'OUTPUT_PREDICTION',
                    'FIND_ERROR',
                    'CONCEPTUAL',
                    'APPLICATION',
                    'ANALYSIS',
                    'DESIGN'
                ];
                if (validTypes.includes(rawType as QuestionType)) {
                    questionType = rawType as QuestionType;
                }
            }

            // 8. Options
            let options: string[] = [];
            if (Array.isArray(row.options)) {
                options = row.options.map((o) => (o ? o.toString().trim() : '')).filter(Boolean);
            } else if (typeof row.options === 'string' && row.options.trim()) {
                if (row.options.includes('|')) {
                    options = row.options.split('|').map((o) => o.trim()).filter(Boolean);
                } else if (row.options.includes(';')) {
                    options = row.options.split(';').map((o) => o.trim()).filter(Boolean);
                } else {
                    options = [row.options.trim()];
                }
            } else {
                // Check separate columns optionA, optionB, etc.
                const discrete = [
                    row.optionA || row.option1,
                    row.optionB || row.option2,
                    row.optionC || row.option3,
                    row.optionD || row.option4
                ].filter(Boolean) as string[];
                if (discrete.length > 0) {
                    options = discrete.map((d) => d.toString().trim());
                }
            }

            // 9. Correct Option Index / Answer
            let correctOptionIndex: number | null = null;
            const rawCorrect =
                row.correctOptionIndex !== undefined && row.correctOptionIndex !== null
                    ? row.correctOptionIndex
                    : row.correctAnswer !== undefined && row.correctAnswer !== null
                    ? row.correctAnswer
                    : row.correctOption;

            if (rawCorrect !== undefined && rawCorrect !== null && rawCorrect !== '') {
                if (typeof rawCorrect === 'number') {
                    correctOptionIndex = rawCorrect;
                } else {
                    const str = rawCorrect.toString().trim();
                    // Check if numeric
                    if (/^\d+$/.test(str)) {
                        correctOptionIndex = parseInt(str, 10);
                        // Convert 1-based index if users wrote 1..N and options length is N
                        if (correctOptionIndex > 0 && correctOptionIndex === options.length && options.length > 1) {
                            correctOptionIndex = correctOptionIndex - 1;
                        }
                    } else if (['A', 'B', 'C', 'D'].includes(str.toUpperCase())) {
                        const letterMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
                        correctOptionIndex = letterMap[str.toUpperCase()];
                    } else if (options.length > 0) {
                        // Match option string
                        const foundIdx = options.findIndex((o) => o.toLowerCase() === str.toLowerCase());
                        if (foundIdx !== -1) {
                            correctOptionIndex = foundIdx;
                        }
                    }
                }
            }

            // If options are provided, validate length & correct index
            if (options.length > 0) {
                if (options.length < 2) {
                    errors.push('Multiple-choice questions must have at least 2 options');
                }
                if (correctOptionIndex !== null) {
                    if (correctOptionIndex < 0 || correctOptionIndex >= options.length) {
                        errors.push(
                            `Correct option index ${correctOptionIndex} is out of bounds (options available: ${options.length})`
                        );
                    }
                }
            }

            // 10. Hints
            let hints: string[] = [];
            if (Array.isArray(row.hints)) {
                hints = row.hints.map((h) => h?.toString().trim()).filter(Boolean);
            } else if (typeof row.hints === 'string' && row.hints.trim()) {
                hints = row.hints
                    .split(/\r?\n|\|/)
                    .map((h) => h.trim())
                    .filter(Boolean);
            }

            // 11. Max Marks
            let maxMarks = 2;
            if (row.maxMarks !== undefined && row.maxMarks !== null && row.maxMarks !== '') {
                const parsedMarks = Number(row.maxMarks);
                if (!isNaN(parsedMarks) && parsedMarks > 0) {
                    maxMarks = parsedMarks;
                }
            }

            // 12. Check duplicates
            let isDuplicate = false;
            const promptKey = this.normalizePromptKey(prompt);
            const titleKey = title.toLowerCase();

            if (existingPromptSet.has(promptKey) || (title && existingTitleSet.has(titleKey))) {
                isDuplicate = true;
                errors.push('A question with identical prompt or title already exists in this course');
            } else if (seenInBatchPromptSet.has(promptKey)) {
                isDuplicate = true;
                errors.push('Duplicate question prompt within this batch');
            }

            if (promptKey) seenInBatchPromptSet.add(promptKey);
            if (titleKey) seenInBatchTitleSet.add(titleKey);

            const status = isDuplicate ? 'DUPLICATE' : errors.length > 0 ? 'INVALID' : 'VALID';

            validatedItems.push({
                rowNumber,
                title,
                topic,
                subtopic,
                difficulty,
                category,
                questionType,
                questionPrompt: prompt,
                options,
                correctOptionIndex,
                explanation: row.explanation?.trim() || undefined,
                referenceAnswer: row.referenceAnswer?.trim() || undefined,
                hints,
                maxMarks,
                status,
                errors
            });
        }

        const validCount = validatedItems.filter((i) => i.status === 'VALID').length;
        const invalidCount = validatedItems.filter((i) => i.status === 'INVALID').length;
        const duplicateCount = validatedItems.filter((i) => i.status === 'DUPLICATE').length;

        return {
            totalFound: validatedItems.length,
            validCount,
            invalidCount,
            duplicateCount,
            items: validatedItems
        };
    }

    /**
     * Imports validated questions into the course bank with organizationStatus = PENDING.
     */
    async commitImport(
        courseId: string | mongoose.Types.ObjectId,
        professorId: string | mongoose.Types.ObjectId,
        itemsToImport: ValidatedBulkQuestionItem[],
        auditCtx?: { actingUserId?: string; actingUserRole?: string; ipAddress?: string }
    ): Promise<BulkImportCommitResult> {
        const courseOid = new mongoose.Types.ObjectId(courseId.toString());
        const professorOid = new mongoose.Types.ObjectId(professorId.toString());

        const course = await Course.findById(courseOid);
        if (!course) {
            throw new HttpError('Course not found', 404);
        }

        if (course.professor.toString() !== professorOid.toString() && auditCtx?.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: You are not authorized to import questions for this course', 403);
        }

        // Filter valid questions
        const validItems = itemsToImport.filter((i) => i.status === 'VALID');
        if (validItems.length === 0) {
            return {
                totalProcessed: itemsToImport.length,
                importedCount: 0,
                skippedCount: itemsToImport.length,
                questions: []
            };
        }

        // Query current max questionIndex in course
        const latestQuestion = await PersonalizedQuestion.findOne({
            course: courseOid
        })
            .sort({ questionIndex: -1 })
            .select('questionIndex');

        let nextIndex = latestQuestion && latestQuestion.questionIndex ? latestQuestion.questionIndex + 1 : 1;

        const docsToInsert = validItems.map((item) => {
            const doc = {
                course: courseOid,
                questionIndex: nextIndex++,
                title: item.title,
                topic: item.topic,
                subtopic: item.subtopic,
                difficulty: item.difficulty,
                category: item.category,
                questionType: item.questionType,
                questionPrompt: item.questionPrompt,
                options: item.options,
                correctOptionIndex: item.correctOptionIndex,
                explanation: item.explanation || null,
                referenceAnswer: item.referenceAnswer || null,
                hints: item.hints,
                maxMarks: item.maxMarks,
                // Newly imported questions start as PENDING for AI organization
                organizationStatus: 'PENDING' as const,
                createdBy: professorOid,
                isActive: true
            };
            return doc;
        });

        const createdQuestions = await personalizedAssessmentRepository.bulkCreateQuestions(docsToInsert);

        await writeAuditLog({
            user: professorId.toString(),
            action: 'PERSONALIZED_QUESTIONS_BULK_IMPORTED',
            outcome: 'SUCCESS',
            details: {
                courseId: courseId.toString(),
                totalSubmitted: itemsToImport.length,
                importedCount: createdQuestions.length,
                skippedCount: itemsToImport.length - createdQuestions.length
            }
        });

        return {
            totalProcessed: itemsToImport.length,
            importedCount: createdQuestions.length,
            skippedCount: itemsToImport.length - createdQuestions.length,
            questions: createdQuestions
        };
    }

    private normalizePromptKey(prompt: string): string {
        return prompt
            .toLowerCase()
            .replace(/[\s\r\n\t]+/g, ' ')
            .replace(/[^\w\s]/g, '')
            .trim();
    }
}

export const bulkQuestionImportService = new BulkQuestionImportService();
export default bulkQuestionImportService;
