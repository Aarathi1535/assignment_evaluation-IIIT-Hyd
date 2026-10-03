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
    RegisterSampleWorkflowResult,
    WithinScriptAssessmentPage
} from './HandwritingConsistencyWorkflowService';
import { IHandwritingComparisonDocument } from '../../models/HandwritingComparison';
import { HttpError } from '../../lib/errors';
import { ComparisonMatchState } from '../../models/HandwritingConsistency';

export interface AnswerScriptProcessingSummary {
    answerScriptId: string;
    studentId: string;
    totalRegions: number;
    results: (RegisterSampleWorkflowResult | IHandwritingComparisonDocument)[];
}

export interface AnswerScriptHandwritingAnalysis {
    outcome: 'BASELINE_BUILDING' | 'INITIAL_REVIEW_REQUIRED' | 'PROFILE_COMPARISON' | 'INSUFFICIENT_SAMPLE' | 'INCONCLUSIVE';
    answerScriptId: string;
    pagesProcessed: number;
    profileSampleCount: number;
    profileStatus?: string;
    comparisons: IHandwritingComparisonDocument[];
}

export interface AnswerScriptInternalConsistencyAnalysis {
    outcome: 'CONSISTENT' | 'DISCREPANCY_DETECTED' | 'INCONCLUSIVE';
    answerScriptId: string;
    studentId: string;
    pagesProcessed: number;
    comparisons: WithinScriptAssessmentPage[];
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

    /** Builds explicit page-sized regions when ingestion has no question-zone metadata. */
    private createWholePageRegions(pages: IResolvedAnswerSheetPage[]): RawAnswerRegion[] {
        if (pages.length === 0) {
            throw new HttpError('No readable stored pages were found for this AnswerScript', 422);
        }
        return pages.map((page) => ({
            regionId: `page-${page.pageNumber}-full-page`,
            pageNumber: page.pageNumber,
            boundingBox: { x: 0, y: 0, width: 1, height: 1 },
            confidence: 1,
            metadata: { scope: 'FULL_PAGE' }
        }));
    }

    /** Automatically chooses internal consistency assessment or profile comparison. */
    public async analyzeAnswerScript(
        answerScriptId: string,
        authContext: HandwritingAuthContext
    ): Promise<AnswerScriptHandwritingAnalysis> {
        const pages = await this.sourceAdapter.resolveAnswerSheetPages(answerScriptId);
        const { studentId, answerScript } = await this.sourceAdapter.resolveAnswerScriptStudent(answerScriptId);
        const profile = await this.workflowService.getStudentProfile(studentId, authContext);

        if (profile?.status === 'ESTABLISHED') {
            const comparisons = await this.compareAnswerScriptRegions(
                answerScriptId,
                this.createWholePageRegions(pages),
                authContext,
                studentId,
                pages
            );
            return {
                outcome: 'PROFILE_COMPARISON',
                answerScriptId,
                pagesProcessed: pages.length,
                profileSampleCount: profile.sampleCount,
                profileStatus: profile.status,
                comparisons
            };
        }

        const assessments = await this.workflowService.assessWithinScriptConsistency(
            studentId,
            pages.map(page => ({
                sourceReference: page.sourceReference,
                pageNumber: page.pageNumber,
                imageBuffer: page.imageBuffer,
                answerScriptId,
                examId: page.examId
            })),
            authContext
        );
        if (assessments.length === 0) {
            return {
                outcome: 'INSUFFICIENT_SAMPLE',
                answerScriptId,
                pagesProcessed: pages.length,
                profileSampleCount: profile?.sampleCount ?? 0,
                profileStatus: profile?.status,
                comparisons: []
            };
        }

        const isSuspicious = assessments.some(page => page.status === ComparisonMatchState.REVIEW_REQUIRED);
        const isInsufficient = assessments.some(page => page.status === ComparisonMatchState.INSUFFICIENT_SAMPLE);
        const internallyConsistent = assessments.every(page => page.status === ComparisonMatchState.MATCH);
        let persistedSamples: Array<{ sample: { _id: { toString(): string }; pageNumber?: number } }> = [];
        if (!isSuspicious && internallyConsistent) {
            persistedSamples = await this.processAnswerScriptRegionsForBaseline(
                answerScriptId,
                this.createWholePageRegions(pages),
                authContext,
                studentId,
                pages,
                false
            );
            await this.workflowService.rebuildProfile(studentId, authContext);
        }

        const comparisons: IHandwritingComparisonDocument[] = [];
        for (const assessment of assessments) {
            if (!assessment.features) continue;
            const acceptedSample = persistedSamples.find(item => item.sample.pageNumber === assessment.pageNumber)?.sample;
            const sample = acceptedSample || (await this.workflowService.registerSample({
                    studentId,
                    sourceReference: assessment.sourceReference,
                    sampleType: 'EXAM_SCRIPT',
                    features: assessment.features,
                    pageNumber: assessment.pageNumber,
                    answerScriptId,
                    autoRebuildProfile: false,
                    includeInProfile: false
                }, authContext)).sample;
            comparisons.push(await this.workflowService.persistWithinScriptComparison(
                studentId,
                sample._id.toString(),
                {
                    answerScriptId,
                    examId: answerScript.exam.toString(),
                    pageNumber: assessment.pageNumber,
                    result: assessment
                },
                authContext
            ));
        }

        const resultingProfile = await this.workflowService.getStudentProfile(studentId, authContext);
        const outcome = isSuspicious
            ? 'INITIAL_REVIEW_REQUIRED'
            : isInsufficient
                ? 'INSUFFICIENT_SAMPLE'
            : internallyConsistent
                ? 'BASELINE_BUILDING'
                : 'INCONCLUSIVE';

        return {
            outcome,
            answerScriptId,
            pagesProcessed: pages.length,
            profileSampleCount: resultingProfile?.sampleCount ?? 0,
            profileStatus: resultingProfile?.status,
            comparisons
        };
    }

