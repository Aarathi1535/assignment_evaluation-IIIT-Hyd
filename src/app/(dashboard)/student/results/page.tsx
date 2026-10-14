'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Award,
  Calendar,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  GraduationCap
} from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export interface StudentResultRecord {
  examId: string;
  examTitle: string;
  courseCode: string;
  examDate: string;
  status: 'RELEASED' | 'NOT_AVAILABLE';
  scriptId?: string;
  total?: number;
  maxMarks?: number;
}

export default function StudentResultsPage() {
  const [results, setResults] = useState<StudentResultRecord[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const fetchResults = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/student/results', {
        cache: 'no-store',
        signal: controller.signal
      });

      const body = await response.json();

      if (!response.ok || !body.success) {
        if (response.status === 404) {
          throw new Error('Student results are currently unavailable or disabled.');
        }
        throw new Error(body.message || `Failed to fetch results (${response.status})`);
      }

      if (!controller.signal.aborted) {
        setResults(Array.isArray(body.data) ? body.data : []);
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Could not load your exam results.');
        setResults(null);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        activeRequest.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => void fetchResults(), 0);
    return () => {
      window.clearTimeout(timerId);
      activeRequest.current?.abort();
    };
  }, [fetchResults]);

  const releasedCount = results?.filter(r => r.status === 'RELEASED').length ?? 0;
  const pendingCount = results?.filter(r => r.status === 'NOT_AVAILABLE').length ?? 0;

  const stats = [
    {
      title: 'Total Exams',
      value: results?.length.toString() ?? '—',
      icon: GraduationCap,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Released Results',
      value: results ? releasedCount.toString() : '—',
      icon: CheckCircle2,
      color: 'text-emerald-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Pending Release',
      value: results ? pendingCount.toString() : '—',
      icon: Clock,
      color: 'text-amber-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-amber-50 text-amber-600',
    },
  ];

  const quickActions = (
    <div className="flex items-center gap-2">
      <Link href="/student">
        <Button variant="outline" size="md">
          <ArrowLeft className="h-4 w-4" />
          <span>Dashboard</span>
        </Button>
      </Link>
      <Button
        variant="secondary"
        size="md"
        onClick={() => void fetchResults()}
        disabled={loading}
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        <span>Refresh</span>
      </Button>
    </div>
  );

  return (
    <DashboardLayout
      title="My Exam Results"
      description="View official grades and evaluation status for your enrolled courses."
      stats={stats}
      quickActions={quickActions}
    >
      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-brand border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-rose-600" />
          <div className="flex-1">
            <p className="font-semibold">Unable to load results</p>
            <p className="mt-0.5 text-rose-700">{error}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchResults()}
            className="border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Loading state */}
      {loading && !results && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="animate-pulse rounded-brand-lg border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="h-5 w-1/3 rounded bg-slate-200" />
              <div className="mt-3 h-4 w-1/4 rounded bg-slate-100" />
              <div className="mt-4 flex gap-4">
                <div className="h-8 w-24 rounded bg-slate-200" />
                <div className="h-8 w-24 rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && results && results.length === 0 && (
        <EmptyState
          title="No Exam Records Found"
          description="You do not have any published exams or evaluation records available at this time."
          icon={Award}
          action={
            <Link href="/student">
              <Button variant="primary" size="md">
                Return to Dashboard
              </Button>
            </Link>
          }
        />
      )}

      {/* Results List */}
      {!loading && results && results.length > 0 && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-brand-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-3.5">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
                Exams & Grading Records
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {results.map(item => {
                const isReleased = item.status === 'RELEASED';
                const formattedDate = item.examDate
                  ? new Date(item.examDate).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })
                  : '—';

                return (
                  <div
                    key={item.examId}
                    className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-slate-50/60"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {item.courseCode && (
                          <span className="inline-flex items-center rounded-brand-sm bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200/60">
                            {item.courseCode}
                          </span>
                        )}
                        <h3 className="text-base font-semibold text-slate-900">
                          {item.examTitle}
                        </h3>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {formattedDate}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 sm:justify-end">
                      {/* Score or Status Badge */}
                      {isReleased ? (
                        <div className="text-right">
                          <div className="flex items-baseline gap-1 sm:justify-end">
                            <span className="text-xl font-bold text-slate-900">
                              {item.total ?? 0}
                            </span>
                            <span className="text-xs text-slate-500">
                              / {item.maxMarks ?? 0} marks
                            </span>
                          </div>
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            Released
                          </span>
                        </div>
                      ) : (
                        <div className="text-right">
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 border border-amber-200/60">
                            <Clock className="h-3 w-3 text-amber-600" />
                            Result Not Yet Available
                          </span>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            Scores not yet available
                          </p>
                        </div>
                      )}

                      {/* Detail Link (Only for Released) */}
                      {isReleased && item.scriptId ? (
                        <Link href={`/student/results/${item.scriptId}`}>
                          <Button variant="outline" size="sm" className="gap-1 text-xs">
                            <span>View Breakdown</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled
                          className="text-xs text-slate-400 cursor-not-allowed"
                        >
                          Unavailable
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
