'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  Plus,
  Radio,
  X,
  Play,
  Lock,
  Eye,
  SkipForward,
  PowerOff,
  Trash2,
  Users,
  CheckCircle2,
  Lightbulb,
  Layers,
  BarChart2
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

interface StudentResponseHistoryItem {
  submissionId: string;
  studentName: string;
  studentEmail?: string;
  selectedOption?: number | null;
  selectedOptionText?: string | null;
  textResponse?: string | null;
  isCorrect?: boolean | null;
  submittedAt: string;
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
  responseHistory?: StudentResponseHistoryItem[];
}

interface ClassroomQuestion {
  _id: string;
  title: string;
  questionPrompt: string;
  type: 'MULTIPLE_CHOICE' | 'SHORT_ANSWER' | 'POLL';
  options: string[];
  correctOptionIndex?: number | null;
  explanation?: string;
  isActive: boolean;
  isRevealed?: boolean;
  status: 'ACTIVE' | 'CLOSED' | 'REVEALED' | 'DRAFT';
  order: number;
  createdAt: string;
  results?: AggregatedResults;
}

export default function ProfessorClassroomAssessmentPage() {
  const [questions, setQuestions] = useState<ClassroomQuestion[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<ClassroomQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newType, setNewType] = useState<'MULTIPLE_CHOICE' | 'SHORT_ANSWER' | 'POLL'>('MULTIPLE_CHOICE');
  const [newOptions, setNewOptions] = useState<string[]>(['', '', '', '']);
  const [newCorrectOption, setNewCorrectOption] = useState<number | null>(0);
  const [newExplanation, setNewExplanation] = useState('');
  const [activateNow, setActivateNow] = useState(true);
  const [creating, setCreating] = useState(false);

  // Completed Session / Results & History View State
  const [historyQuestion, setHistoryQuestion] = useState<{
    question: ClassroomQuestion;
    results: AggregatedResults | null;
    loading: boolean;
  } | null>(null);

  // SSE event source ref
  const eventSourceRef = useRef<EventSource | null>(null);

  const handleViewResultsAndHistory = async (q: ClassroomQuestion) => {
    setHistoryQuestion({ question: q, results: null, loading: true });
    try {
      const res = await fetch(`/api/classroom/questions/${q._id}/results`);
      const json = await res.json();
      if (json.success && json.data) {
        setHistoryQuestion({ question: q, results: json.data, loading: false });
      } else {
        setHistoryQuestion({ question: q, results: null, loading: false });
      }
    } catch {
      setHistoryQuestion({ question: q, results: null, loading: false });
    }
  };

  const fetchQuestions = useCallback(async () => {
    try {
      const res = await fetch('/api/classroom/questions');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setQuestions(json.data);
      }
    } catch (err) {
      console.error('Failed to load questions:', err);
    }
  }, []);

  const fetchActiveQuestion = useCallback(async () => {
    try {
      const res = await fetch('/api/classroom/questions/active');
      const json = await res.json();
      if (json.success && json.data) {
        setActiveQuestion(json.data);
      } else {
        setActiveQuestion(null);
      }
    } catch (err) {
      console.error('Failed to load active question:', err);
    }
  }, []);

  // Setup Real-time SSE listener with polling fallback
  useEffect(() => {
    async function loadData() {
      try {
        await Promise.all([fetchQuestions(), fetchActiveQuestion()]);
      } finally {
        setLoading(false);
      }
    }
    loadData();

    // SSE connection
    try {
      const sse = new EventSource('/api/classroom/stream');
      eventSourceRef.current = sse;

      sse.addEventListener('initial', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.activeQuestion) {
            setActiveQuestion(data.activeQuestion);
          }
        } catch {
          // ignore parse error
        }
      });

      sse.addEventListener('classroom_update', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.activeQuestion !== undefined) {
            setActiveQuestion(data.activeQuestion);
          }
          fetchQuestions();
        } catch {
          // ignore parse error
        }
      });

      sse.onerror = () => {
        // SSE will attempt auto-reconnect
      };
    } catch (err) {
      console.warn('SSE not supported or failed to connect:', err);
    }

    // Interval fallback to keep counts fresh
    const interval = setInterval(() => {
      fetchActiveQuestion();
    }, 4000);

    return () => {
      clearInterval(interval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [fetchQuestions, fetchActiveQuestion]);

  // Actions
  const handleLaunchQuestion = async (questionId: string) => {
    setActionLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/classroom/questions/${questionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate' })
      });
      const json = await res.json();
      if (json.success) {
        setSuccessMessage('Question launched live!');
        await Promise.all([fetchActiveQuestion(), fetchQuestions()]);
      } else {
        setErrorMessage(json.message || 'Failed to activate question');
      }
    } catch {
      setErrorMessage('Network error activating question');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCloseVoting = async () => {
    if (!activeQuestion) return;
    setActionLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/classroom/questions/${activeQuestion._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' })
      });
      const json = await res.json();
      if (json.success) {
        setSuccessMessage('Voting closed. Student responses locked.');
        await Promise.all([fetchActiveQuestion(), fetchQuestions()]);
      } else {
        setErrorMessage(json.message || 'Failed to close question');
      }
    } catch {
      setErrorMessage('Network error closing question');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevealResults = async () => {
    if (!activeQuestion) return;
    setActionLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/classroom/questions/${activeQuestion._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reveal' })
      });
      const json = await res.json();
      if (json.success) {
        setSuccessMessage('Results and explanation revealed to students!');
        await Promise.all([fetchActiveQuestion(), fetchQuestions()]);
      } else {
        setErrorMessage(json.message || 'Failed to reveal results');
      }
    } catch {
      setErrorMessage('Network error revealing results');
    } finally {
      setActionLoading(false);
    }
  };

  const handleNextQuestion = async () => {
    if (!activeQuestion) return;
    setActionLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/classroom/questions/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentQuestionId: activeQuestion._id })
      });
      const json = await res.json();
      if (json.success) {
        if (json.data) {
          setSuccessMessage('Moved to next question!');
        } else {
          setSuccessMessage('All questions in deck presented.');
        }
        await Promise.all([fetchActiveQuestion(), fetchQuestions()]);
      } else {
        setErrorMessage(json.message || 'Failed to move to next question');
      }
    } catch {
      setErrorMessage('Network error moving to next question');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!activeQuestion) return;
    setActionLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/classroom/questions/${activeQuestion._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deactivate' })
      });
      const json = await res.json();
      if (json.success) {
        setSuccessMessage('Session ended. Question returned to deck.');
        await Promise.all([fetchActiveQuestion(), fetchQuestions()]);
      } else {
        setErrorMessage(json.message || 'Failed to deactivate');
      }
    } catch {
      setErrorMessage('Network error deactivating question');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (!confirm('Are you sure you want to delete this question and its responses?')) return;
    try {
      const res = await fetch(`/api/classroom/questions/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setSuccessMessage('Question deleted successfully');
        await Promise.all([fetchQuestions(), fetchActiveQuestion()]);
      }
    } catch {
      setErrorMessage('Failed to delete question');
    }
  };

  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setErrorMessage('');
    try {
      const filteredOptions = newOptions.map((o) => o.trim()).filter(Boolean);
      if (newType === 'MULTIPLE_CHOICE' && filteredOptions.length < 2) {
        setErrorMessage('Multiple choice questions require at least 2 options.');
        setCreating(false);
        return;
      }

      const payload = {
        title: newTitle.trim(),
        questionPrompt: newPrompt.trim(),
        type: newType,
        options: filteredOptions,
        correctOptionIndex: newType === 'MULTIPLE_CHOICE' ? newCorrectOption : null,
        explanation: newExplanation.trim(),
        isActive: activateNow,
        order: questions.length + 1
      };

      const res = await fetch('/api/classroom/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        setShowCreateModal(false);
        setNewTitle('');
        setNewPrompt('');
        setNewOptions(['', '', '', '']);
        setNewCorrectOption(0);
        setNewExplanation('');
        setSuccessMessage(activateNow ? 'Question created and launched live!' : 'Question saved to deck!');
        await Promise.all([fetchQuestions(), fetchActiveQuestion()]);
      } else {
        setErrorMessage(json.message || 'Failed to create question');
      }
    } catch {
      setErrorMessage('Network error while creating question');
    } finally {
      setCreating(false);
    }
  };

  const totalVotes = activeQuestion?.results?.totalResponses || 0;
  const isQuestionRevealed = activeQuestion?.isRevealed || activeQuestion?.status === 'REVEALED';
  const isQuestionClosed = activeQuestion?.status === 'CLOSED';
  const isQuestionActive = activeQuestion?.status === 'ACTIVE';

  const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  return (
    <DashboardLayout
      title="Interactive Classroom Assessment"
      description="Live Mentimeter-style student polling, instant formative checks, and real-time comprehension insights."
      quickActions={
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={() => {
              setShowCreateModal(true);
              setErrorMessage('');
              setSuccessMessage('');
            }}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>Create Question</span>
          </Button>
        </div>
      }
    >
      {/* Messages */}
      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-brand text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="text-rose-500 hover:text-rose-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-brand text-sm flex items-center justify-between">
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage('')} className="text-emerald-500 hover:text-emerald-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-20 flex justify-center items-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* LIVE PRESENTATION STAGE */}
          {activeQuestion ? (
            <div className="bg-white border-2 border-indigo-500/30 rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
              {/* Top Accent Strip */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

              {/* Status Header */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="flex h-3 w-3 relative">
                    {isQuestionActive && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span
                      className={`relative inline-flex rounded-full h-3 w-3 ${
                        isQuestionActive
                          ? 'bg-emerald-500'
                          : isQuestionClosed
                          ? 'bg-amber-500'
                          : 'bg-indigo-500'
                      }`}
                    />
                  </span>
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                    {isQuestionActive
                      ? 'Live Voting Open'
                      : isQuestionClosed
                      ? 'Voting Closed'
                      : 'Results Revealed'}
                  </span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600">
                    {activeQuestion.type.replace('_', ' ')}
                  </span>
                </div>

                <div className="flex items-center gap-2 bg-indigo-50 px-4 py-1.5 rounded-full border border-indigo-100 text-indigo-700 font-bold text-sm">
                  <Users className="h-4 w-4" />
                  <span>{totalVotes} {totalVotes === 1 ? 'Response' : 'Responses'}</span>
                </div>
              </div>

              {/* Question Body */}
              <div className="py-6 space-y-3">
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest">
                  {activeQuestion.title}
                </p>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
                  {activeQuestion.questionPrompt}
                </h2>
              </div>

              {/* Professor Results Dashboard Banner (When Voting Closed or Results Revealed) */}
              {(isQuestionClosed || isQuestionRevealed) && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 my-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 shrink-0">
                      <BarChart2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        {isQuestionClosed
                          ? 'Voting Closed — Professor Results Dashboard'
                          : 'Classroom Results Dashboard (Revealed to Class)'}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {isQuestionClosed
                          ? 'Review student response distribution and correct answer before revealing to students.'
                          : 'Distribution, correct answer, and teaching takeaway are currently visible to students.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 shadow-sm">
                      Total Responses: <strong className="text-slate-900">{totalVotes}</strong>
                    </div>
                    {activeQuestion.type === 'MULTIPLE_CHOICE' &&
                      activeQuestion.correctOptionIndex !== null &&
                      activeQuestion.correctOptionIndex !== undefined && (
                        <div className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-1.5 shadow-sm">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>
                            Correct Answer: <strong>Option {optionLetters[activeQuestion.correctOptionIndex] || activeQuestion.correctOptionIndex + 1}</strong>
                          </span>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* Option Distribution Bars */}
              {activeQuestion.type === 'MULTIPLE_CHOICE' && (
                <div className="space-y-4 py-4">
                  {(activeQuestion.options || []).map((optText, idx) => {
                    const result = activeQuestion.results?.options?.find((o) => o.optionIndex === idx);
                    const count = result?.count || 0;
                    const pct = result?.percentage || 0;
                    const isCorrect = (isQuestionClosed || isQuestionRevealed) && activeQuestion.correctOptionIndex === idx;

                    return (
                      <div
                        key={idx}
                        className={`relative rounded-xl border p-4 transition-all duration-300 ${
                          isCorrect
                            ? 'border-emerald-500 bg-emerald-50/50 shadow-md ring-2 ring-emerald-400/20'
                            : 'border-slate-200 bg-slate-50/50'
                        }`}
                      >
                        {/* Progress Fill Bar */}
                        <div
                          className={`absolute top-0 bottom-0 left-0 rounded-xl transition-all duration-700 ${
                            isCorrect ? 'bg-emerald-100' : 'bg-indigo-50'
                          }`}
                          style={{ width: `${pct}%`, zIndex: 0 }}
                        />

                        {/* Content */}
                        <div className="relative z-10 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <span
                              className={`flex h-8 w-8 items-center justify-center rounded-lg font-black text-sm ${
                                isCorrect
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-200 text-slate-800'
                              }`}
                            >
                              {optionLetters[idx] || idx + 1}
                            </span>
                            <span className="font-semibold text-slate-900 text-base sm:text-lg">
                              {optText}
                            </span>
                            {isCorrect && (
                              <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Correct Answer
                              </span>
                            )}
                          </div>

                          <div className="text-right flex items-baseline gap-2">
                            <span className="text-xl font-black text-slate-900">{count}</span>
                            <span className="text-xs font-bold text-slate-500">({pct}%)</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Short Answer Responses Display */}
              {activeQuestion.type === 'SHORT_ANSWER' && (
                <div className="py-4 space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Student Submissions ({totalVotes})
                  </h4>
                  {activeQuestion.results?.textResponses && activeQuestion.results.textResponses.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {activeQuestion.results.textResponses.map((res, i) => (
                        <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800">
                          &ldquo;{res.text}&rdquo;
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 italic">No responses received yet.</p>
                  )}
                </div>
              )}

              {/* Explanation Note (When Closed or Revealed) */}
              {(isQuestionClosed || isQuestionRevealed) && activeQuestion.explanation && (
                <div className="mt-4 p-5 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-start gap-3">
                  <Lightbulb className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                      Teaching Takeaway & Explanation
                    </p>
                    <p className="text-sm text-slate-800 font-medium">
                      {activeQuestion.explanation}
                    </p>
                  </div>
                </div>
              )}

              {/* Student Response History (When Closed or Revealed) */}
              {(isQuestionClosed || isQuestionRevealed) && (
                <div className="mt-6 pt-5 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                      <Users className="h-4 w-4 text-indigo-600" />
                      <span>Student Response History ({activeQuestion.results?.responseHistory?.length || 0})</span>
                    </h4>
                    <span className="text-[11px] text-slate-400">Preserved indefinitely for completed review</span>
                  </div>

                  {activeQuestion.results?.responseHistory && activeQuestion.results.responseHistory.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                            <th className="py-2.5 px-4">Student</th>
                            <th className="py-2.5 px-4">Submitted Answer</th>
                            <th className="py-2.5 px-4 text-center">Outcome</th>
                            <th className="py-2.5 px-4 text-right">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeQuestion.results.responseHistory.map((item) => (
                            <tr key={item.submissionId} className="hover:bg-slate-50/60 transition-colors">
                              <td className="py-2.5 px-4">
                                <span className="font-semibold text-slate-900 block">{item.studentName}</span>
                                {item.studentEmail && (
                                  <span className="text-[11px] text-slate-400">{item.studentEmail}</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-slate-700">
                                {activeQuestion.type === 'MULTIPLE_CHOICE' && typeof item.selectedOption === 'number' ? (
                                  <span className="font-medium">
                                    Option {optionLetters[item.selectedOption] || item.selectedOption + 1}: {item.selectedOptionText || activeQuestion.options[item.selectedOption]}
                                  </span>
                                ) : (
                                  <span className="italic">{item.textResponse || '—'}</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                {item.isCorrect === true ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                    Correct
                                  </span>
                                ) : item.isCorrect === false ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                                    Incorrect
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                                    Submitted
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-400">
                                {new Date(item.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
                      No student responses received yet.
                    </div>
                  )}
                </div>
              )}

              {/* Presentation Controls */}
              <div className="mt-8 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {isQuestionActive && (
                    <Button
                      variant="secondary"
                      onClick={handleCloseVoting}
                      disabled={actionLoading}
                      className="flex items-center gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
                    >
                      <Lock className="h-4 w-4" />
                      <span>Close Voting</span>
                    </Button>
                  )}

                  {!isQuestionRevealed && (
                    <Button
                      variant="primary"
                      onClick={handleRevealResults}
                      disabled={actionLoading}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      <Eye className="h-4 w-4" />
                      <span>Reveal Results & Answer</span>
                    </Button>
                  )}

                  <Button
                    variant={isQuestionRevealed ? 'primary' : 'outline'}
                    onClick={handleNextQuestion}
                    disabled={actionLoading}
                    className="flex items-center gap-2"
                  >
                    <SkipForward className="h-4 w-4" />
                    <span>Next Question</span>
                  </Button>
                </div>

                <Button
                  variant="outline"
                  onClick={handleDeactivate}
                  disabled={actionLoading}
                  className="flex items-center gap-2 text-rose-600 border-rose-200 hover:bg-rose-50"
                >
                  <PowerOff className="h-4 w-4" />
                  <span>End Live Session</span>
                </Button>
              </div>
            </div>
          ) : (
            <Card className="text-center py-12 px-6 border-dashed border-2 border-slate-200 bg-slate-50/50">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-4">
                <Radio className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">No Active Question Live</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
                Launch a question from your question deck below to begin receiving live student answers on their devices.
              </p>
              {questions.length > 0 && (
                <Button
                  variant="primary"
                  onClick={() => handleLaunchQuestion(questions[0]._id)}
                  className="flex items-center gap-2 mx-auto"
                >
                  <Play className="h-4 w-4" />
                  <span>Launch First Question ({questions[0].title})</span>
                </Button>
              )}
            </Card>
          )}

          {/* QUESTION DECK / BANK */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-slate-700" />
                <h3 className="text-lg font-bold text-slate-900">Question Deck ({questions.length})</h3>
              </div>
              <span className="text-xs text-slate-500">Only one question is active live at any moment.</span>
            </div>

            {questions.length === 0 ? (
              <Card className="text-center py-8 text-slate-400 text-sm">
                No questions created yet. Click &ldquo;Create Question&rdquo; to add your first interactive prompt.
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {questions.map((q, idx) => {
                  const isCurrentActive = activeQuestion?._id === q._id;

                  return (
                    <div
                      key={q._id}
                      className={`p-5 rounded-xl border bg-white transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                        isCurrentActive
                          ? 'border-indigo-500 shadow-md ring-2 ring-indigo-400/20'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs font-black text-slate-400">#{idx + 1}</span>
                          <h4 className="font-bold text-slate-900 text-base">{q.title}</h4>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            {q.type.replace('_', ' ')}
                          </span>
                          {isCurrentActive && (
                            <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                              ACTIVE LIVE
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 line-clamp-1">{q.questionPrompt}</p>
                        {q.options && q.options.length > 0 && (
                          <p className="text-xs text-slate-400">
                            {q.options.length} options: {q.options.join(', ')}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!isCurrentActive && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleLaunchQuestion(q._id)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <Play className="h-3.5 w-3.5" />
                            <span>Present Live</span>
                          </Button>
                        )}

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewResultsAndHistory(q)}
                          disabled={actionLoading}
                          className="flex items-center gap-1.5 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                        >
                          <BarChart2 className="h-3.5 w-3.5" />
                          <span>Results & History</span>
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteQuestion(q._id)}
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CREATE QUESTION MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-600" />
                <h3 className="text-lg font-bold text-slate-900">Create Classroom Question</h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateQuestion} className="space-y-5 pt-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Question Title / Topic *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cache Memory Check, Quiz Q1"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Question Prompt *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Which of the following is true regarding cache write-through policy?"
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Question Type
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="qtype"
                      checked={newType === 'MULTIPLE_CHOICE'}
                      onChange={() => setNewType('MULTIPLE_CHOICE')}
                    />
                    <span>Multiple Choice (MCQ)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="qtype"
                      checked={newType === 'SHORT_ANSWER'}
                      onChange={() => setNewType('SHORT_ANSWER')}
                    />
                    <span>Short Answer / Open Text</span>
                  </label>
                </div>
              </div>

              {/* Options for MCQ */}
              {newType === 'MULTIPLE_CHOICE' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Options & Correct Answer
                    </label>
                    <span className="text-xs text-slate-400">Mark the correct answer button</span>
                  </div>

                  {newOptions.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setNewCorrectOption(i)}
                        className={`h-7 w-7 rounded-full text-xs font-bold flex items-center justify-center border transition-all ${
                          newCorrectOption === i
                            ? 'bg-emerald-600 text-white border-emerald-600 ring-2 ring-emerald-300'
                            : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
                        }`}
                        title="Mark as correct answer"
                      >
                        {optionLetters[i] || i + 1}
                      </button>
                      <input
                        type="text"
                        placeholder={`Option ${optionLetters[i] || i + 1}`}
                        value={opt}
                        onChange={(e) => {
                          const updated = [...newOptions];
                          updated[i] = e.target.value;
                          setNewOptions(updated);
                        }}
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500"
                      />
                      {newOptions.length > 2 && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = newOptions.filter((_, idx) => idx !== i);
                            setNewOptions(updated);
                            if (newCorrectOption === i) setNewCorrectOption(0);
                          }}
                          className="text-slate-400 hover:text-rose-500 p-1"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}

                  {newOptions.length < 6 && (
                    <button
                      type="button"
                      onClick={() => setNewOptions([...newOptions, ''])}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
                    >
                      + Add Option
                    </button>
                  )}
                </div>
              )}

              {/* Explanation Note */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Teaching Takeaway / Explanation (Revealed after closing)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Write-through guarantees consistency immediately, whereas write-back delays until replacement."
                  value={newExplanation}
                  onChange={(e) => setNewExplanation(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Immediate Launch Checkbox */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="activateNow"
                  checked={activateNow}
                  onChange={(e) => setActivateNow(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="activateNow" className="text-sm font-semibold text-slate-800 cursor-pointer">
                  Launch this question live to students immediately
                </label>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={creating}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {creating ? 'Creating...' : 'Save Question'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* COMPLETED SESSION / RESULTS & HISTORY MODAL */}
      {historyQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto space-y-6">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <BarChart2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">
                      {historyQuestion.question.title}
                    </h3>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {historyQuestion.question.type.replace('_', ' ')}
                    </span>
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                      {historyQuestion.question.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Completed Classroom Session Results & Response History (Preserved Indefinitely)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setHistoryQuestion(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {historyQuestion.loading ? (
              <div className="py-16 flex justify-center items-center">
                <LoadingSpinner size="lg" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Prompt */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Question Prompt
                  </span>
                  <p className="text-base font-bold text-slate-900">
                    {historyQuestion.question.questionPrompt}
                  </p>
                </div>

                {/* Summary Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Total Responses
                    </span>
                    <span className="text-2xl font-black text-slate-900">
                      {historyQuestion.results?.totalResponses ?? 0}
                    </span>
                  </div>

                  {historyQuestion.question.type === 'MULTIPLE_CHOICE' &&
                    historyQuestion.question.correctOptionIndex !== null &&
                    historyQuestion.question.correctOptionIndex !== undefined && (
                      <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 shadow-sm flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 uppercase tracking-wider">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span>Correct Answer</span>
                        </div>
                        <span className="text-sm font-black text-emerald-900">
                          Option {optionLetters[historyQuestion.question.correctOptionIndex] || historyQuestion.question.correctOptionIndex + 1}
                        </span>
                      </div>
                    )}
                </div>

                {/* Response Distribution Bars (MCQ) */}
                {historyQuestion.question.type === 'MULTIPLE_CHOICE' && (
                  <div className="space-y-3 pt-1">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Response Distribution
                    </h4>
                    <div className="space-y-2.5">
                      {(historyQuestion.question.options || []).map((optText, idx) => {
                        const result = historyQuestion.results?.options?.find((o) => o.optionIndex === idx);
                        const count = result?.count || 0;
                        const pct = result?.percentage || 0;
                        const isCorrect = historyQuestion.question.correctOptionIndex === idx;

                        return (
                          <div
                            key={idx}
                            className={`relative rounded-xl border p-3.5 transition-all ${
                              isCorrect
                                ? 'border-emerald-500 bg-emerald-50/40 shadow-sm ring-1 ring-emerald-400'
                                : 'border-slate-200 bg-slate-50/40'
                            }`}
                          >
                            <div
                              className={`absolute top-0 bottom-0 left-0 rounded-xl transition-all duration-500 ${
                                isCorrect ? 'bg-emerald-100' : 'bg-indigo-50'
                              }`}
                              style={{ width: `${pct}%`, zIndex: 0 }}
                            />

                            <div className="relative z-10 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5">
                                <span
                                  className={`flex h-7 w-7 items-center justify-center rounded-lg font-black text-xs ${
                                    isCorrect
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-200 text-slate-800'
                                  }`}
                                >
                                  {optionLetters[idx] || idx + 1}
                                </span>
                                <span className="font-semibold text-slate-900 text-sm">
                                  {optText}
                                </span>
                                {isCorrect && (
                                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Correct Answer
                                  </span>
                                )}
                              </div>

                              <div className="text-right flex items-baseline gap-1.5">
                                <span className="text-base font-black text-slate-900">{count}</span>
                                <span className="text-xs font-bold text-slate-500">({pct}%)</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Explanation / Teaching Takeaway */}
                {historyQuestion.question.explanation && (
                  <div className="p-4 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-start gap-3">
                    <Lightbulb className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                        Teaching Takeaway & Explanation
                      </p>
                      <p className="text-sm text-slate-800 font-medium">
                        {historyQuestion.question.explanation}
                      </p>
                    </div>
                  </div>
                )}

                {/* Concise Response History */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                      <Users className="h-4 w-4 text-indigo-600" />
                      <span>Student Response History ({historyQuestion.results?.responseHistory?.length || 0})</span>
                    </h4>
                    <span className="text-[11px] text-slate-400">Preserved indefinitely</span>
                  </div>

                  {historyQuestion.results?.responseHistory && historyQuestion.results.responseHistory.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="sticky top-0 bg-slate-50 z-10">
                          <tr className="border-b border-slate-200 text-slate-500 font-bold">
                            <th className="py-2.5 px-4">Student</th>
                            <th className="py-2.5 px-4">Submitted Answer</th>
                            <th className="py-2.5 px-4 text-center">Outcome</th>
                            <th className="py-2.5 px-4 text-right">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {historyQuestion.results.responseHistory.map((item) => (
                            <tr key={item.submissionId} className="hover:bg-slate-50/60 transition-colors">
                              <td className="py-2.5 px-4">
                                <span className="font-semibold text-slate-900 block">{item.studentName}</span>
                                {item.studentEmail && (
                                  <span className="text-[11px] text-slate-400">{item.studentEmail}</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-slate-700">
                                {historyQuestion.question.type === 'MULTIPLE_CHOICE' && typeof item.selectedOption === 'number' ? (
                                  <span className="font-medium">
                                    Option {optionLetters[item.selectedOption] || item.selectedOption + 1}: {item.selectedOptionText || historyQuestion.question.options[item.selectedOption]}
                                  </span>
                                ) : (
                                  <span className="italic">{item.textResponse || '—'}</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                {item.isCorrect === true ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                    Correct
                                  </span>
                                ) : item.isCorrect === false ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                                    Incorrect
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                                    Submitted
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-400">
                                {new Date(item.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
                      No student responses submitted for this question yet.
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <Button
                    variant="primary"
                    onClick={() => setHistoryQuestion(null)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    Close Results & History
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
