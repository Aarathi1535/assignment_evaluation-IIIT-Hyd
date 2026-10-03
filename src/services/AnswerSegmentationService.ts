import mongoose from 'mongoose';
import AnswerScript from '../models/AnswerScript';
import IngestionPage from '../models/IngestionPage';
import Page from '../models/Page';
import Rubric from '../models/Rubric';
import Course from '../models/Course';
import Exam, { ExamStatus, IngestionApprovalStatus } from '../models/Exam';
import ReconstructedAnswer, {
    IReconstructedAnswer,
    ITaggedRegion,
    TaggedRegion,
    IBoundingBox,
    SegmentType
} from '../models/AnswerSegmentation';
import {
    ContinuationReconstructionEngine,
    RawPageRegionInput
} from './segmentation/ContinuationReconstructionEngine';
import { HttpError } from '../lib/errors';
import { writeAuditLog } from '../lib/audit';

export interface ReconstructOptions {
    overrideRegions?: RawPageRegionInput[];
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

export interface TagRegionInput {
    questionNumber: number;
    subQuestion?: string;
    pageNumber: number;
    pageId?: string | mongoose.Types.ObjectId;
    box: IBoundingBox;
    sequenceIndex?: number;
    segmentType?: SegmentType;
    notes?: string;
}

export class AnswerSegmentationService {
    async loadDemoScript(userId: string, userRole: string): Promise<{
        scriptId: string;
        pages: Array<{ id: string; pageNumber: number; imageUrl: string; width: number; height: number }>;
    }> {
        const role = userRole.toUpperCase();
        let courseQuery: mongoose.QueryFilter<import('../models/Course').ICourse>;
        if (role === 'PROFESSOR') {
            courseQuery = { professor: new mongoose.Types.ObjectId(userId), isActive: true };
        } else if (role === 'TA') {
            courseQuery = { teachingAssistants: new mongoose.Types.ObjectId(userId), isActive: true };
        } else if (role === 'ADMIN') {
            courseQuery = { isActive: true };
        } else {
            throw new HttpError('Forbidden: Unauthorized role', 403);
        }

        const course = await Course.findOne(courseQuery).sort({ createdAt: 1 });
        if (!course) {
            throw new HttpError('An active course is required to load the segmentation demo', 404);
        }

        const examTitle = 'Research Direction 3 — Question-Answer Segmentation Demo';
        let exam = await Exam.findOne({
            course: course._id,
            createdBy: course.professor,
            title: examTitle
        });
        if (!exam) {
            exam = await Exam.create({
                title: examTitle,
                course: course._id,
                createdBy: course.professor,
                examDate: new Date(),
                totalMarks: 50,
                status: ExamStatus.EVALUATING,
                numberOfQuestions: 5,
                isActive: true,
                ingestionApprovalStatus: IngestionApprovalStatus.APPROVED
            });
        }

        const batchId = `research-direction-3-segmentation-demo-${course._id.toString()}`;
        let script = await AnswerScript.findOne({
            batchId,
            fileIndex: 0,
            startPageNumber: 1
        });
        if (!script) {
            script = await AnswerScript.create({
                exam: exam._id,
                filename: 'research-direction-3-segmentation-demo.pdf',
                batchId,
                fileIndex: 0,
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2,
                isActive: true,
                identificationHistory: [],
                metadata: { researchDemo: 'answer-segmentation-v1' }
            });
        } else if (script.exam.toString() !== exam._id.toString()) {
            throw new HttpError('The existing segmentation demo script is linked to another exam', 409);
        }

        const pageContent = [
            [
                { question: 1, label: 'Artificial Intelligence', y: 190 },
                { question: 2, label: 'Machine Learning', y: 440 },
                { question: 3, label: 'Deep Learning — answer begins', y: 690 }
            ],
            [
                { question: 3, label: 'Deep Learning — continuation', y: 190 },
                { question: 4, label: 'Natural Language Processing', y: 440 },
                { question: 5, label: 'Generative AI', y: 690 }
            ]
        ];

        const escapeXml = (value: string) => value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
        const pageImage = (pageNumber: number) => {
            const entries = pageContent[pageNumber - 1];
            const textElements = entries.map((entry) => `
                <text x="90" y="${entry.y}" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#172554">Q${entry.question} — ${escapeXml(entry.label)}</text>
                <rect x="90" y="${entry.y + 18}" width="620" height="95" rx="10" fill="#ffffff" stroke="#cbd5e1"/>
                <text x="110" y="${entry.y + 52}" font-family="Arial, sans-serif" font-size="17" fill="#334155">Digital sample answer region for demonstration.</text>
                <text x="110" y="${entry.y + 82}" font-family="Arial, sans-serif" font-size="14" fill="#64748b">TA-tagged bounding box • not handwritten OCR</text>
            `).join('');
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100"><rect width="800" height="1100" fill="#f8fafc"/><rect x="45" y="40" width="710" height="1020" rx="16" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/><text x="90" y="100" font-family="Arial, sans-serif" font-size="18" fill="#64748b">RESEARCH DIRECTION 3 • DIGITAL DEMO SCRIPT • PAGE ${pageNumber} OF 2</text><line x1="90" y1="125" x2="710" y2="125" stroke="#cbd5e1"/>${textElements}<text x="90" y="1005" font-family="Arial, sans-serif" font-size="14" fill="#64748b">Question–answer segmentation sample • no OCR is performed</text></svg>`;
            return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        };

        for (let pageNumber = 1; pageNumber <= 2; pageNumber++) {
            await Page.findOneAndUpdate(
                { answerScript: script._id, pageNumber },
                { $set: { imagePath: pageImage(pageNumber), isActive: true } },
                { upsert: true, returnDocument: 'after' }
            );
        }
        const pages = await Page.find({ answerScript: script._id, isActive: true }).sort({ pageNumber: 1 });

        const demoRegions: TagRegionInput[] = [
            {
                questionNumber: 1,
                pageNumber: 1,
                box: { x: 0.1, y: 0.15, width: 0.78, height: 0.17 },
                segmentType: 'START',
                notes: 'Artificial Intelligence studies intelligent agents that perceive an environment and take actions to achieve defined goals. Rational agents choose actions that maximize expected performance from available information.'
            },
            {
                questionNumber: 2,
                pageNumber: 1,
                box: { x: 0.1, y: 0.38, width: 0.78, height: 0.17 },
                segmentType: 'START',
                notes: 'Machine learning algorithms improve performance by learning patterns from data. Supervised learning fits labeled examples; validation measures generalization and helps detect overfitting.'
            },
            {
                questionNumber: 3,
                pageNumber: 1,
                box: { x: 0.1, y: 0.61, width: 0.78, height: 0.17 },
                segmentType: 'START',
                notes: 'Deep learning uses multi-layer neural networks to learn increasingly abstract representations. A convolutional network applies shared filters to local input regions and builds hierarchical feature maps.'
            },
            {
                questionNumber: 3,
                pageNumber: 2,
                box: { x: 0.1, y: 0.15, width: 0.78, height: 0.17 },
                sequenceIndex: 2,
                segmentType: 'CONTINUATION',
                notes: 'Back-propagation computes gradients from the output layer toward earlier layers using the chain rule. Gradient-based optimization updates weights to reduce training loss; regularization and validation help control overfitting.'
            },
            {
                questionNumber: 4,
                pageNumber: 2,
                box: { x: 0.1, y: 0.38, width: 0.78, height: 0.17 },
                segmentType: 'START',
                notes: 'Natural language processing enables computers to analyze and generate human language. Tokenization, contextual representations, and sequence models support tasks such as translation, summarization, and question answering.'
            },
            {
                questionNumber: 5,
                pageNumber: 2,
                box: { x: 0.1, y: 0.61, width: 0.78, height: 0.17 },
                segmentType: 'START',
                notes: 'Generative AI models learn patterns in training data and sample new content from a learned distribution. Evaluation considers usefulness, factuality, safety, and the limitations of generated responses.'
            }
        ];

        await TaggedRegion.deleteMany({ answerScript: script._id });
        await ReconstructedAnswer.deleteMany({ answerScript: script._id });
        for (const region of demoRegions) {
            await this.tagRegion(script._id, region, userId);
        }

        return {
            scriptId: script._id.toString(),
            pages: pages.map((page) => ({
                id: page._id.toString(),
                pageNumber: page.pageNumber,
                imageUrl: page.imagePath,
                width: 800,
                height: 1100
            }))
        };
    }

