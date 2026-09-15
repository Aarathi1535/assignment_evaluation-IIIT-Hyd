'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { X, ArrowRightLeft, AlertCircle, CheckCircle2, User, FileText } from 'lucide-react';

export interface EligibleTa {
  _id?: string;
  id?: string;
  name: string;
  email?: string;
  isActive?: boolean;
}

export interface ReassignAllocationTarget {
  allocationId: string;
  scriptId: string;
  question: number | null;
  status: string;
}

export interface ReassignModalProps {
  isOpen: boolean;
  examId: string;
  allocation: ReassignAllocationTarget | null;
  currentTa: { id: string; name: string; email?: string } | null;
  availableTas: EligibleTa[];
  onClose: () => void;
  onSuccess: (message?: string) => void;
}

/**
 * Pure helper function to filter eligible replacement TAs.
 * Excludes the current TA and any inactive TAs.
 */
export function filterEligibleReplacementTas(
  allTas: EligibleTa[],
  currentTaId?: string | null
): EligibleTa[] {
  if (!allTas || !Array.isArray(allTas)) return [];
  return allTas.filter((ta) => {
    const taId = ta._id || ta.id;
    if (!taId) return false;
    if (currentTaId && taId === currentTaId) return false;
    if (ta.isActive === false) return false;
    return true;
  });
}

/**
 * Pure helper function to determine if an allocation can be reassigned.
 * Only PENDING allocations are reassignable.
 */
export function isAllocationReassignable(status?: string | null): boolean {
  return status === 'PENDING';
}

/**
 * Pure helper function to get formatted scope text.
 */
export function getReassignmentScopeText(question?: number | null): string {
  if (question !== undefined && question !== null) {
    return `Question ${question}`;
  }
  return 'Whole Script';
}

/**
 * Pure helper function to format reassignment success message.
 */
export function formatReassignSuccessMessage(scriptId?: string, targetTaName?: string): string {
  const safeScript = scriptId || 'Script';
  const safeTa = targetTaName || 'new TA';
  return `Successfully reassigned ${safeScript} to ${safeTa}.`;
}

export default function ReassignModal({
  isOpen,
  examId,
  allocation,
  currentTa,
  availableTas,
  onClose,
  onSuccess,
}: ReassignModalProps) {
  const [selectedTargetTaId, setSelectedTargetTaId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filter eligible replacement TAs
  const eligibleTas = filterEligibleReplacementTas(availableTas, currentTa?.id);

  // Reset state when opening or changing allocation
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedTargetTaId('');
      setErrorMsg(null);
      setSuccessMsg(null);
      setIsSubmitting(false);
    }
  }, [isOpen, allocation]);

  // Keyboard accessibility: Dismiss modal on Escape key press (WCAG 2.1.2)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !allocation || !currentTa) return null;

  const isReassignable = isAllocationReassignable(allocation.status);

  const handleConfirmReassign = async () => {
    if (!selectedTargetTaId) {
      setErrorMsg('Please select a replacement Teaching Assistant.');
      return;
    }

    if (!isReassignable) {
      setErrorMsg('Only pending allocations can be reassigned.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        allocationId: allocation.allocationId,
        targetTaId: selectedTargetTaId,
      };

      const res = await fetch(`/api/exams/${examId}/allocate/reassign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to reassign allocation.');
      }

      const targetTaObj = availableTas.find((t) => (t._id || t.id) === selectedTargetTaId);
      const msg = formatReassignSuccessMessage(allocation.scriptId, targetTaObj?.name);
      setSuccessMsg(json.message || msg);

      // Brief delay to allow user to see success state before closing
      setTimeout(() => {
        onSuccess(json.message || msg);
        onClose();
      }, 900);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred during reassignment.';
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans"
      data-testid="reassign-modal-backdrop"
    >
      <div
        className="bg-white rounded-brand-lg max-w-md w-full border border-slate-200 shadow-xl overflow-hidden p-6 relative animate-in fade-in zoom-in-95 duration-200 space-y-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reassign-modal-title"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-brand hover:bg-slate-50 cursor-pointer disabled:opacity-40"
          aria-label="Close dialog"
          data-testid="reassign-modal-close"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <div className="h-10 w-10 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary">
            <ArrowRightLeft className="h-5 w-5" />
          </div>
          <div>
            <h2 id="reassign-modal-title" className="text-base font-bold text-slate-900">
              Reassign Script Allocation
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Transfer this pending script to another eligible Teaching Assistant.
            </p>
          </div>
        </div>

        {/* Status / Error Banner */}
        {errorMsg && (
          <div
            role="alert"
            data-testid="reassign-error-alert"
            className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-brand p-3 text-rose-800 text-xs font-semibold"
          >
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success Banner */}
        {successMsg && (
          <div
            role="status"
            data-testid="reassign-success-alert"
            className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-brand p-3 text-emerald-800 text-xs font-semibold"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Allocation Details Card */}
        <div className="bg-slate-50 border border-slate-200 rounded-brand p-4 space-y-2.5 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-slate-500 font-bold uppercase text-4xs">Script Identifier:</span>
            <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1">
              <FileText className="h-3 w-3 text-slate-400" />
              {allocation.scriptId}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-500 font-bold uppercase text-4xs">Grading Scope:</span>
            <span className="font-bold text-slate-800">
              {getReassignmentScopeText(allocation.question)}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-500 font-bold uppercase text-4xs">Current Status:</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-4xs font-extrabold uppercase border ${
                allocation.status === 'PENDING'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              {allocation.status}
            </span>
          </div>

          <div className="flex justify-between items-center border-t border-slate-200 pt-2 mt-2">
            <span className="text-slate-500 font-bold uppercase text-4xs">Current TA:</span>
            <span className="font-bold text-slate-800 flex items-center gap-1">
              <User className="h-3 w-3 text-slate-400" />
              {currentTa.name} {currentTa.email ? `(${currentTa.email})` : ''}
            </span>
          </div>
        </div>

        {/* Target TA Selection */}
        <div className="space-y-1.5">
          <label
            htmlFor="target-ta-select"
            className="block text-xs font-bold text-slate-700 uppercase tracking-wider"
          >
            Select Replacement TA <span className="text-rose-500">*</span>
          </label>

          {eligibleTas.length === 0 ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-brand text-amber-800 text-xs font-semibold">
              No other eligible teaching assistants are available for this course.
            </div>
          ) : (
            <select
              id="target-ta-select"
              data-testid="target-ta-select"
              value={selectedTargetTaId}
              onChange={(e) => {
                setSelectedTargetTaId(e.target.value);
                setErrorMsg(null);
              }}
              disabled={isSubmitting || !isReassignable}
              className="w-full px-3 py-2 text-sm font-semibold rounded-brand border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary disabled:opacity-50"
            >
              <option value="">-- Choose an eligible TA --</option>
              {eligibleTas.map((ta) => {
                const id = ta._id || ta.id || '';
                return (
                  <option key={id} value={id}>
                    {ta.name} {ta.email ? `(${ta.email})` : ''}
                  </option>
                );
              })}
            </select>
          )}
          <p className="text-4xs text-slate-500 font-medium">
            The script will be immediately transferred to the selected TA&apos;s pending queue.
          </p>
        </div>

        {/* Modal Actions */}
        <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="reassign-cancel-btn"
          >
            Cancel
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleConfirmReassign}
            isLoading={isSubmitting}
            disabled={isSubmitting || !selectedTargetTaId || !isReassignable || eligibleTas.length === 0}
            data-testid="reassign-confirm-btn"
          >
            <ArrowRightLeft className="h-4 w-4 mr-1.5" />
            <span>Confirm Reassignment</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
