'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Radio,
  CheckCircle2,
  XCircle,
  Send,
  Lightbulb,
  Check,
  Lock
} from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface OptionResult {
  optionIndex: number;
  optionText: string;
  count: number;
  percentage: number;
  isCorrect?: boolean;
}

interface AggregatedResults {
  questionId: string;
  totalResponses: number;
  options: OptionResult[];
  textResponses?: Array<{ text: string; submittedAt: string }>;
  correctOptionIndex?: number | null;
  explanation?: string;
  isRevealed: boolean;
  status: string;
}

interface ActiveClassroomQuestion {
  _id: string;
  title: string;
  questionPrompt: string;
  type: 'MULTIPLE_CHOICE' | 'SHORT_ANSWER' | 'POLL';
  options: string[];
  correctOptionIndex?: number | null;
  explanation?: string;
  status: 'ACTIVE' | 'CLOSED' | 'REVEALED' | 'DRAFT';
  isRevealed?: boolean;
  hasSubmitted?: boolean;
  mySubmission?: {
    selectedOption?: number | null;
    textResponse?: string | null;
    isCorrect?: boolean | null;
    score?: number;
    submittedAt?: string;
  } | null;
  results?: AggregatedResults | null;
}

export default function StudentClassroomAssessmentPage() {
  const [question, setQuestion] = useState<ActiveClassroomQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [textResponse, setTextResponse] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isConnected, setIsConnected] = useState(true);

  const eventSourceRef = useRef<EventSource | null>(null);
  const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  const updateQuestionState = useCallback((data: ActiveClassroomQuestion | null) => {
    setQuestion((prev) => {
      // If question ID changes or becomes null, reset unsubmitted inputs
      if (!data || prev?._id !== data._id) {
        if (data?.mySubmission) {
          if (typeof data.mySubmission.selectedOption === 'number') {
            setSelectedOption(data.mySubmission.selectedOption);
          }
          if (data.mySubmission.textResponse) {
            setTextResponse(data.mySubmission.textResponse);
          }
        } else {
          setSelectedOption(null);
          setTextResponse('');
        }
      } else {
        // Same question: sync submission if newly recorded
        if (data.mySubmission) {
          if (typeof data.mySubmission.selectedOption === 'number') {
            setSelectedOption(data.mySubmission.selectedOption);
          }
          if (data.mySubmission.textResponse) {
            setTextResponse(data.mySubmission.textResponse);
          }
        }
      }
      return data;
    });
  }, []);

  const fetchActiveQuestion = useCallback(async () => {
    try {
      const res = await fetch('/api/classroom/questions/active');
      const json = await res.json();
      if (json.success && json.data) {
        updateQuestionState(json.data);
      } else {
        updateQuestionState(null);
      }
    } catch (err) {
      console.error('Failed to load active question:', err);
    } finally {
      setLoading(false);
    }
  }, [updateQuestionState]);

  useEffect(() => {
    async function init() {
      await fetchActiveQuestion();
    }
    init();

    // Setup SSE connection
    try {
      const sse = new EventSource('/api/classroom/stream');
      eventSourceRef.current = sse;

      sse.addEventListener('initial', (e) => {
        try {
          const data = JSON.parse(e.data);
          updateQuestionState(data.activeQuestion || null);
          setIsConnected(true);
        } catch {
          // ignore
        }
      });

      sse.addEventListener('classroom_update', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.activeQuestion !== undefined) {
            updateQuestionState(data.activeQuestion || null);
          }
          setIsConnected(true);
        } catch {
          // ignore
        }
      });

      sse.onerror = () => {
        setIsConnected(false);
      };
    } catch {
      // SSE creation error or unsupported
    }

    // Interval fallback to keep question state synced
    const interval = setInterval(() => {
      fetchActiveQuestion();
    }, 4000);

    return () => {
      clearInterval(interval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [fetchActiveQuestion, updateQuestionState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question) return;

    if (question.type === 'MULTIPLE_CHOICE' && selectedOption === null) {
      setErrorMessage('Please select an option before submitting.');
      return;
    }

    if (question.type === 'SHORT_ANSWER' && !textResponse.trim()) {
      setErrorMessage('Please enter your response before submitting.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');

    try {
      const res = await fetch('/api/classroom/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: question._id,
          selectedOption,
          textResponse: textResponse.trim()
        })
      });

      const json = await res.json();
      if (json.success) {
        // Immediately record submission state locally
        setQuestion((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            hasSubmitted: true,
            mySubmission: json.data || {
              selectedOption,
              textResponse: textResponse.trim(),
              submittedAt: new Date().toISOString()
            }
          };
        });
        await fetchActiveQuestion();
      } else {
        setErrorMessage(json.message || 'Failed to submit response.');
      }
    } catch {
      setErrorMessage('Network error while submitting response.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasSubmitted = question?.hasSubmitted || !!question?.mySubmission;
  const isRevealed = question?.isRevealed || question?.status === 'REVEALED';
  const isVotingClosed = question?.status === 'CLOSED';

  return (
    <DashboardLayout
      title="Classroom Participation"
      description="Interactive real-time learning: submit responses to live classroom questions and view class distribution."
    >
      {/* Live Status Bar */}
      <div className="flex items-center justify-between bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm text-xs font-semibold text-slate-600">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 relative">
            {isConnected && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                isConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
          </span>
          <span>{isConnected ? 'Connected to Live Session' : 'Reconnecting...'}</span>
        </div>
        <span className="text-slate-400">Updates live automatically</span>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-brand text-sm">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <div className="py-20 flex justify-center items-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : !question ? (
        /* STATE 1: WAITING FOR PROFESSOR */
        <Card className="text-center py-16 px-6 border-dashed border-2 border-slate-200 bg-white">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-4 animate-pulse">
            <Radio className="h-8 w-8" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            Waiting for the professor...
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            The professor has not launched a question yet. As soon as a question goes live, it will appear here instantly on your screen.
          </p>
        </Card>
      ) : isRevealed ? (
        /* STATE 4: REVEALED RESULTS & FEEDBACK */
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <span className="text-xs font-black uppercase tracking-wider text-indigo-600">
              {question.title}
            </span>
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-indigo-50 text-indigo-700">
              Results Revealed
            </span>
          </div>

          <div>
            <h2 className="text-2xl font-extrabold text-slate-900 mb-4">
              {question.questionPrompt}
            </h2>

            {/* Student Result Banner */}
            {question.mySubmission && typeof question.mySubmission.isCorrect === 'boolean' && (
              <div
                className={`p-4 rounded-xl border flex items-center gap-3 mb-6 ${
                  question.mySubmission.isCorrect
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {question.mySubmission.isCorrect ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-rose-600 shrink-0" />
                )}
                <div className="text-sm font-semibold">
                  {question.mySubmission.isCorrect
                    ? '🎉 Excellent! Your answer was correct.'
                    : question.correctOptionIndex !== undefined && question.correctOptionIndex !== null
                    ? `Not quite. The correct answer was Option ${
                        optionLetters[question.correctOptionIndex]
                      }: ${question.options[question.correctOptionIndex]}`
                    : 'Your response was submitted.'}
                </div>
              </div>
            )}
          </div>

          {/* Aggregated Option Distribution */}
          {question.type === 'MULTIPLE_CHOICE' && question.results && (
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Class Distribution ({question.results.totalResponses} Votes)
              </h4>

              {question.results.options.map((opt, idx) => {
                const isSelectedByStudent = question.mySubmission?.selectedOption === idx;
                const isCorrectAnswer = question.correctOptionIndex === idx;

                return (
                  <div
                    key={idx}
                    className={`relative rounded-xl border p-4 transition-all ${
                      isCorrectAnswer
                        ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-400'
                        : isSelectedByStudent
                        ? 'border-indigo-400 bg-indigo-50/40'
                        : 'border-slate-200 bg-slate-50/30'
                    }`}
                  >
                    {/* Fill */}
                    <div
                      className={`absolute top-0 bottom-0 left-0 rounded-xl ${
                        isCorrectAnswer ? 'bg-emerald-100' : 'bg-indigo-50'
                      }`}
                      style={{ width: `${opt.percentage}%`, zIndex: 0 }}
                    />

                    <div className="relative z-10 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-lg font-black text-sm ${
                            isCorrectAnswer
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-800'
                          }`}
                        >
                          {optionLetters[idx] || idx + 1}
                        </span>
                        <span className="font-semibold text-slate-900 text-base">
                          {opt.optionText}
                        </span>
                        {isCorrectAnswer && (
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            Correct
                          </span>
                        )}
                        {isSelectedByStudent && (
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                            Your Choice
                          </span>
                        )}
                      </div>

                      <div className="text-right">
                        <span className="text-base font-black text-slate-900">{opt.percentage}%</span>
                        <span className="text-xs text-slate-500 ml-1">({opt.count})</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Explanation Box */}
          {question.explanation && (
            <div className="p-5 bg-amber-50/80 border border-amber-200 rounded-xl flex items-start gap-3 mt-4">
              <Lightbulb className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                  Teaching Takeaway & Explanation
                </p>
                <p className="text-sm text-slate-800 font-medium">
                  {question.explanation}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : hasSubmitted ? (
        /* STATE 3: SUBMITTED, WAITING FOR REVEAL */
        <Card className="text-center py-12 px-6 bg-white border border-slate-200">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 mb-4">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-1">
            Response submitted — waiting for results
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
            Your response has been recorded. The results and explanation will appear here as soon as the professor reveals them.
          </p>

          <div className="max-w-md mx-auto bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Your Answer</span>
            <p className="text-base font-bold text-slate-800">
              {question.type === 'MULTIPLE_CHOICE' &&
              typeof (question.mySubmission?.selectedOption ?? selectedOption) === 'number'
                ? `Option ${optionLetters[(question.mySubmission?.selectedOption ?? selectedOption)!]}: ${
                    question.options[(question.mySubmission?.selectedOption ?? selectedOption)!]
                  }`
                : question.mySubmission?.textResponse || textResponse || 'Submitted'}
            </p>
          </div>
        </Card>
      ) : isVotingClosed ? (
        /* STATE 3B: VOTING CLOSED BEFORE SUBMISSION */
        <Card className="text-center py-12 px-6 bg-white border border-slate-200">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 mb-4">
            <Lock className="h-8 w-8" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-1">
            Voting Closed — waiting for results
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            The professor has closed submissions for this question. Results will appear as soon as the professor reveals them.
          </p>
        </Card>
      ) : (
        /* STATE 2: ACTIVE QUESTION - STUDENT SELECTS AND EXPLICITLY SUBMITS */
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <span className="text-xs font-black uppercase tracking-wider text-indigo-600">
              {question.title}
            </span>
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              <span>Voting Open</span>
            </span>
          </div>

          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
              {question.questionPrompt}
            </h2>
          </div>

          {/* Options for MCQ: Click selects option, does NOT submit */}
          {question.type === 'MULTIPLE_CHOICE' && (
            <div className="space-y-3 pt-2">
              {(question.options || []).map((optText, idx) => {
                const isSelected = selectedOption === idx;

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedOption(idx);
                    }}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center justify-between gap-4 ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-md ring-2 ring-indigo-400/20'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-lg font-black text-sm transition-colors ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {optionLetters[idx] || idx + 1}
                      </span>
                      <span className="font-semibold text-slate-900 text-base sm:text-lg">
                        {optText}
                      </span>
                    </div>

                    <div
                      className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Short Answer Input */}
          {question.type === 'SHORT_ANSWER' && (
            <div className="space-y-2 pt-2">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Type your answer
              </label>
              <textarea
                rows={3}
                placeholder="Type your response here..."
                value={textResponse}
                onChange={(e) => setTextResponse(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-900 text-base focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Explicit Submit Button */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={
                submitting ||
                (question.type === 'MULTIPLE_CHOICE' && selectedOption === null) ||
                (question.type === 'SHORT_ANSWER' && !textResponse.trim())
              }
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-base px-6 py-2.5 rounded-xl shadow-md"
            >
              <Send className="h-4 w-4" />
              <span>{submitting ? 'Submitting...' : 'Submit Response'}</span>
            </Button>
          </div>
        </form>
      )}
    </DashboardLayout>
  );
}