    /**
     * Executes answer reconstruction for an answer script, prioritizing TA-tagged ground truth regions.
     * When TA-tagged regions exist, they become the ground truth for question-answer association.
     * Preserves ambiguity flags when expected questions have not yet been confirmed by a TA.
     */
    async reconstructScript(
        scriptId: string | mongoose.Types.ObjectId,
        options?: ReconstructOptions
    ): Promise<IReconstructedAnswer[]> {
        const script = await AnswerScript.findById(scriptId);
        if (!script) {
            throw new HttpError('AnswerScript not found', 404);
        }

        // Fetch rubric to know expected questions
        const rubric = await Rubric.findOne({ exam: script.exam, isActive: true });
        const expectedQuestions = rubric?.questions?.map((q) => q.questionNumber) || [];

        // Check if TA-tagged ground truth regions exist for this script
        const taggedRegions = await TaggedRegion.find({
            answerScript: script._id,
            isGroundTruth: true
        }).sort({ questionNumber: 1, sequenceIndex: 1, pageNumber: 1 });

        let reconstructedAnswers: IReconstructedAnswer[] = [];

        if (taggedRegions.length > 0 && !options?.overrideRegions) {
            // Reconstruct from TA-tagged ground truth regions
            reconstructedAnswers = ContinuationReconstructionEngine.reconstructFromTaggedRegions({
                answerScriptId: script._id,
                examId: script.exam,
                taggedRegions,
                expectedQuestions
            });
        } else {
            // Build raw page regions for heuristic detection / fixtures
            let regions: RawPageRegionInput[] = [];

            if (options?.overrideRegions && options.overrideRegions.length > 0) {
                regions = options.overrideRegions;
            } else {
                // Attempt to load IngestionPages
                const ingestionPages = await IngestionPage.find({ answerScript: script._id }).sort({
                    fileIndex: 1,
                    pageNumber: 1
                });

                if (ingestionPages.length > 0) {
                    regions = ingestionPages.map((p) => ({
                        pageNumber: p.pageNumber,
                        pageId: p._id as mongoose.Types.ObjectId,
                        text: (p.metadata?.extractedText as string) || '',
                        nearBlank: p.nearBlank || false,
                        isCoverPage: p.isCoverPage || false
                    }));
                } else {
                    // Fallback to standard Page collection
                    const standardPages = await Page.find({ answerScript: script._id, isActive: true }).sort({
                        pageNumber: 1
                    });

                    regions = standardPages.map((p) => ({
                        pageNumber: p.pageNumber,
                        pageId: p._id as mongoose.Types.ObjectId,
                        text: '',
                        nearBlank: false,
                        isCoverPage: false
                    }));
                }
            }

            // Execute heuristic reconstruction engine
            reconstructedAnswers = ContinuationReconstructionEngine.reconstruct({
                answerScriptId: script._id,
                examId: script.exam,
                regions,
                expectedQuestions
            });
        }

        // Upsert into ReconstructedAnswer collection
        const savedDocs: IReconstructedAnswer[] = [];
        for (const ans of reconstructedAnswers) {
            const saved = await ReconstructedAnswer.findOneAndUpdate(
                {
                    answerScript: script._id,
                    questionNumber: ans.questionNumber,
                    subQuestion: ans.subQuestion ?? null
                },
                {
                    $set: {
                        exam: script.exam,
                        segments: ans.segments,
                        totalSegments: ans.totalSegments,
                        pagesInvolved: ans.pagesInvolved,
                        isNonConsecutive: ans.isNonConsecutive,
                        isAmbiguous: ans.isAmbiguous,
                        ambiguityReason: ans.ambiguityReason ?? null,
                        reconstructionConfidence: ans.reconstructionConfidence,
                        status: ans.status,
                        isGroundTruth: ans.isGroundTruth ?? false,
                        verifiedBy: ans.verifiedBy ?? null,
                        verifiedAt: ans.verifiedAt ?? null
                    }
                },
                { upsert: true, returnDocument: 'after' }
            );
            if (saved) {
                savedDocs.push(saved);
            }
        }

        if (options?.actingUserId) {
            await writeAuditLog({
                user: options.actingUserId,
                action: 'ANSWER_SEGMENTATION_RECONSTRUCTED',
                outcome: 'SUCCESS',
                details: {
                    scriptId: script._id.toString(),
                    reconstructedCount: savedDocs.length,
                    nonConsecutiveCount: savedDocs.filter((d) => d.isNonConsecutive).length,
                    ambiguousCount: savedDocs.filter((d) => d.isAmbiguous).length,
                    groundTruthCount: savedDocs.filter((d) => d.isGroundTruth).length
                },
                ipAddress: options.ipAddress
            });
        }

        return savedDocs;
    }

