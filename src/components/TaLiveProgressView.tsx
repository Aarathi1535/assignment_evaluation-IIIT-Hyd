'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { 
  Users, 
  ArrowLeft, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle, 
  Radio,
  Clock,
  ChevronRight,
  FileText
} from 'lucide-react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { EmptyState } from './ui/EmptyState';

export interface TaProgress {
  taId: string;
  name: string;
  graded: number;
  total: number;
  completionRatio?: number;
}

export interface ExamProgressData {
  examId: string;
  total: number;
  graded: number;
  progress: TaProgress[];
  eta?: Date | string | null;
  etaAvailable?: boolean;
  etaReason?: string;
  estimatedRemainingSeconds?: number | null;
}

export interface TaAllocatedScriptItem {
  allocationId: string;
  scriptId: string;
  answerScriptId: string | null;
  question: number | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  claimedAt: Date | string | null;
  completedAt: Date | string | null;
  durationSeconds: number | null;
}

export interface TaWorkloadData {
  examId: string;
  examTitle: string;
  ta: {
    id: string;
    name: string;
    email: string;
  };
  total: number;
  graded: number;
  inProgress: number;
  pending: number;
  scripts: TaAllocatedScriptItem[];
}

export interface TaLiveProgressViewProps {
  examId: string;
}

/**
 * Pure helper function to format the per-TA label according to AE-106 specification:
 * "TA name — graded / total" (e.g. "TA A — 45/60")
 */
export function formatTaProgressLabel(name: string, graded: number, total: number): string {
  return `${name} — ${graded}/${total}`;
}

/**
 * Pure helper function to calculate the completion percentage (0-100).
 */
export function calculateProgressPercentage(graded: number, total: number, completionRatio?: number): number {
  if (typeof completionRatio === 'number' && !isNaN(completionRatio)) {
    return Math.min(100, Math.max(0, Math.round(completionRatio * 100)));
  }
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((graded / total) * 100)));
}

/**
 * Pure helper function to format overall exam grading summary metrics (AE-107).
 */
export function formatOverallGradingSummary(graded: number, total: number) {
  const safeTotal = Math.max(0, total);
  const safeGraded = Math.max(0, Math.min(safeTotal, graded));
  const remaining = Math.max(0, safeTotal - safeGraded);
  const percentage = safeTotal > 0 ? Math.round((safeGraded / safeTotal) * 100) : 0;
  return {
    graded: safeGraded,
    total: safeTotal,
    remaining,
    percentage
  };
}

/**
 * Pure helper function to format naive ETA display based on completedAt timestamps (AE-107).
 */
export function formatEtaDisplay(
  eta?: Date | string | null,
  etaAvailable?: boolean,
  etaReason?: string,
  estimatedRemainingSeconds?: number | null
): string {
  if (etaReason === 'COMPLETED') {
    return 'Grading Complete (100%)';
  }
  if (etaAvailable && eta) {
    const dateObj = typeof eta === 'string' ? new Date(eta) : eta;
    const dateStr = dateObj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (typeof estimatedRemainingSeconds === 'number' && estimatedRemainingSeconds >= 0) {
      if (estimatedRemainingSeconds < 60) {
        return `~${estimatedRemainingSeconds}s remaining (${dateStr})`;
      }
      const mins = Math.round(estimatedRemainingSeconds / 60);
      if (mins < 60) {
        return `~${mins}m remaining (${dateStr})`;
      }
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `~${hours}h ${remMins}m remaining (${dateStr})`;
    }
    return `Est. ${dateStr}`;
  }
  if (etaReason === 'NO_ALLOCATIONS') {
    return 'ETA unavailable (no allocations)';
  }
  return 'ETA pending more completed grading data';
}

/**
 * Pure helper function to calculate time per script (completedAt - claimedAt) in seconds (AE-108).
 * Only produces a duration if status is COMPLETED and both timestamps are valid.
 */
