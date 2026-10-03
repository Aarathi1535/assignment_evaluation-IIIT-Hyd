import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
    ComparisonMatchState,
    IHandwritingComparisonResult,
    IHandwritingFeatures,
    IHandwritingProfileData,
    SampleExtractionStatus
} from '../../models/HandwritingConsistency';
import { HandwritingFixtureGenerator } from '../../__tests__/fixtures/HandwritingFixtureGenerator';
import { IResolvedAnswerSheetPage } from './AnswerSheetSourceAdapter';
import { IResolvedAnswerRegion, RawAnswerRegion } from './AnswerRegionResolver';
import {
    AnswerSheetHandwritingIntegrationService,
    answerSheetHandwritingIntegrationService
} from './AnswerSheetHandwritingIntegrationService';
import { HandwritingComparisonEngine } from './HandwritingComparisonEngine';
import { HandwritingFeatureExtractor } from './HandwritingFeatureExtractor';
import { HandwritingProfileBuilder } from './HandwritingProfileBuilder';

export type HandwritingDemoAction = 'load' | 'analyze';

export interface HandwritingDemoPage {
    pageNumber: number;
    label: string;
    imageDataUrl: string;
}

export interface HandwritingDemoRegion {
    regionId: string;
    questionNumber: number;
    pageNumber: number;
    label: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    status?: SampleExtractionStatus;
    features?: IHandwritingFeatures;
    disqualificationReason?: string;
}

export interface HandwritingDemoRegionComparison {
    regionId: string;
    questionNumber: number;
    pageNumber: number;
    comparison: IHandwritingComparisonResult;
}

export interface HandwritingDemoAnalysis {
    pagesAnalyzed: number;
    regionsAnalyzed: number;
    baselineRegionIds: string[];
    profile: IHandwritingProfileData;
    comparisons: HandwritingDemoRegionComparison[];
    status: ComparisonMatchState;
    reviewRequired: boolean;
}

export interface HandwritingDemoResult {
    studentLabel: string;
    examLabel: string;
    pages: HandwritingDemoPage[];
    regions: HandwritingDemoRegion[];
    analysis?: HandwritingDemoAnalysis;
}

interface SyntheticAnswerSheet {
    pages: IResolvedAnswerSheetPage[];
    regions: RawAnswerRegion[];
}

interface ExtractedDemoRegion {
    region: IResolvedAnswerRegion;
    status: SampleExtractionStatus;
    features?: IHandwritingFeatures;
    disqualificationReason?: string;
}

const DEMO_ANSWER_SCRIPT_ID = 'synthetic-demo-answer-script';
const DEMO_STUDENT_ID = 'synthetic-demo-student';
const BASELINE_REGION_IDS = ['page-1-question-1', 'page-2-question-3', 'page-3-question-5'];

/** Request-scoped synthetic answer-sheet workflow; no student or script is persisted. */
export class HandwritingDemoService {
    constructor(
        private readonly featureExtractor = new HandwritingFeatureExtractor(),
        private readonly profileBuilder = new HandwritingProfileBuilder(featureExtractor),
        private readonly comparisonEngine = new HandwritingComparisonEngine(featureExtractor),
        private readonly answerSheetIntegration = answerSheetHandwritingIntegrationService
    ) {}

    public async run(action: HandwritingDemoAction): Promise<HandwritingDemoResult> {
        const syntheticSheet = await this.createSyntheticAnswerSheet();
        const result = this.toDemoResult(syntheticSheet);
        if (action === 'load') return result;

        const resolvedRegions = this.answerSheetIntegration.resolveProvidedAnswerSheetRegions(
            DEMO_ANSWER_SCRIPT_ID,
            DEMO_STUDENT_ID,
            syntheticSheet.regions,
            syntheticSheet.pages
        );

        const extractedRegions: ExtractedDemoRegion[] = [];
        for (const region of resolvedRegions) {
            const extraction = await this.featureExtractor.extractFeatures(region.imageBuffer, region.boundingBox);
            extractedRegions.push({
                region,
                status: extraction.status,
                features: extraction.features,
                disqualificationReason: extraction.disqualificationReason
            });
        }

        const baseline = extractedRegions.filter(({ region }) => BASELINE_REGION_IDS.includes(region.regionId));
        const profileResult = await this.profileBuilder.buildProfile(
            DEMO_STUDENT_ID,
            baseline.map(({ region, status, features, disqualificationReason }) => ({
                sampleId: region.regionId,
                answerScriptId: region.answerScriptId,
                pageNumber: region.pageNumber,
                boundingBox: region.boundingBox,
                imageBuffer: region.imageBuffer,
                status,
                features,
                disqualificationReason
            }))
        );

        const comparisons: HandwritingDemoRegionComparison[] = [];
        for (const sample of extractedRegions.filter(({ region }) => !BASELINE_REGION_IDS.includes(region.regionId))) {
            const comparison = await this.comparisonEngine.compare(profileResult.profile, {
                sampleId: sample.region.regionId,
                answerScriptId: sample.region.answerScriptId,
                pageNumber: sample.region.pageNumber,
                boundingBox: sample.region.boundingBox,
                imageBuffer: sample.region.imageBuffer,
                status: sample.status,
                features: sample.features,
                disqualificationReason: sample.disqualificationReason
            });
            comparisons.push({
                regionId: sample.region.regionId,
                questionNumber: sample.region.questionNumber ?? 0,
                pageNumber: sample.region.pageNumber,
                comparison
            });
        }

        const reviewRequired = comparisons.some(({ comparison }) => comparison.status === ComparisonMatchState.REVIEW_REQUIRED);
        const status = reviewRequired
            ? ComparisonMatchState.REVIEW_REQUIRED
            : comparisons.every(({ comparison }) => comparison.status === ComparisonMatchState.MATCH)
                ? ComparisonMatchState.MATCH
                : comparisons.find(({ comparison }) => comparison.status !== ComparisonMatchState.MATCH)?.comparison.status
                    ?? ComparisonMatchState.UNASSESSED;

        return {
            ...result,
            regions: result.regions.map((demoRegion) => {
                const extracted = extractedRegions.find(({ region }) => region.regionId === demoRegion.regionId);
                return extracted ? {
                    ...demoRegion,
                    status: extracted.status,
                    features: extracted.features,
                    disqualificationReason: extracted.disqualificationReason
                } : demoRegion;
            }),
            analysis: {
                pagesAnalyzed: syntheticSheet.pages.length,
                regionsAnalyzed: resolvedRegions.length,
                baselineRegionIds: BASELINE_REGION_IDS,
                profile: profileResult.profile,
                comparisons,
                status,
                reviewRequired
            }
        };
    }

