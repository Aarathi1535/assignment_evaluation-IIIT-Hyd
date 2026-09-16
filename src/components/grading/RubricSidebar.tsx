'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  AlertCircle,
  AlertTriangle,
  Loader2,
  RotateCcw,
  CheckCircle2,
  Lock,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface RubricCriterion {
  criterionName: string;
  description?: string;
  points: number;
}

export interface RubricQuestion {
  questionNumber: number;
  maxMarks: number;
  criteria: RubricCriterion[];
}

export interface RubricData {
  _id: string;
  exam: string;
  questions: RubricQuestion[];
  isLocked?: boolean;
  version?: number;
}

export interface RubricSidebarProps {
  examId?: string;
  initialRubric?: RubricData | null;
  allocatedQuestionNumber?: number;
  onRubricLoaded?: (rubric: RubricData | null) => void;
  className?: string;
}

export function RubricSidebar({
  examId,
  initialRubric,
  allocatedQuestionNumber,
  onRubricLoaded,
  className = '',
}: RubricSidebarProps) {
  const [rubric, setRubric] = useState<RubricData | null>(initialRubric ?? null);
  const [loading, setLoading] = useState<boolean>(!initialRubric && Boolean(examId));
  const [error, setError] = useState<string | null>(null);

  const isQuestionWise = allocatedQuestionNumber !== undefined && allocatedQuestionNumber !== null;

  const fetchRubric = useCallback(async () => {
    if (initialRubric) {
      setRubric(initialRubric);
      setLoading(false);
      onRubricLoaded?.(initialRubric);
      return;
    }

    if (!examId) {
      setLoading(false);
      setRubric(null);
      onRubricLoaded?.(null);
      return;
    }


    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/rubrics?exam=${encodeURIComponent(examId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Authentication required to view rubric.');
        }
        if (res.status === 403) {
          throw new Error('Access denied. You do not have permission to view this rubric.');
        }
        if (res.status === 404) {
          setRubric(null);
          onRubricLoaded?.(null);
          setLoading(false);
          return;
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || `Failed to fetch rubric (${res.status})`);
      }

      const json = await res.json();
      if (json.success && json.data) {
        setRubric(json.data);
        onRubricLoaded?.(json.data);
      } else {
        setRubric(null);
        onRubricLoaded?.(null);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setRubric(null);
      onRubricLoaded?.(null);
    } finally {
      setLoading(false);
    }
  }, [examId, onRubricLoaded]);

  useEffect(() => {
    fetchRubric();
  }, [fetchRubric]);

  // Calculations
  const questions = rubric?.questions || [];
  const totalRubricMarks = questions.reduce((acc, q) => acc + (Number(q.maxMarks) || 0), 0);

  return (
    <div
      data-testid="rubric-sidebar"
      className={`bg-white border border-slate-200 rounded-brand-lg shadow-sm flex flex-col h-full overflow-hidden ${className}`}
    >
      {/* Sidebar Header */}
      <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center font-bold">
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 leading-tight">Rubric & Guidelines</h3>
            <p className="text-xs text-slate-500">Official grading criteria</p>
          </div>
        </div>

        {rubric && questions.length > 0 && (
          <div className="text-right">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
              {questions.length} {questions.length === 1 ? 'Q' : 'Qs'} • {totalRubricMarks} M
            </span>
          </div>
        )}
      </div>

      {/* Sidebar Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[800px]">
        {/* Loading State */}
        {loading && (
          <div
            data-testid="rubric-loading-state"
            className="py-12 flex flex-col items-center justify-center text-center space-y-2.5"
          >
            <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
            <p className="text-xs font-semibold text-slate-600">Loading rubric guidelines...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div
            data-testid="rubric-error-state"
            className="bg-rose-50 border border-rose-200 rounded-brand p-4 text-center space-y-3"
          >
            <div className="h-9 w-9 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-rose-900">Failed to Load Rubric</h4>
              <p className="text-xs text-rose-700 leading-relaxed">{error}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchRubric}
              className="text-xs border-rose-300 text-rose-800 hover:bg-rose-100/50"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              <span>Retry</span>
            </Button>
          </div>
        )}

        {/* Empty / No Rubric State */}
        {!loading && !error && (!rubric || questions.length === 0) && (
          <div
            data-testid="rubric-empty-state"
            className="bg-amber-50 border border-amber-200 rounded-brand p-4 text-center space-y-3 my-2"
          >
            <div className="h-10 w-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-1.5 text-left">
              <h4 className="text-xs font-bold text-amber-900 text-center">No Rubric Configured</h4>
              <p className="text-xs text-amber-800 leading-relaxed">
                This exam does not have an active grading rubric configured.
              </p>
              <div
                data-testid="rubric-no-rubric-warning"
                className="bg-amber-100/70 border border-amber-300 rounded p-2.5 text-2xs text-amber-900 font-semibold leading-relaxed"
              >
                ⚠️ <strong>Grading cannot proceed without a rubric.</strong> Please contact the course instructor to create a rubric before evaluating submissions.
              </div>
            </div>
          </div>
        )}

        {/* Rubric Questions Content */}
        {!loading && !error && rubric && questions.length > 0 && (
          <div data-testid="rubric-questions-list" className="space-y-4">
            {/* Allocation mode banner */}
            {isQuestionWise ? (
              <div className="bg-purple-50 border border-purple-200 rounded-brand p-2.5 text-xs text-purple-900 flex items-start gap-2">
                <HelpCircle className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Question-Wise Allocation:</strong> You are assigned to grade <strong>Question {allocatedQuestionNumber}</strong>. All questions are displayed below for context.
                </span>
              </div>
            ) : (
              <div className="bg-blue-50/70 border border-blue-200 rounded-brand p-2.5 text-xs text-blue-900 flex items-center justify-between">
                <span className="font-semibold">Whole-Script Evaluation Mode</span>
                <span className="text-2xs font-bold uppercase tracking-wider text-blue-700 bg-blue-100 px-2 py-0.5 rounded">All Questions</span>
              </div>
            )}

            {/* Questions list */}
            {questions.map((q) => {
              const isAllocated = !isQuestionWise || q.questionNumber === Number(allocatedQuestionNumber);
              const pointsSum = q.criteria.reduce((sum, c) => sum + (Number(c.points) || 0), 0);

              return (
                <div
                  key={q.questionNumber}
                  data-testid={`rubric-question-${q.questionNumber}`}
                  className={`rounded-brand border transition-all ${
                    isAllocated
                      ? isQuestionWise
                        ? 'border-brand-primary/50 bg-white ring-2 ring-brand-primary/10 shadow-xs'
                        : 'border-slate-200 bg-white shadow-2xs'
                      : 'border-slate-200 bg-slate-50/70 opacity-80'
                  }`}
                >
                  {/* Question Header */}
                  <div className={`p-3 border-b flex items-center justify-between gap-2 ${
                    isAllocated && isQuestionWise
                      ? 'bg-brand-primary/5 border-brand-primary/20'
                      : 'bg-slate-50 border-slate-100'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        Question {q.questionNumber}
                      </span>
                      <span className="text-2xs font-bold text-slate-500 bg-slate-200/80 px-1.5 py-0.5 rounded">
                        Max {q.maxMarks} M
                      </span>
                    </div>

                    {/* Status Badge */}
                    {isQuestionWise ? (
                      isAllocated ? (
                        <span
                          data-testid="badge-allocated"
                          className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Allocated</span>
                        </span>
                      ) : (
                        <span
                          data-testid="badge-readonly"
                          className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 border border-slate-300"
                        >
                          <Lock className="h-3 w-3" />
                          <span>Read-only</span>
                        </span>
                      )
                    ) : (
                      <span
                        data-testid="badge-editable"
                        className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
                      >
                        <span>Editable</span>
                      </span>
                    )}
                  </div>

                  {/* Criteria List */}
                  <div
                    data-testid={`rubric-criteria-list-${q.questionNumber}`}
                    className="p-3 space-y-2.5 text-xs"
                  >
                    {q.criteria.length === 0 ? (
                      <p className="text-2xs text-slate-400 italic">No sub-criteria specified for this question.</p>
                    ) : (
                      q.criteria.map((c, cIdx) => (
                        <div
                          key={cIdx}
                          data-testid={`criterion-item-${q.questionNumber}-${cIdx}`}
                          className="bg-slate-50/70 border border-slate-200/80 rounded p-2.5 space-y-1"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-bold text-slate-900 leading-snug">
                              {c.criterionName || `Criterion ${cIdx + 1}`}
                            </span>
                            <span className="shrink-0 text-2xs font-bold px-1.5 py-0.5 rounded bg-brand-primary/10 text-brand-primary font-mono">
                              {c.points} {c.points === 1 ? 'pt' : 'pts'}
                            </span>
                          </div>
                          {c.description && (
                            <p className="text-2xs text-slate-600 leading-relaxed">
                              {c.description}
                            </p>
                          )}
                        </div>
                      ))
                    )}

                    {/* Criteria total vs maxMarks summary */}
                    <div className="pt-1 flex items-center justify-between text-2xs text-slate-500 font-semibold border-t border-slate-100">
                      <span>Criteria Total:</span>
                      <span className={pointsSum === q.maxMarks ? 'text-emerald-700 font-bold' : 'text-slate-600'}>
                        {pointsSum} / {q.maxMarks} pts
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default RubricSidebar;