export function calculateTimePerScript(
  claimedAt?: Date | string | null,
  completedAt?: Date | string | null,
  status?: string
): number | null {
  if (status && status !== 'COMPLETED') {
    return null;
  }
  if (!claimedAt || !completedAt) {
    return null;
  }
  const claimedMs = new Date(claimedAt).getTime();
  const completedMs = new Date(completedAt).getTime();
  if (isNaN(claimedMs) || isNaN(completedMs)) {
    return null;
  }
  const diffMs = completedMs - claimedMs;
  if (diffMs < 0) {
    return null;
  }
  return Math.round(diffMs / 1000);
}

/**
 * Pure helper function to format a duration in seconds into a friendly string (e.g. "4m 12s", "45s", "1h 15m") (AE-108).
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
    return '—';
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const remSecs = seconds % 60;
  if (mins < 60) {
    return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export default function TaLiveProgressView({ examId }: TaLiveProgressViewProps) {
  const [progressData, setProgressData] = useState<ExamProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveUnavailableMsg, setLiveUnavailableMsg] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // TA Drill-Down State (AE-108)
  const [selectedTaId, setSelectedTaId] = useState<string | null>(null);
  const [taWorkload, setTaWorkload] = useState<TaWorkloadData | null>(null);
  const [loadingWorkload, setLoadingWorkload] = useState(false);
  const [workloadError, setWorkloadError] = useState<string | null>(null);

  // Fetch baseline progress from REST API: GET /api/exams/[id]/progress
  const fetchProgress = useCallback(async (isManual = false) => {
    try {
      if (isManual) {
        setManualRefreshing(true);
      }
      setErrorMsg(null);

      const res = await fetch(`/api/exams/${examId}/progress`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to fetch grading progress');
      }

      setProgressData(json.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred while fetching progress.';
      setErrorMsg(message);
    } finally {
      setLoading(false);
      if (isManual) {
        setManualRefreshing(false);
      }
    }
  }, [examId]);

  // Fetch specific TA workload drilldown data: GET /api/exams/[id]/ta/[taId] (AE-108)
  const fetchTaWorkload = useCallback(async (taId: string) => {
    try {
      setLoadingWorkload(true);
      setWorkloadError(null);

      const res = await fetch(`/api/exams/${examId}/ta/${taId}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to fetch TA workload details');
      }

      setTaWorkload(json.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred while fetching TA workload.';
      setWorkloadError(message);
    } finally {
      setLoadingWorkload(false);
    }
  }, [examId]);

  // Handle drilldown selection
  const handleSelectTa = (taId: string) => {
    setSelectedTaId(taId);
    fetchTaWorkload(taId);
  };

  // Handle returning to main exam dashboard
  const handleBackToOverview = () => {
    setSelectedTaId(null);
    setTaWorkload(null);
    setWorkloadError(null);
  };

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProgress();
  }, [fetchProgress]);

  // Connect to SSE stream: GET /api/exams/[id]/progress/stream
  useEffect(() => {
    if (!examId) return;

    // Initialize EventSource
    const streamUrl = `/api/exams/${examId}/progress/stream`;
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsLiveConnected(true);
      setErrorMsg(null);
    };

    // 1. Initial snapshot event
    es.addEventListener('initial', (event: MessageEvent) => {
      try {
        const initialData = JSON.parse(event.data);
        if (initialData && typeof initialData === 'object') {
          setProgressData(initialData);
        }
      } catch (err) {
        console.error('Failed to parse initial SSE event payload:', err);
      }
    });

    // 2. Live progress update event
    es.addEventListener('progress', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.examProgress) {
          setProgressData(payload.examProgress);
        } else if (payload?.taProgress) {
          setProgressData((prev) => {
            if (!prev) return prev;
            const updatedList = prev.progress.map((ta) =>
              ta.taId === payload.taProgress.taId ? { ...ta, ...payload.taProgress } : ta
            );
            const totalGraded = updatedList.reduce((acc, curr) => acc + curr.graded, 0);
            return {
              ...prev,
              graded: totalGraded,
              progress: updatedList
            };
          });
        }
      } catch (err) {
        console.error('Failed to parse progress SSE event payload:', err);
      }
    });

    // 3. Degraded mode notification
    es.addEventListener('live_updates_unavailable', (event: MessageEvent) => {
      setIsLiveConnected(false);
      try {
        const payload = JSON.parse(event.data);
        setLiveUnavailableMsg(payload.message || 'Live updates unavailable — refresh to see progress.');
      } catch {
        setLiveUnavailableMsg('Live updates unavailable — refresh to see progress.');
      }
    });

    es.onerror = () => {
      setIsLiveConnected(false);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [examId]);

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center font-sans">
        <div className="text-center space-y-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-semibold text-slate-500">Loading live grading progress...</p>
        </div>
      </div>
    );
  }

  const totalAssigned = progressData?.total || 0;
  const totalGraded = progressData?.graded || 0;
  const overallPercentage = calculateProgressPercentage(totalGraded, totalAssigned);
  const taList = progressData?.progress || [];

  // ==========================================
  // VIEW: TA DRILL-DOWN WORKLOAD DETAIL VIEW
  // ==========================================
  if (selectedTaId) {
    const selectedTaFromList = taList.find((t) => t.taId === selectedTaId);
    const taName = taWorkload?.ta.name || selectedTaFromList?.name || 'Teaching Assistant';

    return (
      <div className="space-y-6 font-sans">
        {/* Header with Return to Exam Dashboard navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackToOverview}
              data-testid="back-to-overview-button"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              <span>Back to Exam Progress</span>
            </Button>
            <div>
              <h2 className="text-xl font-bold text-slate-900" data-testid="ta-detail-title">
                {taName} — Workload Details
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Detailed script allocations and timing breakdown for this exam
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchTaWorkload(selectedTaId)}
            isLoading={loadingWorkload}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingWorkload ? 'animate-spin' : ''}`} />
            <span>Refresh Workload</span>
          </Button>
        </div>

        {/* Error State */}
        {workloadError && (
          <div
            role="alert"
            className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-brand p-4 text-rose-900 text-sm font-semibold"
          >
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            <span>{workloadError}</span>
          </div>
        )}

        {/* Loading Spinner for Drilldown */}
        {loadingWorkload ? (
          <div className="min-h-[300px] flex items-center justify-center">
            <div className="text-center space-y-3">
              <LoadingSpinner size="lg" />
              <p className="text-sm font-semibold text-slate-500">Loading assigned scripts...</p>
            </div>
          </div>
        ) : taWorkload ? (
          <div className="space-y-5">
            {/* TA Workload Stats Summary Card */}
            <Card className="border border-slate-200 bg-white p-5 shadow-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-50 border border-slate-200 rounded-brand p-3 space-y-0.5">
                  <p className="text-2xs font-bold text-slate-500 uppercase">Assigned</p>
                  <p className="text-xl font-extrabold text-slate-900">{taWorkload.total}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-brand p-3 space-y-0.5">
                  <p className="text-2xs font-bold text-emerald-700 uppercase">Graded</p>
                  <p className="text-xl font-extrabold text-emerald-800">{taWorkload.graded}</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-brand p-3 space-y-0.5">
                  <p className="text-2xs font-bold text-blue-700 uppercase">In Progress</p>
                  <p className="text-xl font-extrabold text-blue-800">{taWorkload.inProgress}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-brand p-3 space-y-0.5">
                  <p className="text-2xs font-bold text-amber-700 uppercase">Pending</p>
                  <p className="text-xl font-extrabold text-amber-800">{taWorkload.pending}</p>
                </div>
              </div>
            </Card>

            {/* Assigned Scripts Table */}
            <Card className="border border-slate-200 bg-white overflow-hidden shadow-xs">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="h-4.5 w-4.5 text-slate-500" />
                  <span>Assigned Answer Scripts ({taWorkload.scripts.length})</span>
                </h3>
              </div>

              {taWorkload.scripts.length === 0 ? (
                <div className="p-8">
                  <EmptyState
                    title="No scripts assigned"
                    description="No answer scripts have been assigned to this TA for this exam."
                    icon={FileText}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm" data-testid="ta-scripts-table">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
                      <tr>
                        <th className="px-5 py-3">Script Identifier</th>
                        <th className="px-5 py-3">Scope</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Claimed At</th>
                        <th className="px-5 py-3">Completed At</th>
                        <th className="px-5 py-3">Time Per Script</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {taWorkload.scripts.map((item, idx) => {
                        const statusBadge =
                          item.status === 'COMPLETED'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : item.status === 'IN_PROGRESS'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200';

                        const durationStr = formatDuration(item.durationSeconds);
                        const durationDisplay =
                          item.status === 'COMPLETED'
                            ? durationStr
                            : item.status === 'IN_PROGRESS'
                            ? 'In Progress'
                            : 'Not Claimed';

                        return (
                          <tr key={item.allocationId} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-5 py-3.5 font-bold text-slate-900">
                              <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded-sm border border-slate-200">
                                {item.scriptId}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600">
                              {item.question !== null ? `Question ${item.question}` : 'Whole Script'}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${statusBadge}`}>
                                {item.status}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-xs text-slate-500">
                              {item.claimedAt
                                ? new Date(item.claimedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
                                : '—'}
                            </td>
                            <td className="px-5 py-3.5 text-xs text-slate-500">
                              {item.completedAt
                                ? new Date(item.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
                                : '—'}
                            </td>
                            <td className="px-5 py-3.5 font-bold" data-testid={`time-per-script-${idx}`}>
                              <span className={item.durationSeconds !== null ? 'text-slate-900 font-mono' : 'text-slate-400'}>
                                {durationDisplay}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        ) : null}
      </div>
    );
  }

  // ==========================================
  // VIEW: MAIN EXAM LIVE PROGRESS OVERVIEW
  // ==========================================
  return (
    <div className="space-y-6 font-sans">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/professor/exams">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              <span>Back to Exams</span>
            </Button>
          </Link>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Per-TA Live Grading Progress</h2>
            <p className="text-xs text-slate-500 font-medium">
              Real-time progress overview for each assigned Teaching Assistant
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live Indicator Status */}
          {liveUnavailableMsg ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <span>Degraded Mode</span>
            </div>
          ) : isLiveConnected ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>Live Updates Active</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
              <Radio className="h-3.5 w-3.5 text-slate-400" />
              <span>Connecting Stream...</span>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchProgress(true)}
            isLoading={manualRefreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${manualRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Live Updates Unavailable Banner */}
      {liveUnavailableMsg && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-brand p-4 text-amber-900 text-sm font-semibold"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <span>{liveUnavailableMsg}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="bg-white hover:bg-amber-100 border-amber-300 text-amber-900 shrink-0"
            onClick={() => fetchProgress(true)}
            isLoading={manualRefreshing}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            <span>Refresh Now</span>
          </Button>
        </div>
      )}

      {/* Error Alert */}
      {errorMsg && (
        <div
          role="alert"
          className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-brand p-4 text-rose-900 text-sm font-semibold"
        >
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Overall Exam Grading Summary Card (AE-107) */}
      <Card className="border border-slate-200 bg-white p-5 space-y-5 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-brand-primary" />
            <h3 className="text-base font-bold text-slate-900">Overall Exam Grading Summary</h3>
          </div>
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Aggregate Progress
          </span>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Total Graded */}
          <div className="bg-slate-50 border border-slate-200 rounded-brand p-3.5 space-y-1">
            <p className="text-xs font-semibold text-slate-500">Total Graded</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-slate-900" data-testid="total-graded-count">
                {totalGraded}
              </span>
              <span className="text-xs font-bold text-slate-500">/ {totalAssigned} allocations</span>
            </div>
            <p className="text-2xs text-slate-500 font-medium">
              {Math.max(0, totalAssigned - totalGraded)} scripts remaining
            </p>
          </div>

          {/* Overall Percentage */}
          <div className="bg-slate-50 border border-slate-200 rounded-brand p-3.5 space-y-1">
            <p className="text-xs font-semibold text-slate-500">Grading Completion</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-brand-primary" data-testid="overall-grading-percentage">
                {overallPercentage}%
              </span>
            </div>
            <p className="text-2xs text-slate-500 font-medium">
              Aggregate across all TAs
            </p>
          </div>

          {/* Naive ETA */}
          <div className="bg-slate-50 border border-slate-200 rounded-brand p-3.5 space-y-1">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500">Estimated Completion (ETA)</p>
            </div>
            <p
              className={`text-sm font-bold truncate ${
                progressData?.etaReason === 'COMPLETED'
                  ? 'text-emerald-700'
                  : progressData?.etaAvailable
                  ? 'text-slate-900'
                  : 'text-slate-500'
              }`}
              data-testid="naive-eta-display"
            >
              {formatEtaDisplay(
                progressData?.eta,
                progressData?.etaAvailable,
                progressData?.etaReason,
                progressData?.estimatedRemainingSeconds
              )}
            </p>
            <p className="text-2xs text-slate-500 font-medium">
              {progressData?.etaAvailable
                ? 'Based on reliable completion timestamps'
                : 'Requires historical completion timestamps'}
            </p>
          </div>
        </div>

        {/* Aggregate Visual Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Overall Progress Bar</span>
            <span>{overallPercentage}% Complete</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div
              role="progressbar"
              aria-label="Overall exam grading progress"
              aria-valuenow={overallPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
              className="bg-brand-primary h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${overallPercentage}%` }}
            />
          </div>
        </div>
      </Card>

      {/* Per-TA Live Progress List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-600" />
            <span>Teaching Assistants ({taList.length})</span>
          </h3>
        </div>

        {taList.length === 0 ? (
          <EmptyState
            title="No allocations found"
            description="No teaching assistants have been allocated scripts for this exam yet."
            icon={Users}
            action={
              <Link href={`/professor/exams/${examId}/allocate`}>
                <Button variant="primary" size="sm">
                  <span>Allocate Scripts</span>
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {taList.map((ta) => {
              const taPercentage = calculateProgressPercentage(ta.graded, ta.total, ta.completionRatio);
              const progressLabel = formatTaProgressLabel(ta.name, ta.graded, ta.total);
              const isFinished = ta.total > 0 && ta.graded === ta.total;

              return (
                <Card
                  key={ta.taId}
                  className="border border-slate-200 hover:shadow-xs transition-shadow duration-200 p-4 bg-white space-y-3 cursor-pointer"
                  onClick={() => handleSelectTa(ta.taId)}
                  data-testid={`ta-card-${ta.taId}`}
                >
                  {/* TA Name and Graded / Total Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-base font-bold text-slate-900" data-testid={`ta-progress-label-${ta.taId}`}>
                        {progressLabel}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isFinished && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
                          Done
                        </span>
                      )}
                      <span className="text-sm font-bold text-slate-700">
                        {taPercentage}%
                      </span>
                    </div>
                  </div>

                  {/* Per-TA Visual Progress Bar */}
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      role="progressbar"
                      aria-label={`${ta.name} progress`}
                      aria-valuenow={taPercentage}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className={`h-full rounded-full transition-all duration-500 ease-out ${
                        isFinished ? 'bg-emerald-600' : 'bg-brand-primary'
                      }`}
                      style={{ width: `${taPercentage}%` }}
                    />
                  </div>

                  {/* Drill-down Click Trigger */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-brand-primary">
                    <span>Inspect Workload & Scripts</span>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