    private async createSyntheticAnswerSheet(): Promise<SyntheticAnswerSheet> {
        const consistent = (seed: number) => HandwritingFixtureGenerator.createConsistentSample(seed);
        const pageBuffers = await Promise.all([
            this.composePage(consistent(42), consistent(43)),
            this.composePage(consistent(44), consistent(45)),
            this.composePage(consistent(46)),
            this.composePage(HandwritingFixtureGenerator.createThickStrokeSample(5))
        ]);

        const pages = pageBuffers.map((imageBuffer, index): IResolvedAnswerSheetPage => ({
            answerScriptId: DEMO_ANSWER_SCRIPT_ID,
            studentId: DEMO_STUDENT_ID,
            pageNumber: index + 1,
            sourceReference: `${DEMO_ANSWER_SCRIPT_ID}_page_${index + 1}`,
            imageBuffer
        }));

        const regions: RawAnswerRegion[] = [
            { regionId: 'page-1-question-1', questionNumber: 1, pageNumber: 1, boundingBox: { x: 0.04, y: 0.025, width: 0.92, height: 0.45 }, confidence: 1 },
            { regionId: 'page-1-question-2', questionNumber: 2, pageNumber: 1, boundingBox: { x: 0.04, y: 0.525, width: 0.92, height: 0.45 }, confidence: 1 },
            { regionId: 'page-2-question-3', questionNumber: 3, pageNumber: 2, boundingBox: { x: 0.04, y: 0.025, width: 0.92, height: 0.45 }, confidence: 1 },
            { regionId: 'page-2-question-4', questionNumber: 4, pageNumber: 2, boundingBox: { x: 0.04, y: 0.525, width: 0.92, height: 0.45 }, confidence: 1 },
            { regionId: 'page-3-question-5', questionNumber: 5, pageNumber: 3, boundingBox: { x: 0.04, y: 0.025, width: 0.92, height: 0.45 }, confidence: 1 },
            { regionId: 'page-4-question-6', questionNumber: 6, pageNumber: 4, boundingBox: { x: 0.04, y: 0.025, width: 0.92, height: 0.45 }, confidence: 1 }
        ];

        return { pages, regions };
    }

    private async composePage(topRegion: Buffer, bottomRegion?: Buffer): Promise<Buffer> {
        const canvas = createCanvas(500, 800);
        const context = canvas.getContext('2d');
        context.fillStyle = '#FFFFFF';
        context.fillRect(0, 0, 500, 800);
        const topImage = await loadImage(topRegion);
        context.drawImage(topImage, 0, 0, 500, 400);
        if (bottomRegion) {
            const bottomImage = await loadImage(bottomRegion);
            context.drawImage(bottomImage, 0, 400, 500, 400);
        }
        return canvas.toBuffer('image/png');
    }

    private toDemoResult(sheet: SyntheticAnswerSheet): HandwritingDemoResult {
        return {
            studentLabel: 'Student A (synthetic)',
            examLabel: 'AI Fundamentals (synthetic)',
            pages: sheet.pages.map((page) => ({
                pageNumber: page.pageNumber,
                label: `Page ${page.pageNumber}`,
                imageDataUrl: `data:image/png;base64,${page.imageBuffer.toString('base64')}`
            })),
            regions: sheet.regions.map((region) => ({
                regionId: region.regionId,
                questionNumber: region.questionNumber ?? 0,
                pageNumber: region.pageNumber,
                label: `Question ${region.questionNumber}`,
                boundingBox: region.boundingBox as { x: number; y: number; width: number; height: number },
            }))
        };
    }
}

export const handwritingDemoService = new HandwritingDemoService();