    /**
     * Retrieves all reconstructed answers for an answer script.
     */
    async getReconstructedAnswers(
        scriptId: string | mongoose.Types.ObjectId
    ): Promise<IReconstructedAnswer[]> {
        return ReconstructedAnswer.find({ answerScript: scriptId }).sort({ questionNumber: 1 });
    }

    /**
     * Retrieves the reconstructed answer for a specific question of an answer script.
     */
    async getReconstructedAnswerForQuestion(
        scriptId: string | mongoose.Types.ObjectId,
        questionNumber: number
    ): Promise<IReconstructedAnswer | null> {
        return ReconstructedAnswer.findOne({
            answerScript: scriptId,
            questionNumber
        });
    }

    /**
     * Allows a reviewer/TA to manually verify or resolve an ambiguous reconstructed answer.
     */
    async verifyReconstructedAnswer(
        scriptId: string | mongoose.Types.ObjectId,
        questionNumber: number,
        verifiedBy: string,
        notes?: string
    ): Promise<IReconstructedAnswer> {
        const answer = await ReconstructedAnswer.findOne({
            answerScript: scriptId,
            questionNumber
        });

        if (!answer) {
            throw new HttpError('Reconstructed answer not found for question', 404);
        }

        answer.status = 'VERIFIED';
        answer.isAmbiguous = false;
        answer.reviewNotes = notes || 'Manually verified by reviewer';
        answer.verifiedBy = new mongoose.Types.ObjectId(verifiedBy);
        answer.verifiedAt = new Date();
        await answer.save();

        await writeAuditLog({
            user: verifiedBy,
            action: 'ANSWER_SEGMENTATION_VERIFIED',
            outcome: 'SUCCESS',
            details: {
                scriptId: scriptId.toString(),
                questionNumber,
                notes
            }
        });

        return answer;
    }

