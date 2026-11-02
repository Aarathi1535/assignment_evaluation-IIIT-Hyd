'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, ClipboardList, Clock, Eye } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

type RegradeRequestStatus = 'open' | 'reviewing' | 'resolved';

interface StudentRegradeRequest {
  id: string;
  examId: string;
  examTitle: string;
  questionNumber: number;
  reason: string;
  status: RegradeRequestStatus;
  createdAt: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStudentRegradeRequest(value: unknown): value is StudentRegradeRequest {
  if (!isRecord(value)) {
    return false;
  }
  const isStatus = value.status === 'open' || value.status === 'reviewing' || value.status === 'resolved';
  return typeof value.id === 'string'
    && typeof value.examId === 'string'
    && typeof value.examTitle === 'string'
    && typeof value.questionNumber === 'number'
    && Number.isInteger(value.questionNumber)
    && value.questionNumber > 0
    && typeof value.reason === 'string'
    && isStatus
    && typeof value.createdAt === 'string'
    && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt));
}

async function fetchStudentRegradeRequests(signal: AbortSignal): Promise<StudentRegradeRequest[]> {
  const response = await fetch('/api/student/regrade-requests', { cache: 'no-store', signal });
  const payload: unknown = await response.json();
  if (!response.ok || !isRecord(payload) || payload.success !== true) {
    const message = isRecord(payload) && typeof payload.message === 'string'
      ? payload.message
      : `Could not load regrade requests (${response.status}).`;
    throw new Error(message);
  }
  if (!Array.isArray(payload.data) || !payload.data.every(isStudentRegradeRequest)) {
    throw new Error('The regrade request response was invalid.');
  }
  return payload.data.filter(isStudentRegradeRequest);
}

const statusPresentation: Record<RegradeRequestStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  reviewing: { label: 'Reviewing', className: 'border-blue-200 bg-blue-50 text-blue-800' },
  resolved: { label: 'Resolved', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export default function StudentRegradeRequestsPage() {
  const [requests, setRequests] = useState<StudentRegradeRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const loadRequests = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(null);

    try {
      const requestData = await fetchStudentRegradeRequests(controller.signal);
      if (!controller.signal.aborted) {
        setRequests(requestData);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'Could not load your regrade requests.');
        setRequests(null);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        activeRequest.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => void loadRequests(), 0);
    return () => {
      window.clearTimeout(timerId);
      activeRequest.current?.abort();
    };
  }, [loadRequests]);

  const quickActions = (
    <div className="flex items-center gap-2">
      <Link href="/student">
        <Button variant="outline" size="md">
          <ArrowLeft className="h-4 w-4" />
          <span>Dashboard</span>
        </Button>
      </Link>
      <Link href="/student/results">
        <Button variant="primary" size="md">
          <Eye className="h-4 w-4" />
          <span>View Grades</span>
        </Button>
      </Link>
    </div>
  );

  return (
    <DashboardLayout
      title="My Regrade Requests"
      description="Track the review status of regrade requests you have submitted."
      quickActions={quickActions}
    >
      {error && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-brand border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold">Unable to load regrade requests</p>
            <p className="mt-0.5 text-rose-700">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadRequests()}>
            Retry
          </Button>
        </div>
      )}

      {loading && !requests && (
        <p role="status" className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Loading your regrade requests…
        </p>
      )}

      {!loading && !error && requests?.length === 0 && (
        <EmptyState
          title="No regrade requests yet"
          description="Requests you submit from a released exam result will appear here."
          icon={ClipboardList}
          action={
            <Link href="/student/results">
              <Button variant="primary" size="md">
                <Eye className="h-4 w-4" />
                <span>View Grades</span>
              </Button>
            </Link>
          }
        />
      )}

      {!loading && !error && requests && requests.length > 0 && (
        <ul aria-label="Submitted regrade requests" className="space-y-3">
          {requests.map(request => {
            const status = statusPresentation[request.status];
            return (
              <li key={request.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-slate-900">{request.examTitle}</h2>
                    <p className="mt-1 text-sm text-slate-600">Question {request.questionNumber}</p>
                  </div>
                  <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}>
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {status.label}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{request.reason}</p>
                <p className="mt-3 text-xs text-slate-500">Submitted {formatDate(request.createdAt)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardLayout>
  );
}
