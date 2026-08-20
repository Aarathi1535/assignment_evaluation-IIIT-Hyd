'use client';

import React, { useState, useCallback } from 'react';
import { CheckCircle2, Clock, ShieldCheck, ShieldAlert, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';

export type IngestionApprovalStatus = 'PENDING_REVIEW' | 'APPROVED';

export interface IngestionApprovalPanelProps {
  examId: string;
  /** Current approval state fetched from server */
  approvalStatus: IngestionApprovalStatus;
  /** Metadata — only present when APPROVED */
  approvedBy?: string | null;
  approvedAt?: string | null;
  /** Called after a successful approve/revoke so the parent can refresh its data */
  onStatusChange?: (newStatus: IngestionApprovalStatus) => void;
}

/**
 * IngestionApprovalPanel — AE-074
 *
 * Shows whether ingestion is PENDING_REVIEW or APPROVED.
 * Provides Approve / Revoke actions that hit the real backend API.
 * Does NOT duplicate backend logic: it reads server state and calls
 * authenticated endpoints for mutations.
 */
export function IngestionApprovalPanel({
  examId,
  approvalStatus: initialStatus,
  approvedBy: initialApprovedBy,
  approvedAt: initialApprovedAt,
  onStatusChange
}: IngestionApprovalPanelProps) {
  const [status, setStatus] = useState<IngestionApprovalStatus>(initialStatus);
  const [approvedBy, setApprovedBy] = useState<string | null | undefined>(initialApprovedBy);
  const [approvedAt, setApprovedAt] = useState<string | null | undefined>(initialApprovedAt);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const callApi = useCallback(
    async (endpoint: 'approve-ingestion' | 'revoke-ingestion') => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch(`/api/exams/${examId}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setErrorMsg(data.message || 'An error occurred. Please try again.');
          return;
        }
        // Refresh canonical state from server
        const examRes = await fetch(`/api/exams/${examId}`);
        const examData = await examRes.json();
        if (examData.success && examData.data) {
          const newStatus: IngestionApprovalStatus =
            examData.data.ingestionApprovalStatus ?? 'PENDING_REVIEW';
          setStatus(newStatus);
          setApprovedBy(examData.data.approvedBy ?? null);
          setApprovedAt(examData.data.approvedAt ?? null);
          onStatusChange?.(newStatus);
        }
      } catch {
        setErrorMsg('Network error. Please check your connection and try again.');
      } finally {
        setLoading(false);
      }
    },
    [examId, onStatusChange]
  );

  const isApproved = status === 'APPROVED';

  return (
    <Card
      className="border-2"
      style={{
        borderColor: isApproved ? 'rgb(34 197 94 / 0.3)' : 'rgb(251 191 36 / 0.35)'
      }}
    >
      <CardHeader>
        <div className="flex items-center gap-2">
          {isApproved ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" aria-hidden="true" />
          ) : (
            <Clock className="h-5 w-5 text-amber-500 shrink-0" aria-hidden="true" />
          )}
          <CardTitle className="text-base">Ingestion Approval</CardTitle>
          {/* Status badge */}
          <span
            id={`ingestion-approval-badge-${examId}`}
            className={`ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${
              isApproved
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}
          >
            {isApproved ? 'Approved' : 'Pending Review'}
          </span>
        </div>
        <CardDescription>
          {isApproved
            ? 'Ingestion has been reviewed and approved. The exam is cleared for grading and allocation.'
            : 'Ingestion review is pending. Approve ingestion before starting grading or allocation.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Approval metadata */}
        {isApproved && approvedAt && (
          <p className="text-xs text-slate-500 mb-4">
            Approved{approvedBy ? ` by reviewer` : ''} on{' '}
            <span className="font-medium text-slate-700">
              {new Date(approvedAt).toLocaleString()}
            </span>
          </p>
        )}

        {!isApproved && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-brand px-3 py-2 mb-4">
            <strong>Note:</strong> Grading and allocation cannot begin until ingestion is approved.
            Approve ingestion once you have reviewed the answer script assembly.
          </p>
        )}

        {/* Error message */}
        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-brand px-3 py-2 mb-4"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {!isApproved && (
            <Button
              id={`approve-ingestion-btn-${examId}`}
              variant="primary"
              size="sm"
              isLoading={loading}
              disabled={loading}
              onClick={() => callApi('approve-ingestion')}
              aria-label="Approve ingestion for this exam"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Approve Ingestion
            </Button>
          )}
          {isApproved && (
            <Button
              id={`revoke-ingestion-btn-${examId}`}
              variant="outline"
              size="sm"
              isLoading={loading}
              disabled={loading}
              onClick={() => callApi('revoke-ingestion')}
              aria-label="Revoke ingestion approval for this exam"
            >
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              Revoke Approval
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