    private validateBoundingBox(box: IBoundingBox): void {
        if (!box || typeof box !== 'object') {
            throw new HttpError('Invalid bounding box: must be an object with x, y, width, height', 400);
        }
        const { x, y, width, height } = box;
        if (
            typeof x !== 'number' || typeof y !== 'number' ||
            typeof width !== 'number' || typeof height !== 'number' ||
            isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height) ||
            x < 0 || y < 0 || width <= 0 || height <= 0 ||
            x > 1 || y > 1 || width > 1 || height > 1 ||
            x + width > 1.001 || y + height > 1.001
        ) {
            throw new HttpError('Bounding box coordinates must be normalized numbers within [0.0, 1.0]', 400);
        }
    }

    /**
     * Tags a region on a page as belonging to a question (TA Ground Truth).
     * Supports arbitrary question numbers, arbitrary page counts, multiple regions per question,
     * and multiple questions per page.
     */
    async tagRegion(
        scriptId: string | mongoose.Types.ObjectId,
        input: TagRegionInput,
        userId: string
    ): Promise<{ region: ITaggedRegion; reconstructedAnswer: IReconstructedAnswer | null }> {
        const script = await AnswerScript.findById(scriptId);
        if (!script) {
            throw new HttpError('AnswerScript not found', 404);
        }

        const qNum = Number(input.questionNumber);
        if (!Number.isInteger(qNum) || qNum < 1) {
            throw new HttpError('Question number must be a positive integer', 400);
        }

        const pageNum = Number(input.pageNumber);
        if (!Number.isInteger(pageNum) || pageNum < 1) {
            throw new HttpError('Page number must be a positive integer', 400);
        }

        this.validateBoundingBox(input.box);

        let seqIndex = input.sequenceIndex;
        if (seqIndex === undefined || seqIndex === null) {
            const count = await TaggedRegion.countDocuments({
                answerScript: script._id,
                questionNumber: qNum,
                subQuestion: input.subQuestion?.trim() || null
            });
            seqIndex = count + 1;
        }

        const segType: SegmentType =
            input.segmentType || (seqIndex === 1 ? 'START' : 'CONTINUATION');

        const region = new TaggedRegion({
            answerScript: script._id,
            exam: script.exam,
            questionNumber: qNum,
            subQuestion: input.subQuestion?.trim() || undefined,
            pageNumber: pageNum,
            pageId: input.pageId || undefined,
            box: input.box,
            sequenceIndex: seqIndex,
            segmentType: segType,
            isGroundTruth: true,
            taggedBy: new mongoose.Types.ObjectId(userId),
            taggedAt: new Date(),
            notes: input.notes?.trim() || undefined
        });
        await region.save();

        await this.reconstructScript(script._id, { actingUserId: userId });

        const reconstructedAnswer = await this.getReconstructedAnswerForQuestion(script._id, qNum);

        await writeAuditLog({
            user: userId,
            action: 'ANSWER_REGION_TAGGED',
            outcome: 'SUCCESS',
            details: {
                scriptId: script._id.toString(),
                regionId: region._id.toString(),
                questionNumber: qNum,
                pageNumber: pageNum,
                sequenceIndex: seqIndex
            }
        });

        return { region, reconstructedAnswer };
    }

