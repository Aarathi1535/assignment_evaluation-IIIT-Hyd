'use client';

import React, { useState, useEffect } from 'react';
import {
  Award,
  CheckCircle2,
  MessageSquare,
  AlertCircle,
  Loader2,
  FileText,
} from 'lucide-react';
import type { ItemizedResultDto } from '@/services/StudentResultService';

export interface ItemizedFeedbackPanelProps {
  scriptId: string;
  className?: string;
}

export function ItemizedFeedbackPanel({
  scriptId,
  className = '',
}: ItemizedFeedbackPanelProps) {
  const [data, setData] = useState<ItemizedResultDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function fetchResults() {
      if (!scriptId) return;
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/student/results/${encodeURIComponent(scriptId)}`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
          }
        );

        if (!res.ok) {
          throw new Error('Itemized feedback not available');
        }

        const json = await res.json();
        if (!isCancelled) {
          setData(json);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load evaluation details';
          setError(message);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchResults();

    return () => {
      isCancelled = true;
    };
  }, [scriptId]);

  if (isLoading) {
    return (
      <div className={`bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col items-center justify-center min-h-[300px] text-slate-500 ${className}`}>
        <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
        <span className="text-sm font-medium">Loading evaluation scores & feedback...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col items-center justify-center min-h-[220px] text-center ${className}`}>
        <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
          <AlertCircle className="h-5 w-5" />
        </div>
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Feedback Unavailable</h3>
        <p className="text-xs text-slate-500 max-w-xs">
          {error || 'Scores and evaluation notes for this answer sheet have not been released.'}
        </p>
      </div>
    );
  }

  return (
    <aside
      aria-label="Evaluation Feedback and Scores"
      className={`bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col overflow-hidden ${className}`}
    >
      {/* Panel Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/70">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Award className="h-4 w-4 text-primary" />
            <span>Evaluation Summary</span>
          </div>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-200/70 text-slate-700">
            {data.mode === 'QUESTION' ? 'Question-wise' : 'Whole Script'}
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold text-slate-900 truncate pr-2">
            {data.exam?.title || 'Exam Evaluation'}
          </h2>
          <div className="flex items-baseline gap-1 text-slate-900 font-bold shrink-0">
            <span className="text-xl text-primary">{data.total}</span>
            <span className="text-xs text-slate-500">/ {data.maxTotal} marks</span>
          </div>
        </div>
      </div>

      {/* Itemized Questions / Criteria List */}
      <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-240px)]">
        {data.questions.map((q, idx) => {
          const isQuestionMode = data.mode === 'QUESTION';
          const title = isQuestionMode
            ? `Question ${q.questionNumber ?? idx + 1}`
            : 'Overall Evaluation';

          return (
            <div
              key={q.questionNumber !== null ? `q-${q.questionNumber}` : `whole-${idx}`}
              className="rounded-lg border border-slate-200/80 bg-slate-50/40 p-3.5 space-y-3 transition-colors hover:border-slate-300"
            >
              {/* Question / Section Header */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-slate-500" />
                  <h3 className="text-xs font-bold text-slate-800 tracking-tight">
                    {title}
                  </h3>
                </div>
                <div className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-white border border-slate-200 text-slate-800 shadow-2xs">
                  <span className="text-primary font-bold">{q.awarded}</span>
                  <span className="text-slate-400 mx-1">/</span>
                  <span>{q.maxMarks}</span>
                </div>
              </div>

              {/* Question-level Feedback (if present) */}
              {q.feedback && q.feedback.trim().length > 0 && (
                <div
                  data-testid="question-feedback"
                  className="rounded-md bg-amber-50/70 border border-amber-200/80 p-2.5 text-xs text-amber-900 space-y-1"
                >
                  <div className="flex items-center gap-1.5 font-semibold text-[11px] text-amber-800 uppercase tracking-wider">
                    <MessageSquare className="h-3 w-3" />
                    <span>Feedback</span>
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap">{q.feedback}</p>
                </div>
              )}

              {/* Criteria Breakdown */}
              {q.criteria && q.criteria.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Rubric Criteria Breakdown
                  </div>
                  <div className="space-y-1.5">
                    {q.criteria.map((c, cIdx) => (
                      <div
                        key={cIdx}
                        className="rounded bg-white border border-slate-200/70 p-2 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-700 flex items-center gap-1.5">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                            {c.name}
                          </span>
                          <span className="font-semibold text-slate-800 shrink-0 text-[11px]">
                            {c.score} / {c.points}
                          </span>
                        </div>
                        {c.feedback && c.feedback.trim().length > 0 && (
                          <div
                            data-testid="criterion-feedback"
                            className="mt-1 pt-1 border-t border-slate-100 text-[11px] text-slate-600 italic whitespace-pre-wrap pl-4"
                          >
                            &ldquo;{c.feedback}&rdquo;
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
