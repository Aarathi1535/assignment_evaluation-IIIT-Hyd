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
  Radio
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

export default function TaLiveProgressView({ examId }: TaLiveProgressViewProps) {
  const [progressData, setProgressData] = useState<ExamProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveUnavailableMsg, setLiveUnavailableMsg] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

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
          // If only taProgress is present, update the specific TA in the list
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
      // EventSource automatically attempts reconnection in background
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

      {/* Overall Exam Summary Card */}
      <Card className="border border-slate-200 bg-white p-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-brand-primary" />
              <h3 className="text-base font-bold text-slate-900">Total Exam Evaluation Progress</h3>
            </div>
            <span className="text-sm font-bold text-slate-700">
              {totalGraded} / {totalAssigned} Graded ({overallPercentage}%)
            </span>
          </div>

          {/* Visual Progress Bar for Overall Exam */}
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div
              role="progressbar"
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
                  className="border border-slate-200 hover:shadow-xs transition-shadow duration-200 p-4 bg-white"
                >
                  <div className="space-y-3">
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
