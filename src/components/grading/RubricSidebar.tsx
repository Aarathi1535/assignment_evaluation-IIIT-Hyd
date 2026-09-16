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

export interface CriterionGradeEntry {
  criterionName: string;
  score: number;
}

export interface RubricSidebarProps {
  examId?: string;
  initialRubric?: RubricData | null;
  initialScores?: Record<string, number>;
  allocatedQuestionNumber?: number;
  onRubricLoaded?: (rubric: RubricData | null) => void;
  onScoresChange?: (marksAwarded: CriterionGradeEntry[]) => void;
  className?: string;
}

export function RubricSidebar({
  examId,
  initialRubric,
  initialScores,
  allocatedQuestionNumber,
  onRubricLoaded,
  onScoresChange,
  className = '',
}: RubricSidebarProps) {
  const [rubric, setRubric] = useState<RubricData | null>(initialRubric ?? null);
  const [loading, setLoading] = useState<boolean>(!initialRubric && Boolean(examId));
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState<number>(0);

  // Criterion-level score entry state
  const [scores, setScores] = useState<Record<string, number | string>>(initialScores ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isQuestionWise = allocatedQuestionNumber !== undefined && allocatedQuestionNumber !== null;

  useEffect(() => {
    if (initialRubric) {
      return;
    }

    if (!examId) {
      return;
    }

    let isMounted = true;

    async function loadRubric() {
      try {
        const res = await fetch(`/api/rubrics?exam=${encodeURIComponent(examId!)}`, {
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
            if (isMounted) {
              setRubric(null);
              setError(null);
              setLoading(false);
              onRubricLoaded?.(null);
            }
            return;
          }
          const errJson = await res.json().catch(() => null);
          throw new Error(errJson?.message || `Failed to fetch rubric (${res.status})`);
        }

        const json = await res.json();
        if (isMounted) {
          if (json.success && json.data) {
            setRubric(json.data);
            setError(null);
            onRubricLoaded?.(json.data);
          } else {
            setRubric(null);
            setError(null);
            onRubricLoaded?.(null);
          }
          setLoading(false);
        }
      } catch (err: unknown) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : 'An unexpected error occurred';
          setError(message);
          setRubric(null);
          onRubricLoaded?.(null);
          setLoading(false);
        }
      }
    }

    loadRubric();

    return () => {
      isMounted = false;
    };
  }, [examId, initialRubric, retryKey, onRubricLoaded]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    setRetryKey((k) => k + 1);
  }, []);

  const handleScoreChange = useCallback(
    (qNum: number, cName: string, maxPoints: number, rawValue: string) => {
      const key = `${qNum}-${cName}`;

      if (rawValue.trim() === '') {
        setScores((prev) => {
          const next = { ...prev };
          delete next[key];
          if (onScoresChange) {
            const marksList: CriterionGradeEntry[] = Object.entries(next)
              .filter(([, val]) => typeof val === 'number')
              .map(([k, val]) => {
                const criterionPart = k.substring(k.indexOf('-') + 1);
                return { criterionName: criterionPart, score: Number(val) };
              });
            onScoresChange(marksList);
          }
          return next;
        });
        setErrors((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }

      const num = Number(rawValue);

      if (Number.isNaN(num)) {
        setScores((prev) => ({ ...prev, [key]: rawValue }));
        setErrors((prev) => ({ ...prev, [key]: 'Please enter a valid number' }));
        return;
      }

      if (num < 0) {
        setScores((prev) => ({ ...prev, [key]: rawValue }));
        setErrors((prev) => ({ ...prev, [key]: 'Score cannot be negative' }));
        return;
      }

      if (num > maxPoints) {
        setScores((prev) => ({ ...prev, [key]: rawValue }));
        setErrors((prev) => ({
          ...prev,
          [key]: `Score cannot exceed maximum of ${maxPoints} pts`,
        }));
        return;
      }

      // Valid score
      setScores((prev) => {
        const next = { ...prev, [key]: num };
        if (onScoresChange) {
          const marksList: CriterionGradeEntry[] = Object.entries(next)
            .filter(([, val]) => typeof val === 'number')
            .map(([k, val]) => {
              const criterionPart = k.substring(k.indexOf('-') + 1);
              return { criterionName: criterionPart, score: Number(val) };
            });
          onScoresChange(marksList);
        }
        return next;
      });

      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [onScoresChange]
  );

  // Calculations
  const questions = rubric?.questions || [];
  const totalRubricMarks = questions.reduce((acc, q) => acc + (Number(q.maxMarks) || 0), 0);

  const getQuestionScore = (q: RubricQuestion) => {
    const sum = q.criteria.reduce((acc, c) => {
      const key = `${q.questionNumber}-${c.criterionName}`;
      const val = scores[key];
      const err = errors[key];
      if (typeof val === 'number' && !err && !Number.isNaN(val) && val >= 0 && val <= c.points) {
        return acc + val;
      }
      return acc;
    }, 0);
    return Math.round(sum * 100) / 100;
  };

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
              onClick={handleRetry}
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
              const questionScore = getQuestionScore(q);

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

                    <div className="flex items-center gap-2">
                      {/* Read-only Question Total */}
                      <div
                        data-testid={`question-total-${q.questionNumber}`}
                        aria-label={`Question ${q.questionNumber} Total Score`}
                        aria-readonly="true"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-white text-slate-900 border border-slate-200 shadow-2xs"
                      >
                        <span className="text-2xs text-slate-500 font-semibold">Total:</span>
                        <span className="font-mono text-brand-primary font-extrabold">{questionScore}</span>
                        <span className="text-2xs text-slate-400 font-normal">/ {q.maxMarks}</span>
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
                  </div>

                  {/* Criteria List */}
                  <div
                    data-testid={`rubric-criteria-list-${q.questionNumber}`}
                    className="p-3 space-y-3 text-xs"
                  >
                    {q.criteria.length === 0 ? (
                      <p className="text-2xs text-slate-400 italic">No sub-criteria specified for this question.</p>
                    ) : (
                      q.criteria.map((c, cIdx) => {
                        const scoreKey = `${q.questionNumber}-${c.criterionName}`;
                        const currentScore = scores[scoreKey] ?? '';
                        const currentError = errors[scoreKey];
                        const inputId = `score-input-${q.questionNumber}-${cIdx}`;
                        const errorId = `score-error-${q.questionNumber}-${cIdx}`;

                        return (
                          <div
                            key={cIdx}
                            data-testid={`criterion-item-${q.questionNumber}-${cIdx}`}
                            className={`bg-slate-50/70 border rounded p-2.5 space-y-2 transition-colors ${
                              currentError ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200/80'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="font-bold text-slate-900 leading-snug block">
                                  {c.criterionName || `Criterion ${cIdx + 1}`}
                                </span>
                                {c.description && (
                                  <p className="text-2xs text-slate-600 leading-relaxed mt-0.5">
                                    {c.description}
                                  </p>
                                )}
                              </div>
                              <span className="shrink-0 text-2xs font-bold px-1.5 py-0.5 rounded bg-brand-primary/10 text-brand-primary font-mono">
                                Max {c.points} {c.points === 1 ? 'pt' : 'pts'}
                              </span>
                            </div>

                            {/* Score Entry Input Field */}
                            <div className="flex flex-col gap-1 pt-1 border-t border-slate-200/60">
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  htmlFor={inputId}
                                  className="text-2xs font-bold text-slate-700 select-none cursor-pointer"
                                >
                                  Score Awarded:
                                </label>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    id={inputId}
                                    data-testid={inputId}
                                    type="number"
                                    min={0}
                                    max={c.points}
                                    step="any"
                                    disabled={!isAllocated}
                                    readOnly={!isAllocated}
                                    value={currentScore}
                                    onChange={(e) =>
                                      handleScoreChange(
                                        q.questionNumber,
                                        c.criterionName,
                                        c.points,
                                        e.target.value
                                      )
                                    }
                                    aria-label={`Score for ${c.criterionName} (Maximum ${c.points} points)`}
                                    aria-invalid={Boolean(currentError)}
                                    aria-describedby={currentError ? errorId : undefined}
                                    className={`w-20 px-2 py-1 rounded border text-xs font-bold text-center transition-colors focus:outline-none ${
                                      currentError
                                        ? 'border-rose-400 bg-rose-50 text-rose-900 focus:ring-2 focus:ring-rose-300'
                                        : isAllocated
                                          ? 'border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary'
                                          : 'border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed'
                                    }`}
                                    placeholder="0"
                                  />
                                  <span className="text-2xs font-bold text-slate-500">/ {c.points} pts</span>
                                </div>
                              </div>

                              {/* Accessible Validation Error Message */}
                              {currentError && (
                                <span
                                  id={errorId}
                                  data-testid={errorId}
                                  role="alert"
                                  className="text-2xs text-rose-600 font-semibold text-right"
                                >
                                  {currentError}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
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

