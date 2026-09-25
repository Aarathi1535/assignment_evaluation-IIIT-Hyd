'use client';

import React, { useState } from 'react';
import {
  CheckCircle,
  RotateCcw,
  AlertCircle,
  Loader2,
  Lock,
  Send,
  FileCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { SaveStatus } from '@/components/canvas/types';

export interface GradingSubmissionControlsProps {
  scriptId: string;
  allocationId?: string;
  allocatedQuestionNumber?: number;
  isSubmitted?: boolean;
  canSubmit?: boolean;
  canReopen?: boolean;
  saveStatus?: SaveStatus;
  onSubmitted?: (result: unknown) => void;
  onReopened?: (result: unknown) => void;
  className?: string;
}

export function GradingSubmissionControls({
  scriptId,
  allocationId,
  allocatedQuestionNumber,
  isSubmitted = false,
  canSubmit = true,
  canReopen = true,
  saveStatus = 'idle',
  onSubmitted,
  onReopened,
  className = '',
}: GradingSubmissionControlsProps) {
  // Submission modal & state
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [incompleteQuestions, setIncompleteQuestions] = useState<number[]>([]);

  // Reopen modal & state
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [isReopening, setIsReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  // Success alert message
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Helper to parse incomplete questions from error messages like "Question(s) 1, 2 must be graded"
  const parseIncompleteQuestions = (message: string): number[] => {
    const match = message.match(/Question\(s\)\s+([0-9,\s]+)\s+must be graded/i);
    if (match && match[1]) {
      return match[1]
        .split(',')
        .map((q) => parseInt(q.trim(), 10))
        .filter((n) => !isNaN(n));
    }
    return [];
  };

  const handleOpenSubmitModal = () => {
    setSubmitError(null);
    setIncompleteQuestions([]);
    setActionSuccess(null);
    setIsSubmitModalOpen(true);
  };

  const handleConfirmSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    setIncompleteQuestions([]);

    try {
      const payload: { question?: number } = {};
      if (allocatedQuestionNumber !== undefined && allocatedQuestionNumber !== null) {
        payload.question = Number(allocatedQuestionNumber);
      }

      const res = await fetch(`/api/scripts/${encodeURIComponent(scriptId)}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorMsg = json?.message || `Failed to submit script (${res.status})`;
        const missing = parseIncompleteQuestions(errorMsg);
        if (missing.length > 0) {
          setIncompleteQuestions(missing);
        }
        throw new Error(errorMsg);
      }

      setIsSubmitModalOpen(false);
      setActionSuccess('Script submitted and locked successfully.');
      onSubmitted?.(json.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred during submission.';
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenReopenModal = () => {
    setReopenReason('');
    setReopenError(null);
    setActionSuccess(null);
    setIsReopenModalOpen(true);
  };

  const handleConfirmReopen = async () => {
    const trimmedReason = reopenReason.trim();
    if (!trimmedReason) {
      setReopenError('Reopen reason is required.');
      return;
    }

    setIsReopening(true);
    setReopenError(null);

    const targetId = allocationId || scriptId;

    try {
      const res = await fetch(`/api/allocations/${encodeURIComponent(targetId)}/reopen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ reason: trimmedReason }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.message || `Failed to reopen allocation (${res.status})`);
      }

      setIsReopenModalOpen(false);
      setActionSuccess('Allocation reopened successfully. Grading unlocked.');
      onReopened?.(json.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred while reopening.';
      setReopenError(msg);
    } finally {
      setIsReopening(false);
    }
  };

  // Determine state label
  const gradingState = isSubmitted
    ? 'Submitted'
    : saveStatus === 'saved'
    ? 'Saved'
    : saveStatus === 'pending_sync'
    ? 'Pending Sync'
    : saveStatus === 'conflict'
    ? 'Conflict'
    : 'Draft';

  return (
    <div
      data-testid="grading-submission-controls"
      className={`flex flex-wrap items-center gap-2.5 ${className}`}
    >
      {/* Grading State Indicator Badge */}
      <div
        data-testid="grading-state-indicator"
        data-state={gradingState.toLowerCase().replace(/\s+/g, '_')}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors shadow-xs ${
          isSubmitted
            ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
            : saveStatus === 'saved'
            ? 'bg-blue-50 text-blue-800 border-blue-200'
            : saveStatus === 'pending_sync'
            ? 'bg-sky-50 text-sky-800 border-sky-300'
            : saveStatus === 'conflict'
            ? 'bg-amber-100 text-amber-900 border-amber-400'
            : 'bg-slate-100 text-slate-700 border-slate-300'
        }`}
      >
        {isSubmitted ? (
          <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
        ) : (
          <FileCheck className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
        )}
        <span>Status: {gradingState}</span>
      </div>

      {/* Submit Script Action Button */}
      {!isSubmitted && canSubmit && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          data-testid="submit-script-button"
          onClick={handleOpenSubmitModal}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
        >
          <Send className="h-3.5 w-3.5" />
          <span>Submit Script</span>
        </Button>
      )}

      {/* Submitted Locked Badge / Reopen Action Button */}
      {isSubmitted && (
        <div className="flex items-center gap-2">
          <span
            data-testid="locked-script-badge"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200"
          >
            <Lock className="h-3 w-3 text-slate-500" />
            <span>Grading Locked</span>
          </span>

          {canReopen && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="reopen-allocation-button"
              onClick={handleOpenReopenModal}
              className="gap-1.5 border-amber-300 text-amber-900 bg-amber-50/80 hover:bg-amber-100 font-semibold"
            >
              <RotateCcw className="h-3.5 w-3.5 text-amber-700" />
              <span>Reopen</span>
            </Button>
          )}
        </div>
      )}

      {/* Success Notification */}
      {actionSuccess && (
        <div
          role="status"
          data-testid="submission-success-banner"
          className="text-xs font-medium text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 flex items-center gap-1.5"
        >
          <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Submit Confirmation Modal */}
      {isSubmitModalOpen && (
        <div
          data-testid="submit-confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        >
          <div className="bg-white rounded-brand-lg shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <h3 id="submit-modal-title" className="text-base font-bold text-slate-900">
                  Submit & Lock Answer Script
                </h3>
                <p className="text-xs text-slate-500">
                  Finalize all awarded grades and complete grading.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-650 leading-relaxed">
              Are you sure you want to finalize and submit this script? Once submitted, the script will
              be locked and marked completed.
            </p>

            {/* Incomplete Questions Alert */}
            {incompleteQuestions.length > 0 && (
              <div
                data-testid="incomplete-questions-alert"
                role="alert"
                className="bg-amber-50 border border-amber-300 rounded p-3 space-y-2"
              >
                <div className="flex items-center gap-1.5 text-amber-900 font-bold text-xs">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>Incomplete Questions Detected</span>
                </div>
                <p className="text-xs text-amber-800">
                  The following questions must be evaluated and saved before submission:
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {incompleteQuestions.map((qNum) => (
                    <span
                      key={qNum}
                      data-testid={`missing-question-badge-${qNum}`}
                      className="px-2 py-0.5 rounded-full text-2xs font-extrabold bg-amber-200 text-amber-900 border border-amber-400"
                    >
                      Question {qNum}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* General Submission Error Alert */}
            {submitError && incompleteQuestions.length === 0 && (
              <div
                data-testid="submission-error-alert"
                role="alert"
                className="bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-800 flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{submitError}</span>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="cancel-submit-button"
                disabled={isSubmitting}
                onClick={() => setIsSubmitModalOpen(false)}
              >
                Cancel
              </Button>

              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="confirm-submit-button"
                disabled={isSubmitting}
                onClick={handleConfirmSubmit}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span>Confirm & Submit</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen Modal */}
      {isReopenModalOpen && (
        <div
          data-testid="reopen-confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reopen-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        >
          <div className="bg-white rounded-brand-lg shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div>
                <h3 id="reopen-modal-title" className="text-base font-bold text-slate-900">
                  Reopen Grading Allocation
                </h3>
                <p className="text-xs text-slate-500">
                  Unlock this script to allow evaluation updates.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-650 leading-relaxed">
              Reopening will reset the finalization lock and return the allocation to IN_PROGRESS. A
              non-empty explanation reason is required for audit tracking.
            </p>

            <div className="space-y-1.5">
              <label
                htmlFor="reopen-reason-input"
                className="block text-xs font-bold text-slate-700"
              >
                Reopen Reason <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="reopen-reason-input"
                data-testid="reopen-reason-input"
                rows={3}
                value={reopenReason}
                onChange={(e) => {
                  setReopenReason(e.target.value);
                  if (reopenError) setReopenError(null);
                }}
                placeholder="State the reason for reopening (e.g. Student re-evaluation request, grading error correction)..."
                className="w-full p-2.5 text-xs rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all resize-y"
              />
            </div>

            {reopenError && (
              <div
                data-testid="reopen-error-alert"
                role="alert"
                className="bg-rose-50 border border-rose-200 rounded p-2.5 text-xs text-rose-800 flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{reopenError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="cancel-reopen-button"
                disabled={isReopening}
                onClick={() => setIsReopenModalOpen(false)}
              >
                Cancel
              </Button>

              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="confirm-reopen-button"
                disabled={isReopening}
                onClick={handleConfirmReopen}
                className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1.5"
              >
                {isReopening ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Reopening...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Confirm Reopen</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GradingSubmissionControls;