    /** Analyze only the submitted AnswerScript; no consent lookup, profile access, or sample enrollment. */
    public async analyzeAnswerScriptInternalConsistency(
        answerScriptId: string,
        authContext: HandwritingAuthContext
    ): Promise<AnswerScriptInternalConsistencyAnalysis> {
        const pages = await this.sourceAdapter.resolveAnswerSheetPages(answerScriptId);
        const { studentId } = await this.sourceAdapter.resolveAnswerScriptStudent(answerScriptId);
        const comparisons = await this.workflowService.assessWithinScriptConsistency(
            studentId,
            pages.map(page => ({
                sourceReference: page.sourceReference,
                pageNumber: page.pageNumber,
                imageBuffer: page.imageBuffer,
                answerScriptId,
                examId: page.examId
            })),
            authContext,
            { requireConsent: false }
        );

        const outcome = comparisons.length === 0 ||
            comparisons.some(item => item.status === ComparisonMatchState.INSUFFICIENT_SAMPLE || item.status === ComparisonMatchState.INCONCLUSIVE)
            ? 'INCONCLUSIVE'
            : comparisons.some(item => item.status === ComparisonMatchState.REVIEW_REQUIRED)
                ? 'DISCREPANCY_DETECTED'
                : comparisons.every(item => item.status === ComparisonMatchState.MATCH)
                    ? 'CONSISTENT'
                    : 'INCONCLUSIVE';

        return { outcome, answerScriptId, studentId, pagesProcessed: pages.length, comparisons };
    }

    /** Explicitly enrolls a real, identified AnswerScript as handwriting baseline material. */
    public async enrollAnswerScriptBaseline(
        answerScriptId: string,
        authContext: HandwritingAuthContext
    ): Promise<RegisterSampleWorkflowResult[]> {
        const pages = await this.sourceAdapter.resolveAnswerSheetPages(answerScriptId);
        const { studentId } = await this.sourceAdapter.resolveAnswerScriptStudent(answerScriptId);
        const regions = this.createWholePageRegions(pages);
        return await this.processAnswerScriptRegionsForBaseline(
            answerScriptId,
            regions,
            authContext,
            studentId,
            pages
        );
    }

    /** Compares real stored AnswerScript pages to the student's current persisted profile. */
    public async compareAnswerScriptPages(
        answerScriptId: string,
        authContext: HandwritingAuthContext
    ): Promise<IHandwritingComparisonDocument[]> {
        const pages = await this.sourceAdapter.resolveAnswerSheetPages(answerScriptId);
        const { studentId } = await this.sourceAdapter.resolveAnswerScriptStudent(answerScriptId);
        const comparisons = await this.compareAnswerScriptRegions(
            answerScriptId,
            this.createWholePageRegions(pages),
            authContext,
            studentId,
            pages
        );
        if (comparisons.length === pages.length && comparisons.length > 0 &&
            comparisons.every(comparison => comparison.status === ComparisonMatchState.MATCH)) {
            await this.workflowService.acceptMatchedSamplesIntoProfile(
                studentId,
                comparisons.map(comparison => comparison.sample.toString()),
                authContext
            );
        }
        return comparisons;
    }

    /**
     * Resolves already-provided answer-sheet pages and regions without looking up or
     * persisting AnswerScript records. Used by request-scoped synthetic demos while
     * preserving the same page/region validation path as stored answer sheets.
     */
    public resolveProvidedAnswerSheetRegions(
        answerScriptId: string,
        studentId: string,
        regions: RawAnswerRegion[],
        pages: IResolvedAnswerSheetPage[]
    ): IResolvedAnswerRegion[] {
        const result = this.regionResolver.resolveRegions(answerScriptId, studentId, regions, pages);
        if (!result.resolved) {
            throw new HttpError(result.unresolvedReason || 'Answer regions could not be resolved', 422);
        }
        return result.regions;
    }

    /**
     * Ingests a single resolved answer region as a handwriting baseline sample.
     * Uses deterministic sourceReference to prevent duplicate sample registration.
     */
    public async processAnswerRegionForBaseline(
        region: IResolvedAnswerRegion,
        authContext: HandwritingAuthContext,
        autoRebuildProfile = true
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
                autoRebuildProfile
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
        authContext: HandwritingAuthContext,
        updateProfileOnMatch = true
    ): Promise<IHandwritingComparisonDocument> {
        return await this.workflowService.compareSample(
            region.studentId,
            {
                sourceReference: region.sourceReference,
                imageBuffer: region.imageBuffer,
                boundingBox: region.boundingBox,
                pageNumber: region.pageNumber,
                answerScriptId: region.answerScriptId,
                examId: region.examId,
                questionNumber: region.questionNumber,
                sampleType: 'EXAM_SCRIPT',
                updateProfileOnMatch
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
        pagesOverride?: IResolvedAnswerSheetPage[],
        autoRebuildProfile = true
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
            const res = await this.processAnswerRegionForBaseline(reg, authContext, autoRebuildProfile);
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
            const comp = await this.compareAnswerRegion(reg, authContext, false);
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
