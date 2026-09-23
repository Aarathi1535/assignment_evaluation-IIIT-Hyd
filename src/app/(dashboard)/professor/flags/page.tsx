'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Flag,
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  BookOpen,
  ArrowRight,
  RotateCcw,
  Layers,
  FileText,
  Filter,
} from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export type FlagStatusTab = 'OPEN' | 'RESOLVED' | 'ESCALATED';

export interface PopulatedQueueItem {
  _id: string;
  answerScript: {
    _id: string;
    scriptReference?: string;
    anonymousId?: string;
    candidateStudentId?: string | null;
    pageCount?: number;
    student?: {
      _id: string;
      name?: string;
      email?: string;
      rollNumber?: string;
    } | null;
  };
  exam: {
    _id: string;
    title: string;
    totalMarks?: number;
  };
  question?: number | null;
  raisedBy: {
    _id: string;
    name: string;
    email: string;
  };
  reason: 'CHEATING_SUSPECTED' | 'ILLEGIBLE' | 'OTHER' | string;
  note?: string;
  status: 'OPEN' | 'RESOLVED' | 'ESCALATED';
  resolution?: {
    action?: string;
    by?: {
      _id?: string;
      name?: string;
      email?: string;
    } | string | null;
    at?: string | Date | null;
    notes?: string;
    previousScore?: number;
    newScore?: number;
  } | null;
  createdAt: string;
  updatedAt: string;
  currentMarks?: {
    totalScore?: number;
    marksAwarded?: Array<{ criterionName: string; score: number; feedback?: string }>;
    feedback?: string;
    isFinal?: boolean;
    gradedBy?: string;
  } | null;
  effectiveGrade?: {
    totalScore: number;
    isOverridden: boolean;
    originalScore?: number;
    override?: {
      action?: string;
      by?: {
        _id?: string;
        name?: string;
        email?: string;
      } | string | null;
      at?: string | Date | null;
      notes?: string;
      previousScore?: number;
      newScore?: number;
      criterionOverrides?: Array<{
        criterionName: string;
        score: number;
        feedback?: string;
      }>;
    } | null;
    marksAwarded?: Array<{ criterionName: string; score: number; feedback?: string }>;
  } | null;
}

export interface QueueResponseData {
  flags: PopulatedQueueItem[];
  counts: {
    open: number;
    resolved: number;
    escalated: number;
    total: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export default function ProfessorFlagQueuePage() {
  const [activeTab, setActiveTab] = useState<FlagStatusTab>('OPEN');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [queueData, setQueueData] = useState<QueueResponseData | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [exams, setExams] = useState<Array<{ _id: string; title: string }>>([]);

  const loadExams = useCallback(async () => {
    try {
      const res = await fetch('/api/exams');
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setExams(json.data);
        }
      }
    } catch {
      // Non-blocking exam list fetch
    }
  }, []);

  const loadFlags = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('status', activeTab);
      if (selectedExamId) {
        params.set('examId', selectedExamId);
      }

