import mongoose from 'mongoose';
import AnswerScript from '../models/AnswerScript';
import IngestionPage from '../models/IngestionPage';
import Page from '../models/Page';
import Rubric from '../models/Rubric';
import ReconstructedAnswer, { IReconstructedAnswer } from '../models/AnswerSegmentation';
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

export class AnswerSegmentationService {
    /**
     * Executes answer reconstruction for an answer script, associating pages and regions
     * with rubric questions even across non-consecutive pages and out-of-order responses.
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

        // Build raw page regions
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

        // Execute reconstruction engine
        const reconstructedAnswers = ContinuationReconstructionEngine.reconstruct({
            answerScriptId: script._id,
            examId: script.exam,
            regions,
            expectedQuestions
        });

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
                        status: ans.status
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
                    ambiguousCount: savedDocs.filter((d) => d.isAmbiguous).length
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
}

const answerSegmentationService = new AnswerSegmentationService();
export default answerSegmentationService;
