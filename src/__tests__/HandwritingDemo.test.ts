import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole } from '../constants/permissions';
import { ComparisonMatchState, ProfileStatus, SampleExtractionStatus } from '../models/HandwritingConsistency';
import { POST as demoPOST } from '../app/api/research/handwriting/demo/route';
import HandwritingResearchPage from '../app/(dashboard)/research/handwriting/page';
import { HandwritingDemoService } from '../services/handwriting/HandwritingDemoService';
import { HandwritingFeatureExtractor } from '../services/handwriting/HandwritingFeatureExtractor';
import { HandwritingComparisonEngine } from '../services/handwriting/HandwritingComparisonEngine';
import { AnswerSheetHandwritingIntegrationService } from '../services/handwriting/AnswerSheetHandwritingIntegrationService';

let mockSessionUser: { id: string; email: string; name: string; role: string } | null = null;

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => (
            mockSessionUser ? Promise.resolve({ user: mockSessionUser }) : Promise.resolve(null)
        ))
    };
});

describe('Handwriting answer-sheet research demo', () => {
    const service = new HandwritingDemoService();

    beforeEach(() => {
        vi.restoreAllMocks();
        mockSessionUser = null;
        process.env.FEATURE_HANDWRITING_CONSISTENCY = 'true';
        delete process.env.NEXT_PUBLIC_FEATURE_HANDWRITING_CONSISTENCY;
    });

    it('loads a deterministic synthetic four-page answer sheet with six answer regions', async () => {
        const result = await service.run('load');

        expect(result.studentLabel).toContain('synthetic');
        expect(result.pages).toHaveLength(4);
        expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4]);
        expect(result.pages.every((page) => page.imageDataUrl.startsWith('data:image/png;base64,'))).toBe(true);
        expect(result.regions).toHaveLength(6);
        expect(result.regions.map((region) => [region.pageNumber, region.questionNumber])).toEqual([
            [1, 1], [1, 2], [2, 3], [2, 4], [3, 5], [4, 6]
        ]);
        expect(JSON.stringify(result)).not.toContain('candidateStyle');
    });

    it('analyzes regions through the answer-sheet resolver, extractor, profile builder, and comparison engine', async () => {
        const extractSpy = vi.spyOn(HandwritingFeatureExtractor.prototype, 'extractFeatures');
        const resolveSpy = vi.spyOn(AnswerSheetHandwritingIntegrationService.prototype, 'resolveProvidedAnswerSheetRegions');
        const compareSpy = vi.spyOn(HandwritingComparisonEngine.prototype, 'compare');

        const result = await service.run('analyze');

        expect(resolveSpy).toHaveBeenCalledOnce();
        expect(extractSpy).toHaveBeenCalledTimes(6);
        expect(compareSpy).toHaveBeenCalledTimes(3);
        expect(result.analysis?.pagesAnalyzed).toBe(4);
        expect(result.analysis?.regionsAnalyzed).toBe(6);
        expect(result.analysis?.profile.status).toBe(ProfileStatus.ESTABLISHED);
        expect(result.analysis?.profile.sampleCount).toBe(3);
        expect(result.regions.every((region) => region.status === SampleExtractionStatus.VALID)).toBe(true);
        expect(result.analysis?.comparisons).toHaveLength(3);
        expect(result.analysis?.comparisons.map((item) => item.questionNumber)).toEqual([2, 4, 6]);
    });

    it('reports a Page 4 discrepancy only when the existing engine returns REVIEW_REQUIRED', async () => {
        const result = await service.run('analyze');
        const pageFour = result.analysis?.comparisons.find((item) => item.pageNumber === 4);

        expect(pageFour).toBeDefined();
        expect(pageFour?.comparison.status).toBe(ComparisonMatchState.REVIEW_REQUIRED);
        expect(result.analysis?.reviewRequired).toBe(true);
        expect(result.analysis?.status).toBe(ComparisonMatchState.REVIEW_REQUIRED);
        expect(pageFour?.comparison.distance).toBeGreaterThan(0);
        expect(pageFour?.comparison.featureDeviations.length).toBeGreaterThan(0);
    });

    it('allows Professors and Admins, denies Students, and keeps the demo behind the feature flag', async () => {
        const request = (action: 'load' | 'analyze') => new NextRequest('http://localhost/api/research/handwriting/demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        mockSessionUser = { id: 'professor-id', email: 'professor@example.test', name: 'Professor', role: UserRole.PROFESSOR };
        const professorResponse = await demoPOST(request('load'));
        expect(professorResponse.status).toBe(200);
        expect((await professorResponse.json()).data.pages).toHaveLength(4);

        mockSessionUser.role = UserRole.ADMIN;
        expect((await demoPOST(request('load'))).status).toBe(200);

        mockSessionUser.role = UserRole.PROFESSOR;
        const analysisResponse = await demoPOST(request('analyze'));
        const analysisJson = await analysisResponse.json();
        expect(analysisResponse.status).toBe(200);
        expect(analysisJson.data.analysis.status).toBe(ComparisonMatchState.REVIEW_REQUIRED);
        expect(analysisJson.data.analysis.comparisons.find((item: { pageNumber: number }) => item.pageNumber === 4).comparison.status)
            .toBe(ComparisonMatchState.REVIEW_REQUIRED);

        mockSessionUser.role = UserRole.STUDENT;
        expect((await demoPOST(request('load'))).status).toBe(403);

        mockSessionUser.role = UserRole.PROFESSOR;
        delete process.env.FEATURE_HANDWRITING_CONSISTENCY;
        expect((await demoPOST(request('load'))).status).toBe(404);
    });

    it('allows Professor page access, denies Students, and hides the page when disabled', async () => {
        mockSessionUser = { id: 'professor-id', email: 'professor@example.test', name: 'Professor', role: UserRole.PROFESSOR };
        expect(await HandwritingResearchPage()).toBeDefined();

        mockSessionUser.role = UserRole.STUDENT;
        await expect(HandwritingResearchPage()).rejects.toThrow();

        mockSessionUser.role = UserRole.PROFESSOR;
        delete process.env.FEATURE_HANDWRITING_CONSISTENCY;
        await expect(HandwritingResearchPage()).rejects.toThrow();
    });

    it('does not offer an expected-result selector or plagiarism claim in the Professor UI', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/components/handwriting/HandwritingResearchDemo.tsx'), 'utf8');
        expect(source).not.toContain('Candidate handwriting');
        expect(source).not.toContain('Different handwriting');
        expect(source).not.toContain('<select');
        expect(source.toLowerCase()).not.toContain('confirmed plagiarism');
        expect(source).toContain('Potential handwriting discrepancy detected');
        expect(source).toContain('comparison.status === ComparisonMatchState.REVIEW_REQUIRED');
    });

    it('rejects an unsupported demo action', async () => {
        mockSessionUser = { id: 'professor-id', email: 'professor@example.test', name: 'Professor', role: UserRole.PROFESSOR };
        const response = await demoPOST(new NextRequest('http://localhost/api/research/handwriting/demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'compare', candidateStyle: 'DIFFERENT' })
        }));
        expect(response.status).toBe(400);

        const expectedResultResponse = await demoPOST(new NextRequest('http://localhost/api/research/handwriting/demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'analyze', candidateStyle: 'DIFFERENT' })
        }));
        expect(expectedResultResponse.status).toBe(400);
    });
});
