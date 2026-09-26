import {
    AnswerSheetSourceAdapter,
    answerSheetSourceAdapter,
    IResolvedAnswerSheetPage
} from './AnswerSheetSourceAdapter';
import {
    AnswerRegionResolver,
    answerRegionResolver,
    RawAnswerRegion,
    IResolvedAnswerRegion,
    Direction3ReconstructedAnswerLike
} from './AnswerRegionResolver';
import {
    HandwritingConsistencyWorkflowService,
    handwritingConsistencyWorkflowService,
    HandwritingAuthContext,
    RegisterSampleWorkflowResult
} from './HandwritingConsistencyWorkflowService';
import { IHandwritingComparisonDocument } from '../../models/HandwritingComparison';
import { HttpError } from '../../lib/errors';

export interface AnswerScriptProcessingSummary {
    answerScriptId: string;
    studentId: string;
    totalRegions: number;
    results: (RegisterSampleWorkflowResult | IHandwritingComparisonDocument)[];
}

/**
 * Orchestrating service connecting actual stored/rendered answer-sheet pages and segmented answer
 * regions to the persistent handwriting consistency workflow.
 *
 * NOTE: Strictly isolated from production grading. Never modifies grading models,
 * allocation, script flags, or production ingestion pipelines.
 */
export class AnswerSheetHandwritingIntegrationService {
    constructor(
        private readonly sourceAdapter: AnswerSheetSourceAdapter = answerSheetSourceAdapter,
        private readonly regionResolver: AnswerRegionResolver = answerRegionResolver,
        private readonly workflowService: HandwritingConsistencyWorkflowService = handwritingConsistencyWorkflowService
    ) {}

    /**
     * Ingests a single resolved answer region as a handwriting baseline sample.
     * Uses deterministic sourceReference to prevent duplicate sample registration.
     */
    public async processAnswerRegionForBaseline(
        region: IResolvedAnswerRegion,
        authContext: HandwritingAuthContext
    ): Promise<RegisterSampleWorkflowResult> {
        return await this.workflowService.registerSample(
            {
                studentId: region.studentId,
                sourceReference: region.sourceReference,
                sampleType: 'EXAM_SCRIPT',
                imageBuffer: region.imageBuffer,
                boundingBox: region.boundingBox,
                pageNumber: region.pageNumber,
                answerScriptId: region.answerScriptId,
                autoRebuildProfile: true
            },
            authContext
        );
    }

    /**
     * Compares a single resolved answer region against the student's current profile.
     * Tied immutably to the exact profile version active at comparison time.
     */
    public async compareAnswerRegion(
        region: IResolvedAnswerRegion,
        authContext: HandwritingAuthContext
    ): Promise<IHandwritingComparisonDocument> {
        return await this.workflowService.compareSample(
            region.studentId,
            {
                sourceReference: region.sourceReference,
                imageBuffer: region.imageBuffer,
                boundingBox: region.boundingBox,
                pageNumber: region.pageNumber,
                answerScriptId: region.answerScriptId
            },
            authContext
        );
    }

    /**
     * Resolves answer regions from an AnswerScript and registers them as baseline samples.
     * Enforces trusted student identity from AnswerScript.
     */
    public async processAnswerScriptRegionsForBaseline(
        answerScriptId: string,
        regions: RawAnswerRegion[],
        authContext: HandwritingAuthContext,
        candidateStudentId?: string,
        pagesOverride?: IResolvedAnswerSheetPage[]
    ): Promise<RegisterSampleWorkflowResult[]> {
        // 1. Resolve trusted student and physical page images
        const pages = pagesOverride || (await this.sourceAdapter.resolveAnswerSheetPages(
            answerScriptId,
            candidateStudentId
        ));

        const { studentId } = await this.sourceAdapter.resolveAnswerScriptStudent(
            answerScriptId,
            candidateStudentId
        );

        // 2. Resolve regions with strict bounding-box validation
        const resolutionResult = this.regionResolver.resolveRegions(
            answerScriptId,
            studentId,
            regions,
            pages
        );

        if (!resolutionResult.resolved) {
            throw new HttpError(
                resolutionResult.unresolvedReason || 'Answer regions could not be resolved from answer sheet',
                422
            );
        }

        // 3. Process each resolved region independently
        const results: RegisterSampleWorkflowResult[] = [];
        for (const reg of resolutionResult.regions) {
            const res = await this.processAnswerRegionForBaseline(reg, authContext);
            results.push(res);
        }

        return results;
    }

    /**
     * Resolves answer regions from an AnswerScript and compares them against the student's profile.
     */
    public async compareAnswerScriptRegions(
        answerScriptId: string,
        regions: RawAnswerRegion[],
        authContext: HandwritingAuthContext,
        candidateStudentId?: string,
        pagesOverride?: IResolvedAnswerSheetPage[]
    ): Promise<IHandwritingComparisonDocument[]> {
        // 1. Resolve trusted student and physical page images
        const pages = pagesOverride || (await this.sourceAdapter.resolveAnswerSheetPages(
            answerScriptId,
            candidateStudentId
        ));

        const { studentId } = await this.sourceAdapter.resolveAnswerScriptStudent(
            answerScriptId,
            candidateStudentId
        );

        // 2. Resolve regions
        const resolutionResult = this.regionResolver.resolveRegions(
            answerScriptId,
            studentId,
            regions,
            pages
        );

        if (!resolutionResult.resolved) {
            throw new HttpError(
                resolutionResult.unresolvedReason || 'Answer regions could not be resolved from answer sheet',
                422
            );
        }

        // 3. Compare each region independently
        const comparisons: IHandwritingComparisonDocument[] = [];
        for (const reg of resolutionResult.regions) {
            const comp = await this.compareAnswerRegion(reg, authContext);
            comparisons.push(comp);
        }

        return comparisons;
    }

    /**
     * Evaluates a Direction 3 ReconstructedAnswer (which may contain multiple non-consecutive segments)
     * against the student's handwriting profile.
     */
    public async compareDirection3ReconstructedAnswer(
        reconstructedAnswer: Direction3ReconstructedAnswerLike,
        authContext: HandwritingAuthContext,
        candidateStudentId?: string,
        pagesOverride?: IResolvedAnswerSheetPage[]
    ): Promise<IHandwritingComparisonDocument[]> {
        const answerScriptId = typeof reconstructedAnswer.answerScript === 'object'
            ? reconstructedAnswer.answerScript.toString()
            : reconstructedAnswer.answerScript;

        const pages = pagesOverride || (await this.sourceAdapter.resolveAnswerSheetPages(
            answerScriptId,
            candidateStudentId
        ));

        const { studentId } = await this.sourceAdapter.resolveAnswerScriptStudent(
            answerScriptId,
            candidateStudentId
        );

        const resolutionResult = this.regionResolver.resolveFromDirection3ReconstructedAnswer(
            reconstructedAnswer,
            studentId,
            pages
        );

        if (!resolutionResult.resolved) {
            throw new HttpError(
                resolutionResult.unresolvedReason || 'Direction 3 reconstructed segments could not be resolved',
                422
            );
        }

        const comparisons: IHandwritingComparisonDocument[] = [];
        for (const reg of resolutionResult.regions) {
            const comp = await this.compareAnswerRegion(reg, authContext);
            comparisons.push(comp);
        }

        return comparisons;
    }
}

export const answerSheetHandwritingIntegrationService = new AnswerSheetHandwritingIntegrationService();
export default answerSheetHandwritingIntegrationService;
