'use client';

import React, { useState } from 'react';
import { Download, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export type ExportFormat = 'csv' | 'xlsx' | 'lms' | 'canvas';

export interface ExamExportPanelProps {
    examId: string;
    examTitle?: string;
    releasedCount?: number;
    className?: string;
}

export interface FormatOption {
    id: ExportFormat;
    name: string;
    extension: string;
    description: string;
    badge?: string;
}

export const EXPORT_FORMATS: FormatOption[] = [
    {
        id: 'csv',
        name: 'CSV Spreadsheet',
        extension: '.csv',
        description: 'Standard comma-separated format with student identifiers, question breakdown, and total scores.',
        badge: 'Universal'
    },
    {
        id: 'xlsx',
        name: 'Excel Workbook',
        extension: '.xlsx',
        description: 'Native Microsoft Excel spreadsheet with structured column formatting and formula injection protection.',
        badge: 'Recommended'
    },
    {
        id: 'lms',
        name: 'Standard LMS Gradebook',
        extension: '.csv',
        description: 'Standard LMS-compatible format with mapped student IDs, grades, and reconciliation status.',
        badge: 'LMS Import'
    },
    {
        id: 'canvas',
        name: 'Canvas LMS Gradebook',
        extension: '.csv',
        description: 'Formatted for Canvas LMS Gradebook import with standard SIS columns and points possible header.',
        badge: 'Canvas'
    }
];

export default function ExamExportPanel({
    examId,
    examTitle,
    releasedCount,
    className = ''
}: ExamExportPanelProps) {
    const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('xlsx');
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ filename: string; format: ExportFormat; timestamp: string } | null>(null);

    const handleExport = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setExporting(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await fetch(`/api/analytics/exams/${encodeURIComponent(examId)}/export?format=${selectedFormat}`, {
                headers: {
                    'Accept': selectedFormat === 'xlsx'
                        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                        : 'text/csv'
                }
            });

            if (!response.ok) {
                let errorMsg = 'Failed to export exam grades.';
                try {
                    const body = await response.json();
                    if (body && typeof body.message === 'string') {
                        errorMsg = body.message;
                    }
                } catch {
                    // response is not JSON
                }
                throw new Error(errorMsg);
            }

            const disposition = response.headers.get('content-disposition');
            const match = disposition?.match(/filename="?([^";]+)"?/);
            const filename = match ? match[1] : `exam-${examId}-grades.${selectedFormat === 'xlsx' ? 'xlsx' : 'csv'}`;

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(url);

            setSuccess({
                filename,
                format: selectedFormat,
                timestamp: new Date().toLocaleTimeString()
            });
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An error occurred during export.');
        } finally {
            setExporting(false);
        }
    };

    return (
        <Card className={`p-6 ${className}`} data-testid="exam-export-panel">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-700">
                        <FileSpreadsheet className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <div>
                        <h2 id="export-section-title" className="text-lg font-bold text-slate-900">
                            Export Exam Grades
                        </h2>
                        <p className="text-xs text-slate-600">
                            {examTitle ? `Export finalized results for ${examTitle}` : 'Download finalized grades in your preferred format'}
                            {typeof releasedCount === 'number' && ` • ${releasedCount} released grade${releasedCount === 1 ? '' : 's'}`}
                        </p>
                    </div>
                </div>

                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={exporting}
                    onClick={() => handleExport()}
                    className="shrink-0 font-semibold gap-2"
                    data-testid="export-download-btn"
                >
                    {exporting ? (
                        <>
                            <LoadingSpinner size="sm" />
                            <span>Exporting…</span>
                        </>
                    ) : (
                        <>
                            <Download className="h-4 w-4" aria-hidden="true" />
                            <span>Download {selectedFormat.toUpperCase()}</span>
                        </>
                    )}
                </Button>
            </div>

            {/* Error Banner */}
            {error && (
                <div
                    role="alert"
                    className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
                    data-testid="export-error-alert"
                >
                    <div className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
                        <span className="font-medium">{error}</span>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleExport()}
                        className="text-xs h-7 px-2"
                    >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                        Retry
                    </Button>
                </div>
            )}

            {/* Success Banner */}
            {success && (
                <div
                    role="status"
                    aria-live="polite"
                    className="mt-4 flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 animate-in fade-in duration-200"
                    data-testid="export-success-alert"
                >
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                    <div>
                        <span className="font-semibold">Export downloaded:</span>{' '}
                        <span className="font-mono text-xs font-medium text-emerald-800">{success.filename}</span>
                        <span className="text-xs text-emerald-700 ml-1.5">({success.timestamp})</span>
                    </div>
                </div>
            )}

            {/* Format Selection Grid */}
            <form onSubmit={handleExport} className="mt-5">
                <fieldset>
                    <legend className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                        Select Export Format
                    </legend>
                    <div
                        role="radiogroup"
                        aria-labelledby="export-section-title"
                        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
                    >
                        {EXPORT_FORMATS.map((format) => {
                            const isSelected = selectedFormat === format.id;
                            return (
                                <label
                                    key={format.id}
                                    htmlFor={`format-${format.id}`}
                                    className={`relative flex flex-col justify-between rounded-xl border p-4 cursor-pointer transition-all ${
                                        isSelected
                                            ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-600/20 shadow-xs'
                                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                                    }`}
                                >
                                    <div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-bold text-sm text-slate-900">
                                                {format.name}
                                            </span>
                                            {format.badge && (
                                                <span
                                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-bold ${
                                                        isSelected
                                                            ? 'bg-indigo-100 text-indigo-800'
                                                            : 'bg-slate-100 text-slate-700'
                                                    }`}
                                                >
                                                    {format.badge}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-2 text-xs leading-relaxed text-slate-600">
                                            {format.description}
                                        </p>
                                    </div>

                                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                                        <span className="font-mono text-xs font-semibold text-slate-500">
                                            {format.extension}
                                        </span>
                                        <input
                                            type="radio"
                                            id={`format-${format.id}`}
                                            name="exportFormat"
                                            value={format.id}
                                            checked={isSelected}
                                            onChange={() => setSelectedFormat(format.id)}
                                            className="h-4 w-4 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                                            data-testid={`radio-format-${format.id}`}
                                        />
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>
            </form>
        </Card>
    );
}