      const res = await fetch(`/api/professor/flags?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Authentication required. Please log in again.');
        }
        if (res.status === 403) {
          throw new Error('Forbidden: Access to professor flag review queue is restricted to professors and admins.');
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || `Failed to load review queue (${res.status})`);
      }

      const json = await res.json();
      setQueueData(json.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedExamId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadExams();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadExams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadFlags();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadFlags]);

  const getReasonLabel = (reason: string) => {
    switch (reason) {
      case 'CHEATING_SUSPECTED':
        return 'Cheating Suspected';
      case 'ILLEGIBLE':
        return 'Illegible Handwriting / Scan';
      case 'OTHER':
        return 'Other Concern';
      default:
        return reason;
    }
  };

  const getStatusBadge = (status: 'OPEN' | 'RESOLVED' | 'ESCALATED') => {
    switch (status) {
      case 'OPEN':
        return (
          <span
            data-testid="flag-status-open"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-300"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            <span>OPEN</span>
          </span>
        );
      case 'RESOLVED':
        return (
          <span
            data-testid="flag-status-resolved"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-300"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>RESOLVED</span>
          </span>
        );
      case 'ESCALATED':
        return (
          <span
            data-testid="flag-status-escalated"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-50 text-rose-800 border border-rose-300"
          >
            <Flag className="h-3.5 w-3.5 text-rose-600" />
            <span>ESCALATED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };

  const flags = queueData?.flags || [];
  const openCount = queueData?.counts?.open ?? 0;
  const resolvedCount = queueData?.counts?.resolved ?? 0;
  const escalatedCount = queueData?.counts?.escalated ?? 0;

  return (
    <DashboardLayout
      title="Flag Review Queue"
      description="Review and investigate answer scripts and questions flagged by Teaching Assistants."
    >
      <div className="space-y-6">
        {/* Status Filters & Controls Bar */}
        <div className="bg-white border border-slate-200 rounded-brand-lg p-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          {/* Status Tabs */}
          <div
            role="tablist"
            aria-label="Flag Status Filters"
            className="flex items-center gap-1 bg-slate-100 p-1 rounded-brand"
          >
            <button
              role="tab"
              aria-selected={activeTab === 'OPEN'}
              data-testid="tab-open"
              onClick={() => setActiveTab('OPEN')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-brand text-xs font-bold transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-primary/20 ${
                activeTab === 'OPEN'
                  ? 'bg-white text-brand-primary shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <span>OPEN</span>
              <span
                data-testid="open-count-badge"
                className={`px-1.5 py-0.5 rounded-full text-3xs font-mono font-extrabold ${
                  activeTab === 'OPEN'
                    ? 'bg-brand-primary/10 text-brand-primary'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {openCount}
              </span>
            </button>

            <button
              role="tab"
              aria-selected={activeTab === 'RESOLVED'}
              data-testid="tab-resolved"
              onClick={() => setActiveTab('RESOLVED')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-brand text-xs font-bold transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-primary/20 ${
                activeTab === 'RESOLVED'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <span>RESOLVED</span>
              <span
                data-testid="resolved-count-badge"
                className={`px-1.5 py-0.5 rounded-full text-3xs font-mono font-extrabold ${
                  activeTab === 'RESOLVED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {resolvedCount}
              </span>
            </button>

            <button
              role="tab"
              aria-selected={activeTab === 'ESCALATED'}
              data-testid="tab-escalated"
              onClick={() => setActiveTab('ESCALATED')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-brand text-xs font-bold transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-primary/20 ${
                activeTab === 'ESCALATED'
                  ? 'bg-white text-rose-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <span>ESCALATED</span>
              <span
                data-testid="escalated-count-badge"
                className={`px-1.5 py-0.5 rounded-full text-3xs font-mono font-extrabold ${
                  activeTab === 'ESCALATED'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {escalatedCount}
              </span>
            </button>
          </div>

          {/* Exam Filter Dropdown */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400 shrink-0" />
            <select
              aria-label="Filter by Exam"
              data-testid="exam-filter-select"
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
            >
              <option value="">All My Exams</option>
              {exams.map((exam) => (
                <option key={exam._id} value={exam._id}>
                  {exam.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div
            data-testid="flags-loading-state"
            className="bg-white border border-slate-200 rounded-brand-lg p-16 text-center shadow-sm flex flex-col items-center justify-center space-y-3"
          >
            <LoadingSpinner size="lg" />
            <p className="text-sm font-semibold text-slate-600">Loading flagged submissions...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div
            data-testid="flags-error-state"
            className="bg-white border border-rose-200 rounded-brand-lg p-10 text-center shadow-sm flex flex-col items-center justify-center space-y-4 max-w-xl mx-auto my-8"
          >
            <div className="h-12 w-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">Unable to Load Review Queue</h3>
              <p className="text-sm text-slate-600">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={loadFlags}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              <span>Retry</span>
            </Button>
          </div>
        )}

        {/* Empty State: Must say exactly "No flags to review" (Requirement 5) */}
        {!loading && !error && flags.length === 0 && (
          <div
            data-testid="flags-empty-state"
            className="bg-white border border-slate-200 rounded-brand-lg p-16 text-center shadow-sm flex flex-col items-center justify-center space-y-4"
          >
            <div className="h-12 w-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">No flags to review</h3>
              <p className="text-xs text-slate-500 max-w-md">
                {activeTab === 'OPEN'
                  ? 'All flagged answer scripts have been reviewed or no TAs have raised flags for your exams.'
                  : `No ${activeTab.toLowerCase()} flags found for your exams.`}
              </p>
            </div>
          </div>
        )}

        {/* Flags Queue List */}
        {!loading && !error && flags.length > 0 && (
          <div
            role="list"
            aria-label="Flagged Answer Scripts List"
            data-testid="flags-list"
            className="space-y-3"
          >
            {flags.map((flag) => {
              const scriptId = flag.answerScript?._id || '';
              const reviewUrl = `/grading/${scriptId}?flagId=${flag._id}${
                flag.question ? `&question=${flag.question}` : ''
              }&reviewMode=true`;

              const studentInfo = flag.answerScript?.student;
              const studentDisplay = studentInfo
                ? `${studentInfo.name || 'Student'} (${studentInfo.rollNumber || studentInfo.email || 'ID'})`
                : flag.answerScript?.candidateStudentId || flag.answerScript?.anonymousId || 'Submission';

              return (
                <div
                  key={flag._id}
                  role="listitem"
                  tabIndex={0}
                  data-testid={`flag-queue-item-${flag._id}`}
                  className="bg-white border border-slate-200 rounded-brand-lg p-4 sm:p-5 shadow-xs hover:border-brand-primary/40 hover:shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
                >
                  {/* Left context column */}
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Text Status Badge */}
                      {getStatusBadge(flag.status)}

                      {/* Reason Tag */}
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                        <Flag className="h-3 w-3 text-rose-500" />
                        <span>{getReasonLabel(flag.reason)}</span>
                      </span>

                      {/* Question / Script Scope */}
                      {flag.question ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                          <span>Question {flag.question}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          <span>Whole Script</span>
                        </span>
                      )}

                      {/* Current TA Marks (if available) */}
                      {flag.currentMarks && typeof flag.currentMarks.totalScore === 'number' && (
                        <span
                          data-testid={`current-marks-${flag._id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200"
                        >
                          <span>TA Original: {flag.currentMarks.totalScore} pts</span>
                        </span>
                      )}

                      {/* Professor Override Badge (if overridden) */}
                      {flag.effectiveGrade?.isOverridden && typeof flag.effectiveGrade.totalScore === 'number' && (
                        <span
                          data-testid={`override-marks-${flag._id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-50 text-amber-900 border border-amber-300"
                        >
                          <span>Professor Override: {flag.effectiveGrade.totalScore} pts</span>
                        </span>
                      )}
                    </div>

                    {/* Professor Override Details (AE-163 / AE-164) */}
                    {flag.effectiveGrade?.isOverridden && flag.effectiveGrade.override && (
                      <div
                        data-testid={`override-details-${flag._id}`}
                        className="bg-amber-50/80 rounded p-2.5 text-xs text-amber-950 border border-amber-200/80 font-sans space-y-1"
                      >
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="font-bold text-amber-900">
                            Professor Override: {flag.effectiveGrade.totalScore} pts
                            {flag.effectiveGrade.originalScore !== undefined && (
                              <span className="text-amber-700 font-normal ml-1">
                                (TA Original: {flag.effectiveGrade.originalScore} pts)
                              </span>
                            )}
                          </span>
                          {flag.effectiveGrade.override.by && (
                            <span className="flex items-center gap-1 text-slate-700">
                              <User className="h-3 w-3 text-amber-700" />
                              <span>
                                Changed by:{' '}
                                <strong>
                                  {typeof flag.effectiveGrade.override.by === 'object'
                                    ? flag.effectiveGrade.override.by.name || flag.effectiveGrade.override.by.email || 'Professor'
                                    : flag.effectiveGrade.override.by}
                                </strong>
                              </span>
                            </span>
                          )}
                          {flag.effectiveGrade.override.at && (
                            <span className="flex items-center gap-1 text-slate-600">
                              <Clock className="h-3 w-3 text-amber-700" />
                              <span>
                                Changed at: {new Date(flag.effectiveGrade.override.at).toLocaleString()}
                              </span>
                            </span>
                          )}
                        </div>
                        {flag.effectiveGrade.override.notes && (
                          <div className="text-xs text-slate-600">
                            <span className="font-semibold text-slate-700">Resolution Note:</span>{' '}
                            <span className="italic">{flag.effectiveGrade.override.notes}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Exam and Student details */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span className="font-bold text-slate-900 flex items-center gap-1">
                        <BookOpen className="h-3.5 w-3.5 text-slate-400" />
                        <span>{flag.exam.title}</span>
                      </span>

                      <span className="flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5 text-slate-400" />
                        <span>Student: <strong>{studentDisplay}</strong></span>
                      </span>

                      {flag.answerScript?.pageCount && (
                        <span className="flex items-center gap-1 text-slate-500">
                          <Layers className="h-3.5 w-3.5 text-slate-400" />
                          <span>{flag.answerScript.pageCount} pages</span>
                        </span>
                      )}
                    </div>

                    {/* Flag Note / Rationale */}
                    {flag.note && (
                      <div className="bg-slate-50 rounded p-2.5 text-xs text-slate-700 border border-slate-200/70 font-sans">
                        <span className="font-bold text-slate-800 mr-1">TA Note:</span>
                        <span className="italic">{flag.note}</span>
                      </div>
                    )}

                    {/* Meta info: Flagged by & date */}
                    <div className="flex items-center gap-3 text-2xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span>Raised by TA: <strong>{flag.raisedBy.name}</strong> ({flag.raisedBy.email})</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(flag.createdAt).toLocaleString()}</span>
                      </span>
                    </div>
                  </div>

                  {/* Right Action button */}
                  <div className="shrink-0 flex items-center">
                    <Link href={reviewUrl} tabIndex={-1}>
                      <Button
                        variant="primary"
                        size="sm"
                        data-testid={`review-flag-btn-${flag._id}`}
                        className="w-full sm:w-auto gap-1.5 text-xs font-bold"
                      >
                        <span>Review Script</span>
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