    /**
     * Updates an existing tagged region and re-reconstructs answers.
     */
    async updateRegion(
        regionId: string | mongoose.Types.ObjectId,
        input: Partial<TagRegionInput>,
        userId: string
    ): Promise<ITaggedRegion> {
        const region = await TaggedRegion.findById(regionId);
        if (!region) {
            throw new HttpError('Tagged region not found', 404);
        }

        if (input.box) {
            this.validateBoundingBox(input.box);
            region.box = input.box;
        }
        if (input.questionNumber !== undefined) {
            const q = Number(input.questionNumber);
            if (!Number.isInteger(q) || q < 1) throw new HttpError('Invalid question number', 400);
            region.questionNumber = q;
        }
        if (input.pageNumber !== undefined) {
            const p = Number(input.pageNumber);
            if (!Number.isInteger(p) || p < 1) throw new HttpError('Invalid page number', 400);
            region.pageNumber = p;
        }
        if (input.sequenceIndex !== undefined) {
            region.sequenceIndex = Number(input.sequenceIndex);
        }
        if (input.segmentType) {
            region.segmentType = input.segmentType;
        }
        if (input.notes !== undefined) {
            region.notes = input.notes?.trim() || undefined;
        }
        if (input.subQuestion !== undefined) {
            region.subQuestion = input.subQuestion?.trim() || undefined;
        }

        region.taggedBy = new mongoose.Types.ObjectId(userId);
        region.taggedAt = new Date();
        await region.save();

        await this.reconstructScript(region.answerScript, { actingUserId: userId });

        await writeAuditLog({
            user: userId,
            action: 'ANSWER_REGION_UPDATED',
            outcome: 'SUCCESS',
            details: {
                scriptId: region.answerScript.toString(),
                regionId: region._id.toString(),
                questionNumber: region.questionNumber
            }
        });

        return region;
    }

