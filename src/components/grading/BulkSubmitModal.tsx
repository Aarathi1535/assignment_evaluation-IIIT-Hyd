'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  Loader2,
  Send,
  Flag,
  AlertTriangle,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface BulkSubmitDetailItem {
  allocationId?: string;
  answerScriptId?: string;
  question?: number | null;
  missingQuestions?: number[];
  flagId?: string;
  flagReason?: string;
  error?: string;
}

export interface BulkSubmitResultData {
  examId: string;
  totalProcessed: number;
  submittedCount: number;
  alreadySubmittedCount: number;
  incompleteCount: number;
  openFlagCount: number;
  failedCount: number;
  submitted: BulkSubmitDetailItem[];
  alreadySubmitted: BulkSubmitDetailItem[];
  incompleteSkipped: BulkSubmitDetailItem[];
  openFlagSkipped: BulkSubmitDetailItem[];
  failed: BulkSubmitDetailItem[];
  preview?: boolean;
}

export interface BulkSubmitModalProps {
  isOpen: boolean;
  onClose: () => void;
  examId: string;
  examName?: string;
  onComplete?: (result: BulkSubmitResultData) => void;
}

export function BulkSubmitModal({
  isOpen,
  onClose,
  examId,
  examName,
  onComplete,
}: BulkSubmitModalProps) {
  const [step, setStep] = useState<'preview' | 'executing' | 'result'>('preview');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<BulkSubmitResultData | null>(null);
  const [resultData, setResultData] = useState<BulkSubmitResultData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!examId) return;
    setLoadingPreview(true);
    setError(null);
    setPreviewData(null);
    setStep('preview');

    try {
      const res = await fetch(`/api/exams/${encodeURIComponent(examId)}/submissions/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ preview: true }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.message || `Failed to generate bulk submission preview (${res.status})`);
      }

      setPreviewData(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch bulk preview.');
    } finally {
      setLoadingPreview(false);
    }
  }, [examId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isOpen) {
        fetchPreview();
      } else {
        setStep('preview');
        setPreviewData(null);
        setResultData(null);
        setError(null);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, fetchPreview]);

  const handleExecuteBulkSubmit = async () => {
    if (!examId) return;
    setStep('executing');
    setError(null);

    try {
      const res = await fetch(`/api/exams/${encodeURIComponent(examId)}/submissions/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ confirmed: true }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.message || `Failed to complete bulk submission (${res.status})`);
      }

      setResultData(json.data);
      setStep('result');
      onComplete?.(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bulk submission execution failed.');
      setStep('preview');
    }
  };

  if (!isOpen) {
    return null;
  }

  const activeData = step === 'result' ? resultData : previewData;

  return (
    <div
      data-testid="bulk-submit-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-submit-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
    >
      <div className="bg-white rounded-brand-lg shadow-xl border border-slate-200 max-w-xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h3 id="bulk-submit-modal-title" className="text-base font-bold text-slate-900">
                Bulk Submit Graded Scripts
              </h3>
              <p className="text-xs text-slate-500">
                {examName ? `Exam: ${examName}` : `Exam ID: ${examId}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Loading Preview */}
          {loadingPreview && (
            <div data-testid="bulk-preview-loading" className="py-12 flex flex-col items-center justify-center text-center space-y-2">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              <p className="text-xs font-semibold text-slate-600">
                Analyzing allocation completeness & open flags...
              </p>
            </div>
          )}

          {/* Executing Loading */}
          {step === 'executing' && (
            <div data-testid="bulk-executing-loading" className="py-12 flex flex-col items-center justify-center text-center space-y-2">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              <p className="text-xs font-semibold text-slate-800">
                Submitting and locking eligible scripts in a transaction...
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div
              data-testid="bulk-submit-error-alert"
              role="alert"
              className="bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-800 flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Preview & Results Display */}
          {!loadingPreview && step !== 'executing' && activeData && (
            <div className="space-y-4">
              {/* Top Summary Banner */}
              <div
                data-testid="bulk-summary-banner"
                className={`p-3.5 rounded border text-xs ${
                  step === 'result'
                    ? activeData.failedCount > 0
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <div className="font-bold text-sm mb-1">
                  {step === 'result' ? 'Bulk Submission Results' : 'Submission Preview'}
                </div>
                <p className="leading-relaxed">
                  {step === 'result'
                    ? `Processed ${activeData.totalProcessed} total script allocations for this exam.`
                    : `Evaluated ${activeData.totalProcessed} allocations. Review the categories below before confirming.`}
                </p>
              </div>

              {/* Breakdown Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {/* Ready to submit / Submitted */}
                <div
                  data-testid="stat-submitted-count"
                  className="bg-emerald-50 border border-emerald-200 rounded p-2.5 text-center"
                >
                  <span className="block text-2xl font-black text-emerald-700">
                    {activeData.submittedCount}
                  </span>
                  <span className="text-3xs font-bold uppercase tracking-wider text-emerald-800">
                    {step === 'result' ? 'Submitted' : 'Ready to Submit'}
                  </span>
                </div>

                {/* Incomplete */}
                <div
                  data-testid="stat-incomplete-count"
                  className="bg-amber-50 border border-amber-200 rounded p-2.5 text-center"
                >
                  <span className="block text-2xl font-black text-amber-700">
                    {activeData.incompleteCount}
                  </span>
                  <span className="text-3xs font-bold uppercase tracking-wider text-amber-800">
                    Incomplete
                  </span>
                </div>

                {/* Flagged */}
                <div
                  data-testid="stat-flagged-count"
                  className="bg-purple-50 border border-purple-200 rounded p-2.5 text-center"
                >
                  <span className="block text-2xl font-black text-purple-700">
                    {activeData.openFlagCount}
                  </span>
                  <span className="text-3xs font-bold uppercase tracking-wider text-purple-800">
                    Flagged (Skipped)
                  </span>
                </div>

                {/* Already Submitted */}
                <div
                  data-testid="stat-already-submitted-count"
                  className="bg-slate-50 border border-slate-200 rounded p-2.5 text-center"
                >
                  <span className="block text-2xl font-black text-slate-700">
                    {activeData.alreadySubmittedCount}
                  </span>
                  <span className="text-3xs font-bold uppercase tracking-wider text-slate-600">
                    Already Submitted
                  </span>
                </div>
              </div>

              {/* Partial Failures Warning (if any) */}
              {activeData.failedCount > 0 && (
                <div
                  data-testid="bulk-partial-failure-alert"
                  role="alert"
                  className="bg-rose-50 border border-rose-300 rounded p-3 text-xs text-rose-900 space-y-2"
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                    <span>Partial Failure: {activeData.failedCount} script(s) failed to submit</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-rose-800 pl-1">
                    {activeData.failed.map((f, idx) => (
                      <li key={idx}>
                        Script {f.answerScriptId || f.allocationId}: {f.error || 'Submission failed'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Incomplete items details */}
              {activeData.incompleteSkipped.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-100 pt-2">
                  <span className="text-xs font-bold text-slate-700 block">
                    Incomplete Allocations ({activeData.incompleteSkipped.length})
                  </span>
                  <div className="max-h-28 overflow-y-auto space-y-1 text-2xs text-slate-650 bg-slate-50 p-2 rounded border border-slate-200">
                    {activeData.incompleteSkipped.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <span>Script {item.answerScriptId?.slice(-6) || item.allocationId?.slice(-6)}</span>
                        {item.missingQuestions && item.missingQuestions.length > 0 && (
                          <span className="text-amber-800 font-semibold">
                            Missing Q: {item.missingQuestions.join(', ')}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Open Flag items details */}
              {activeData.openFlagSkipped.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-100 pt-2">
                  <span className="text-xs font-bold text-purple-900 flex items-center gap-1">
                    <Flag className="h-3.5 w-3.5 text-purple-600" />
                    <span>Open Flags Pending Review ({activeData.openFlagSkipped.length})</span>
                  </span>
                  <div className="max-h-24 overflow-y-auto space-y-1 text-2xs text-purple-800 bg-purple-50/50 p-2 rounded border border-purple-200">
                    {activeData.openFlagSkipped.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <span>Script {item.answerScriptId?.slice(-6) || item.allocationId?.slice(-6)}</span>
                        <span className="italic">{item.flagReason || 'Open Flag'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="cancel-bulk-submit-button"
            disabled={step === 'executing'}
            onClick={onClose}
          >
            {step === 'result' ? 'Close' : 'Cancel'}
          </Button>

          {step === 'preview' && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="confirm-bulk-submit-button"
              disabled={loadingPreview || !previewData || previewData.submittedCount === 0}
              onClick={handleExecuteBulkSubmit}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
            >
              <Send className="h-3.5 w-3.5" />
              <span>
                {previewData && previewData.submittedCount > 0
                  ? `Confirm & Submit ${previewData.submittedCount} Scripts`
                  : 'No Eligible Scripts'}
              </span>
            </Button>
          )}

          {step === 'result' && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="close-bulk-submit-button"
              onClick={onClose}
              className="bg-slate-900 hover:bg-slate-800 text-white font-semibold"
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default BulkSubmitModal;
