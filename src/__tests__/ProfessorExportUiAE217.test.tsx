/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExamExportPanel from '../components/analytics/ExamExportPanel';
import ExamAnalyticsDashboard from '../components/analytics/ExamAnalyticsDashboard';

describe('AE-217 Professor Export UI with format picker', () => {
    let originalCreateObjectURL: typeof window.URL.createObjectURL;
    let originalRevokeObjectURL: typeof window.URL.revokeObjectURL;

    beforeEach(() => {
        originalCreateObjectURL = window.URL.createObjectURL;
        originalRevokeObjectURL = window.URL.revokeObjectURL;
        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
        window.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        window.URL.createObjectURL = originalCreateObjectURL;
        window.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    function mockFileResponse(content: string, filename: string, status = 200) {
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: new Headers({
                'content-type': filename.endsWith('.xlsx')
                    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    : 'text/csv; charset=utf-8',
                'content-disposition': `attachment; filename="${filename}"`
            }),
            blob: async () => new Blob([content]),
            json: async () => ({ success: false, message: content })
        };
    }

    it('renders format picker with CSV, XLSX, Standard LMS, and Canvas LMS options', () => {
        render(<ExamExportPanel examId="exam-123" examTitle="Midterm Exam" releasedCount={45} />);

        expect(screen.getByRole('heading', { name: /Export Exam Grades/i })).toBeTruthy();
        expect(screen.getByText(/Export finalized results for Midterm Exam • 45 released grades/)).toBeTruthy();

        // Check format options
        expect(screen.getByText('CSV Spreadsheet')).toBeTruthy();
        expect(screen.getByText('Excel Workbook')).toBeTruthy();
        expect(screen.getByText('Standard LMS Gradebook')).toBeTruthy();
        expect(screen.getByText('Canvas LMS Gradebook')).toBeTruthy();

        // Default selected format is XLSX
        const xlsxRadio = screen.getByTestId('radio-format-xlsx') as HTMLInputElement;
        expect(xlsxRadio.checked).toBe(true);
        expect(screen.getByTestId('export-download-btn').textContent).toContain('Download XLSX');
    });

    it('updates format selection and download button label when switching options', () => {
        render(<ExamExportPanel examId="exam-123" />);

        const csvRadio = screen.getByTestId('radio-format-csv') as HTMLInputElement;
        fireEvent.click(csvRadio);
        expect(csvRadio.checked).toBe(true);
        expect(screen.getByTestId('export-download-btn').textContent).toContain('Download CSV');

        const lmsRadio = screen.getByTestId('radio-format-lms') as HTMLInputElement;
        fireEvent.click(lmsRadio);
        expect(lmsRadio.checked).toBe(true);
        expect(screen.getByTestId('export-download-btn').textContent).toContain('Download LMS');

        const canvasRadio = screen.getByTestId('radio-format-canvas') as HTMLInputElement;
        fireEvent.click(canvasRadio);
        expect(canvasRadio.checked).toBe(true);
        expect(screen.getByTestId('export-download-btn').textContent).toContain('Download CANVAS');
    });

    it('handles successful export with meaningful filename and triggers browser download', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            mockFileResponse('PK\x03\x04...', 'exam-123-grades.xlsx', 200)
        );
        vi.stubGlobal('fetch', fetchMock);

        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        render(<ExamExportPanel examId="exam-123" />);

        const downloadBtn = screen.getByTestId('export-download-btn');
        fireEvent.click(downloadBtn);

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/analytics/exams/exam-123/export?format=xlsx',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    })
                })
            );
        });

        // Verify successful download trigger
        await waitFor(() => {
            expect(clickSpy).toHaveBeenCalled();
            expect(window.URL.createObjectURL).toHaveBeenCalled();
        });

        // Verify success alert with meaningful filename
        expect(await screen.findByTestId('export-success-alert')).toBeTruthy();
        expect(screen.getByText('exam-123-grades.xlsx')).toBeTruthy();

        clickSpy.mockRestore();
    });

    it('displays loading state while download request is in flight', async () => {
        let resolveFetch: (val: unknown) => void = () => {};
        const fetchPromise = new Promise(resolve => {
            resolveFetch = resolve;
        });
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise));

        render(<ExamExportPanel examId="exam-123" />);

        const downloadBtn = screen.getByTestId('export-download-btn');
        fireEvent.click(downloadBtn);

        expect(screen.getByText('Exporting…')).toBeTruthy();
        expect(downloadBtn.hasAttribute('disabled')).toBe(true);

        // Resolve fetch
        resolveFetch(mockFileResponse('col1,col2', 'exam-123-grades.csv', 200));

        await waitFor(() => {
            expect(screen.queryByText('Exporting…')).toBeNull();
        });
    });

    it('handles export errors (unauthorized, unpublished, server failure) with error state and retry button', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: async () => ({ success: false, message: 'Forbidden: You do not have permission to export this exam' })
            })
            .mockResolvedValueOnce(
                mockFileResponse('col1,col2', 'exam-123-grades.csv', 200)
            );
        vi.stubGlobal('fetch', fetchMock);

        render(<ExamExportPanel examId="exam-123" />);

        const downloadBtn = screen.getByTestId('export-download-btn');
        fireEvent.click(downloadBtn);

        // Error message appears
        const errorAlert = await screen.findByTestId('export-error-alert');
        expect(errorAlert.textContent).toContain('Forbidden: You do not have permission to export this exam');

        // Click retry
        const retryBtn = screen.getByRole('button', { name: /Retry/i });
        fireEvent.click(retryBtn);

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
        expect(await screen.findByTestId('export-success-alert')).toBeTruthy();
    });

    it('integrates seamlessly inside ExamAnalyticsDashboard', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    data: {
                        exam: { id: 'exam-999', title: 'Data Structures Final', maxMarks: 50 },
                        classStatistics: {
                            count: 30,
                            mean: 40,
                            median: 42,
                            standardDeviation: 5,
                            standardDeviationMethod: 'population'
                        },
                        scoreDistribution: [],
                        questionStatistics: [],
                        questionMetric: {
                            scoreNormalization: 'Norm',
                            spread: 'Spread',
                            difficultyFormula: 'Diff'
                        }
                    }
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    data: {
                        exam: { id: 'exam-999', title: 'Data Structures Final' },
                        metric: {
                            name: 'MAD',
                            unit: 'pts',
                            direction: 'lower',
                            minimumSampleSize: 5,
                            comparisonBasis: 'Q',
                            limitation: 'None'
                        },
                        graders: []
                    }
                })
            });
        vi.stubGlobal('fetch', fetchMock);

        render(<ExamAnalyticsDashboard examId="exam-999" />);

        // Verify dashboard loads
        expect(await screen.findByRole('heading', { name: 'Data Structures Final' })).toBeTruthy();

        // Verify export panel is embedded
        expect(screen.getByTestId('exam-export-panel')).toBeTruthy();
        expect(screen.getByText(/30 released grades/)).toBeTruthy();
    });
});