    /**
     * Removes a tagged region and re-reconstructs the script's question answers.
     */
    async removeRegion(
        regionId: string | mongoose.Types.ObjectId,
        userId: string
    ): Promise<{ success: boolean; removedRegionId: string }> {
        const region = await TaggedRegion.findById(regionId);
        if (!region) {
            throw new HttpError('Tagged region not found', 404);
        }

        const scriptId = region.answerScript;
        const qNum = region.questionNumber;
        await TaggedRegion.findByIdAndDelete(regionId);

        await this.reconstructScript(scriptId, { actingUserId: userId });

        await writeAuditLog({
            user: userId,
            action: 'ANSWER_REGION_REMOVED',
            outcome: 'SUCCESS',
            details: {
                scriptId: scriptId.toString(),
                regionId: regionId.toString(),
                questionNumber: qNum
            }
        });

        return { success: true, removedRegionId: regionId.toString() };
    }

    /**
     * Retrieves all tagged regions for an answer script, optionally filtered by question.
     */
    async getTaggedRegions(
        scriptId: string | mongoose.Types.ObjectId,
        questionNumber?: number
    ): Promise<ITaggedRegion[]> {
        const query: Record<string, unknown> = {
            answerScript: new mongoose.Types.ObjectId(scriptId.toString())
        };
        if (questionNumber !== undefined && !isNaN(questionNumber)) {
            query.questionNumber = questionNumber;
        }
        return TaggedRegion.find(query).sort({ questionNumber: 1, sequenceIndex: 1, pageNumber: 1 });
    }

    /**
     * Batch replaces or saves all regions for a specific question.
     */
    async saveQuestionRegions(
        scriptId: string | mongoose.Types.ObjectId,
        questionNumber: number,
        regions: TagRegionInput[],
        userId: string,
        subQuestion?: string
    ): Promise<IReconstructedAnswer | null> {
        const script = await AnswerScript.findById(scriptId);
        if (!script) {
            throw new HttpError('AnswerScript not found', 404);
        }

        const qNum = Number(questionNumber);
        if (!Number.isInteger(qNum) || qNum < 1) {
            throw new HttpError('Question number must be a positive integer', 400);
        }

        for (const reg of regions) {
            this.validateBoundingBox(reg.box);
        }

        await TaggedRegion.deleteMany({
            answerScript: script._id,
            questionNumber: qNum,
            subQuestion: subQuestion?.trim() || null
        });

        const docs = regions.map((reg, idx) => ({
            answerScript: script._id,
            exam: script.exam,
            questionNumber: qNum,
            subQuestion: (reg.subQuestion || subQuestion)?.trim() || null,
            pageNumber: reg.pageNumber,
            pageId: reg.pageId || null,
            box: reg.box,
            sequenceIndex: reg.sequenceIndex ?? idx + 1,
            segmentType: reg.segmentType || (idx === 0 ? (regions.length === 1 ? 'ISOLATED' : 'START') : 'CONTINUATION'),
            isGroundTruth: true,
            taggedBy: new mongoose.Types.ObjectId(userId),
            taggedAt: new Date(),
            notes: reg.notes?.trim() || null
        }));

        if (docs.length > 0) {
            await TaggedRegion.insertMany(docs);
        }

        await this.reconstructScript(script._id, { actingUserId: userId });

        return this.getReconstructedAnswerForQuestion(script._id, qNum);
    }
}

const answerSegmentationService = new AnswerSegmentationService();
export default answerSegmentationService;
