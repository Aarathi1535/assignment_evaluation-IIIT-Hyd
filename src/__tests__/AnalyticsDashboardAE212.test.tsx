/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExamAnalyticsDashboard from '../components/analytics/ExamAnalyticsDashboard';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data
    };
}

function analyticsResponse(count = 2) {
    return {
        success: true,
        data: {
            exam: { id: 'exam-1', title: 'Published Midterm', maxMarks: 100 },
            classStatistics: {
                count,
                mean: count ? 72 : null,
                median: count ? 75 : null,
                standardDeviation: count ? 12 : null,
                standardDeviationMethod: 'population'
            },
            scoreDistribution: Array.from({ length: 10 }, (_, index) => ({
                startPercentage: index * 10,
                endPercentage: (index + 1) * 10,
                label: `${index * 10}-${(index + 1) * 10}%`,
                count: index === 7 ? count : 0
            }))
        }
    };
}

function gradersResponse(graders: Array<Record<string, unknown>> = [{
    graderId: 'ta-1',
    graderName: 'Tess Adams',
    name: 'Tess Adams',
    comparisonCount: 2,
    meanAbsoluteDeviationPercentagePoints: 8,
    sampleSizeStatus: 'INSUFFICIENT'
}]) {
    return {
        success: true,
        data: {
            exam: { id: 'exam-1', title: 'Published Midterm' },
            metric: {
                name: 'Mean absolute deviation',
                unit: 'percentage_points',
                direction: 'lower_is_closer',
                minimumSampleSize: 5,
                comparisonBasis: 'Comparable questions',
                limitation: 'This is a grading-drift proxy and not formal inter-rater reliability.'
            },
            graders
        }
    };
}

describe('AE-212 analytics dashboard', () => {
    it('shows released cohort metrics and accessible performance and TA charts', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse(analyticsResponse()))
            .mockResolvedValueOnce(jsonResponse(gradersResponse()));
        vi.stubGlobal('fetch', fetchMock);

        render(<ExamAnalyticsDashboard examId="exam-1" />);

        expect(screen.getAllByRole('status')[0].textContent).toContain('Loading exam analytics');
        expect((await screen.findByRole('heading', { name: 'Published Midterm' })).textContent)
            .toBe('Published Midterm');
        expect(screen.getByText('72.00 / 100')).toBeTruthy();
        expect(screen.getByRole('img', { name: /Score distribution by percentage/ })).toBeTruthy();
        expect(screen.getByRole('img', { name: /Tess Adams: 8.0 percentage points/ })).toBeTruthy();
        expect(screen.getByText(/at least 5 comparable scores/)).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/analytics/exams/exam-1',
            expect.objectContaining({ cache: 'no-store' })
        );
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/analytics/exams/exam-1/graders',
            expect.objectContaining({ cache: 'no-store' })
        );
    });

    it('shows explicit empty states when the exam has no released or comparable grades', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse(analyticsResponse(0)))
            .mockResolvedValueOnce(jsonResponse(gradersResponse([]))));

        render(<ExamAnalyticsDashboard examId="exam-1" />);

        expect(await screen.findByText(/No published final grades are available/)).toBeTruthy();
        expect(screen.getByText(/not yet comparable released grading work/)).toBeTruthy();
        expect(screen.getAllByText('—').length).toBeGreaterThan(1);
    });

    it('announces request failures and allows retrying', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ success: false, message: 'Analytics unavailable' }, 500))
            .mockResolvedValueOnce(jsonResponse(gradersResponse()))
            .mockResolvedValueOnce(jsonResponse(analyticsResponse()))
            .mockResolvedValueOnce(jsonResponse(gradersResponse()));
        vi.stubGlobal('fetch', fetchMock);

        render(<ExamAnalyticsDashboard examId="exam-1" />);

        expect((await screen.findByRole('alert')).textContent).toContain('Analytics unavailable');
        fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
        expect(await screen.findByRole('img', { name: /Score distribution by percentage/ })).toBeTruthy();
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    });
});
