/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  Plus,
  Play,
  Clock,
  QrCode,
  Users,
  CheckCircle2,
  XCircle,
  Send,
  RefreshCw,
  AlertCircle,
  Tv,
  Minimize2,
  X,
  ChevronRight,
  Layers
} from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface ClassroomSession {
  _id: string;
  id?: string;
  title: string;
  joinCode: string;
  qrCodeSvg: string;
  status: 'ACTIVE' | 'CLOSED';
  participantCount: number;
  currentActivity?: ClassroomActivity | null;
  createdAt: string;
}

interface ClassroomActivity {
  _id: string;
  id?: string;
  title: string;
  questionPrompt: string;
  referenceAnswer?: string | null;
  timeLimit: number;
  expiresAt?: string | null;
  totalSubmissions: number;
  correctCount: number;
  incorrectCount: number;
  status: 'ACTIVE' | 'CLOSED' | 'PUBLISHED' | 'DRAFT';
  isPublished?: boolean;
}

interface ClassroomSubmission {
  _id: string;
  id?: string;
  participantId?: string;
  studentName: string;
  imagePath: string;
  textResponse?: string | null;
  feedback?: string | null;
  isCorrect?: boolean | null;
  status: string;
  submittedAt: string;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

export default function ProfessorClassroomPage() {
  const [, setSessions] = useState<ClassroomSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ClassroomSession | null>(null);
  const [currentActivity, setCurrentActivity] = useState<ClassroomActivity | null>(null);
  const [submissions, setSubmissions] = useState<ClassroomSubmission[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [questionPrompt, setQuestionPrompt] = useState('');
  const [referenceAnswer, setReferenceAnswer] = useState('');
  const [timeLimit, setTimeLimit] = useState(180); // 3 mins default

  // Review Modal State
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);

  // UI Modes
  const [presenterMode, setPresenterMode] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  // Timer Countdown State
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  // Load Sessions
  useEffect(() => {
    let active = true;
    const loadSessions = async () => {
      try {
        const res = await fetch('/api/classroom/sessions');
        const data = await res.json();
        if (!active) return;
        if (data.success && Array.isArray(data.data)) {
          setSessions(data.data);
          if (data.data.length > 0) {
            const first = data.data[0];
            setCurrentSession((prev) => prev || first);
            if (first.currentActivity) {
              setCurrentActivity((prev) => prev || first.currentActivity);
            }
          }
        }
      } catch {
        if (active) setErrorMessage('Failed to load classroom sessions');
      }
    };
    loadSessions();
    return () => { active = false; };
  }, []);

  // Fetch Submissions for Current Activity
  const fetchSubmissions = useCallback(async (sessionCode: string) => {
    if (!sessionCode) return;
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionCode}/submissions`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setSubmissions(data.data);
      }
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    if (!currentSession?.joinCode || !currentActivity) return;
    let active = true;
    const loadSubs = async () => {
      try {
        const res = await fetch(`/api/classroom/sessions/${currentSession.joinCode}/submissions`);
        const data = await res.json();
        if (active && data.success && Array.isArray(data.data)) {
          setSubmissions(data.data);
        }
      } catch {
        // Non-blocking
      }
    };
    loadSubs();
    return () => { active = false; };
  }, [currentSession?.joinCode, currentActivity]);

  // Real-time SSE Connection
  useEffect(() => {
    if (!currentSession?.joinCode) return;

    const sse = new EventSource(`/api/classroom/sessions/${currentSession.joinCode}/stream`);
    eventSourceRef.current = sse;

    sse.addEventListener('initial', (e) => {
      try {
        const snap = JSON.parse(e.data);
        if (snap.activity) {
          setCurrentActivity(snap.activity);
        }
        if (typeof snap.participantCount === 'number') {
          setCurrentSession((prev) => prev ? { ...prev, participantCount: snap.participantCount } : null);
        }
      } catch {
        // Ignore
      }
    });

    sse.addEventListener('classroom_event', (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'SESSION_JOINED') {
          if (typeof event.payload?.participantCount === 'number') {
            setCurrentSession((prev) => prev ? { ...prev, participantCount: event.payload.participantCount } : null);
          }
        } else if (event.type === 'SUBMISSION_RECEIVED') {
          if (currentSession?.joinCode) {
            fetchSubmissions(currentSession.joinCode);
          }
          if (typeof event.payload?.totalSubmissions === 'number') {
            setCurrentActivity((prev) => prev ? { ...prev, totalSubmissions: event.payload.totalSubmissions } : null);
          }
        } else if (event.type === 'ACTIVITY_CLOSED' || event.type === 'QUESTION_CLOSED') {
          setCurrentActivity((prev) => prev ? { ...prev, status: 'CLOSED' } : null);
        } else if (event.type === 'TIMER_EXTENDED') {
          if (event.payload?.expiresAt) {
            setCurrentActivity((prev) => prev ? { ...prev, expiresAt: event.payload.expiresAt, status: 'ACTIVE' } : null);
          }
        } else if (event.type === 'SUBMISSION_REVIEWED') {
          if (currentSession?.joinCode) {
            fetchSubmissions(currentSession.joinCode);
          }
          if (typeof event.payload?.correctCount === 'number' && typeof event.payload?.incorrectCount === 'number') {
            setCurrentActivity((prev) => prev ? {
              ...prev,
              correctCount: event.payload.correctCount,
              incorrectCount: event.payload.incorrectCount
            } : null);
          }
        } else if (event.type === 'ACTIVITY_PUBLISHED') {
          if (currentSession?.joinCode) {
            fetchSubmissions(currentSession.joinCode);
          }
          setCurrentActivity((prev) => prev ? {
            ...prev,
            status: 'PUBLISHED',
            isPublished: true,
            referenceAnswer: event.payload?.referenceAnswer || prev.referenceAnswer,
            totalSubmissions: event.payload?.totalSubmissions ?? prev.totalSubmissions,
            correctCount: event.payload?.correctCount ?? prev.correctCount,
            incorrectCount: event.payload?.incorrectCount ?? prev.incorrectCount
          } : null);
        }
      } catch {
        // Ignore
      }
    });

    return () => {
      sse.close();
      eventSourceRef.current = null;
    };
  }, [currentSession?.joinCode, fetchSubmissions]);

  // Countdown Timer
  useEffect(() => {
    if (!currentActivity?.expiresAt || currentActivity.status !== 'ACTIVE') {
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(currentActivity.expiresAt!).getTime();
      const diff = Math.max(0, Math.floor((end - now) / 1000));
      setSecondsRemaining(diff);

      if (diff <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentActivity?.expiresAt, currentActivity?.status]);

  // Keyboard navigation in review modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (reviewIndex === null) return;
      if (e.key === 'ArrowRight') {
        setReviewIndex(prev => prev !== null && prev < submissions.length - 1 ? prev + 1 : prev);
      } else if (e.key === 'ArrowLeft') {
        setReviewIndex(prev => prev !== null && prev > 0 ? prev - 1 : prev);
      } else if (e.key === 'Escape') {
        setReviewIndex(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reviewIndex, submissions.length]);

  // Action: Create Session and Activity
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionTitle.trim() || !questionPrompt.trim()) return;

    setActionLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/classroom/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: sessionTitle.trim(),
          questionPrompt: questionPrompt.trim(),
          referenceAnswer: referenceAnswer.trim() || undefined,
          timeLimit
        })
      });

      const data = await res.json();
      if (data.success && data.data) {
        setSuccessMessage('Classroom activity created successfully!');
        setCurrentSession(data.data.session);
        setCurrentActivity(data.data.activity);
        setShowCreateModal(false);
        setSubmissions([]);
        setSessions((prev) => [data.data.session, ...prev]);
      } else {
        setErrorMessage(data.message || 'Failed to create classroom session');
      }
    } catch {
      setErrorMessage('Network error while creating session');
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Close Submissions Manually
  const handleCloseSubmissions = async () => {
    if (!currentSession?.joinCode) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/classroom/sessions/${currentSession.joinCode}/close`, {
        method: 'PATCH'
      });
      const data = await res.json();
      if (data.success) {
        setCurrentActivity((prev) => prev ? { ...prev, status: 'CLOSED' } : null);
        setSuccessMessage('Submissions closed for review');
      } else {
        setErrorMessage(data.message || 'Failed to close submissions');
      }
    } catch {
      setErrorMessage('Network error');
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Extend Timer (+60s)
  const handleExtendTimer = async (seconds = 60) => {
    if (!currentSession?.joinCode) return;
    try {
      const res = await fetch(`/api/classroom/sessions/${currentSession.joinCode}/extend`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additionalSeconds: seconds })
      });
      const data = await res.json();
      if (data.success && data.data?.expiresAt) {
        setCurrentActivity((prev) => prev ? { ...prev, expiresAt: data.data.expiresAt, status: 'ACTIVE' } : null);
        setSuccessMessage(`Timer extended by ${seconds}s`);
      }
    } catch {
      // Ignore
    }
  };

  // Action: Publish Results
  const handlePublishResults = async () => {
    if (!currentSession?.joinCode) return;
    setActionLoading(true);
    setErrorMessage('');

    try {
      const res = await fetch(`/api/classroom/sessions/${currentSession.joinCode}/publish`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success && data.data) {
        setCurrentActivity((prev) => prev ? {
          ...prev,
          status: 'PUBLISHED',
          isPublished: true,
          referenceAnswer: data.data.referenceAnswer,
          totalSubmissions: data.data.totalSubmissions,
          correctCount: data.data.correctCount,
          incorrectCount: data.data.incorrectCount
        } : null);
        setSuccessMessage('Results and reference answer published to all students!');
      } else {
        setErrorMessage(data.message || 'Failed to publish results');
      }
    } catch {
      setErrorMessage('Network error while publishing results');
    } finally {
      setActionLoading(false);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Full-Screen Presenter / Projector Mode
  if (presenterMode && currentSession && currentActivity) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col p-6 sm:p-10 select-none overflow-y-auto">
        {/* Presenter Top Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-5">
          <div className="flex items-center gap-4">
            <span className="px-3 py-1 bg-blue-600 font-bold rounded-lg text-xs uppercase tracking-wider">
              Presenter Mode
            </span>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">{currentSession.title}</h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setPresenterMode(false)}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-2 text-xs font-semibold"
            >
              <Minimize2 className="w-4 h-4" />
              <span>Exit Presenter</span>
            </button>
          </div>
        </div>

        {/* Presenter Main Content */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-6">
          {/* Left: Join Info & QR Code */}
          <div className="lg:col-span-4 flex flex-col items-center justify-center p-6 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl text-center">
            <span className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-2">Scan with Phone Camera</span>
            
            {/* Scannable QR Code */}
            {currentSession.qrCodeSvg && (
              <div
                className="bg-white p-4 rounded-2xl shadow-inner mb-4 flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: currentSession.qrCodeSvg }}
              />
            )}

            <div className="mt-1">
              <span className="text-xs text-slate-400 block mb-1">Or enter join code:</span>
              <span className="text-4xl font-extrabold tracking-widest font-mono text-blue-400 bg-slate-950 px-5 py-2 rounded-xl border border-blue-500/40 inline-block shadow-inner">
                {currentSession.joinCode}
              </span>
            </div>

            <div className="mt-4 flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                <Users className="w-4 h-4 text-blue-400" />
                {currentSession.participantCount} Joined
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                {currentActivity.totalSubmissions} Submitted
              </span>
            </div>
          </div>

          {/* Right: Question Prompt, Timer, & Live Stats */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            {/* Status and Timer */}
            <div className="flex items-center justify-between">
              <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border ${
                currentActivity.status === 'ACTIVE'
                  ? 'bg-blue-950/80 border-blue-700 text-blue-300'
                  : currentActivity.status === 'PUBLISHED'
                  ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                  : 'bg-amber-950/80 border-amber-700 text-amber-300'
              }`}>
                {currentActivity.status === 'ACTIVE' ? 'Submissions Open' : currentActivity.status === 'PUBLISHED' ? 'Results Published' : 'Submissions Closed'}
              </span>

              {secondsRemaining !== null && currentActivity.status === 'ACTIVE' && (
                <div className={`flex items-center gap-2 px-5 py-2 rounded-2xl text-2xl font-black font-mono border ${
                  secondsRemaining < 30
                    ? 'bg-red-950 border-red-700 text-red-300 animate-pulse'
                    : 'bg-slate-900 border-slate-800 text-slate-200'
                }`}>
                  <Clock className="w-6 h-6" />
                  <span>{formatTimer(secondsRemaining)}</span>
                </div>
              )}
            </div>

            {/* Question Text */}
            <div className="bg-slate-900/90 border border-slate-800 p-8 rounded-3xl shadow-xl">
              <span className="text-xs uppercase tracking-widest text-blue-400 font-bold block mb-2">Classroom Question</span>
              <h2 className="text-2xl sm:text-3xl font-bold text-white leading-relaxed">
                {currentActivity.questionPrompt}
              </h2>
            </div>

            {/* Published Results View */}
            {currentActivity.isPublished && (
              <div className="bg-emerald-950/40 border border-emerald-700/60 p-6 rounded-3xl shadow-2xl flex flex-col gap-4">
                <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Reference Solution</span>
                <p className="text-lg text-emerald-100 font-medium whitespace-pre-wrap leading-relaxed">
                  {currentActivity.referenceAnswer || 'Correct solution demonstrated by professor.'}
                </p>

                <div className="grid grid-cols-3 gap-4 pt-2">
                  <div className="bg-slate-900/80 p-4 rounded-2xl text-center border border-slate-800">
                    <span className="text-xs text-slate-400 block">Total Answers</span>
                    <span className="text-3xl font-extrabold text-white">{currentActivity.totalSubmissions}</span>
                  </div>
                  <div className="bg-emerald-900/40 p-4 rounded-2xl text-center border border-emerald-800/60">
                    <span className="text-xs text-emerald-400 block">Correct Answers</span>
                    <span className="text-3xl font-extrabold text-emerald-300">{currentActivity.correctCount}</span>
                  </div>
                  <div className="bg-red-900/40 p-4 rounded-2xl text-center border border-red-800/60">
                    <span className="text-xs text-red-400 block">Incorrect Answers</span>
                    <span className="text-3xl font-extrabold text-red-300">{currentActivity.incorrectCount}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout
      title="Classroom Activity"
      description="Live handwritten question sessions with QR codes, rapid review, and instant results."
    >
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto flex flex-col gap-6">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                Independent MVP
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Classroom Activity</h1>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Live handwritten question sessions with QR codes, rapid review, and instant results.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create Activity</span>
            </Button>
          </div>
        </div>

        {/* Notifications */}
        {errorMessage && (
          <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage('')} className="p-1 hover:bg-red-200/50 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-700 dark:text-emerald-300 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage('')} className="p-1 hover:bg-emerald-200/50 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Active Session View */}
        {currentSession && currentActivity ? (
          <div className="flex flex-col gap-6">
            {/* Session Controller Header */}
            <Card className="p-5 sm:p-6 border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">{currentSession.title}</h2>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      currentActivity.status === 'ACTIVE'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                        : currentActivity.status === 'PUBLISHED'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                    }`}>
                      {currentActivity.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span>Join Code: <strong className="font-mono text-blue-600 dark:text-blue-400 text-sm">{currentSession.joinCode}</strong></span>
                    <span>&bull;</span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      {currentSession.participantCount} Joined
                    </span>
                    <span>&bull;</span>
                    <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      {submissions.length} Submissions
                    </span>
                  </div>
                </div>

                {/* Top Action Buttons */}
                <div className="flex items-center flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowQrModal(true)}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <QrCode className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                    <span>Show QR</span>
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPresenterMode(true)}
                    className="flex items-center gap-1.5 text-xs bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-800"
                  >
                    <Tv className="w-4 h-4 text-blue-400" />
                    <span>Presenter View</span>
                  </Button>

                  {currentActivity.status === 'ACTIVE' && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExtendTimer(60)}
                        className="flex items-center gap-1 text-xs"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>+1 Min</span>
                      </Button>

                      <Button
                        size="sm"
                        onClick={handleCloseSubmissions}
                        disabled={actionLoading}
                        className="bg-amber-600 hover:bg-amber-500 text-white text-xs"
                      >
                        Close Submissions
                      </Button>
                    </>
                  )}

                  {currentActivity.status === 'CLOSED' && !currentActivity.isPublished && (
                    <Button
                      size="sm"
                      onClick={handlePublishResults}
                      disabled={actionLoading}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs flex items-center gap-1.5 font-bold"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Publish Results</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Question & Live Timer Bar */}
              <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-xs uppercase tracking-wider text-slate-400 font-bold block mb-1">Current Question</span>
                  <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{currentActivity.questionPrompt}</p>
                </div>

                {secondsRemaining !== null && currentActivity.status === 'ACTIVE' && (
                  <div className={`px-4 py-2 rounded-xl text-lg font-black font-mono border flex items-center gap-2 self-start md:self-center shrink-0 ${
                    secondsRemaining < 30
                      ? 'bg-red-50 border-red-300 text-red-600 dark:bg-red-950/60 dark:border-red-800 dark:text-red-300 animate-pulse'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                  }`}>
                    <Clock className="w-5 h-5 text-slate-500" />
                    <span>{formatTimer(secondsRemaining)}</span>
                  </div>
                )}
              </div>

              {/* Published Results Summary Bar */}
              {currentActivity.isPublished && (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-xs uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Published Reference Answer & Aggregate Stats</span>
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-200 font-medium">
                    {currentActivity.referenceAnswer || 'Reference solution recorded.'}
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-center pt-1">
                    <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-xs text-slate-500 block">Total</span>
                      <span className="text-lg font-bold text-slate-900 dark:text-white">{currentActivity.totalSubmissions}</span>
                    </div>
                    <div className="bg-emerald-100/60 dark:bg-emerald-900/30 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                      <span className="text-xs text-emerald-700 dark:text-emerald-400 block">Correct</span>
                      <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{currentActivity.correctCount}</span>
                    </div>
                    <div className="bg-red-100/60 dark:bg-red-900/30 p-2.5 rounded-lg border border-red-200 dark:border-red-800">
                      <span className="text-xs text-red-700 dark:text-red-400 block">Incorrect</span>
                      <span className="text-lg font-bold text-red-700 dark:text-red-300">{currentActivity.incorrectCount}</span>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Live Submissions Gallery & Review Feed */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-blue-500" />
                  <span>Student Submissions ({submissions.length})</span>
                </h3>

                {submissions.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReviewIndex(0);
                    }}
                    className="text-xs font-semibold"
                  >
                    Inspect Submissions
                  </Button>
                )}
              </div>

              {submissions.length === 0 ? (
                <Card className="p-12 text-center border-dashed border-slate-300 dark:border-slate-800">
                  <Clock className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600 mb-3 animate-pulse" />
                  <h4 className="text-base font-semibold text-slate-700 dark:text-slate-300">Waiting for handwritten submissions...</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-500 mt-1 max-w-sm mx-auto">
                    Students can scan the QR code or enter code <strong className="font-mono text-blue-600">{currentSession.joinCode}</strong> to upload their answers.
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {submissions.map((sub, idx) => (
                    <div
                      key={sub._id || idx}
                      onClick={() => setReviewIndex(idx)}
                      className={`group relative rounded-2xl border bg-white dark:bg-slate-900 overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer ${
                        sub.isCorrect === true
                          ? 'border-emerald-500/80 ring-2 ring-emerald-500/20'
                          : sub.isCorrect === false
                          ? 'border-red-500/80 ring-2 ring-red-500/20'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {/* Image Thumbnail */}
                      <div className="relative aspect-4/3 bg-slate-950 flex items-center justify-center overflow-hidden">
                        <img
                          src={`/api/classroom/image?submissionId=${sub.id || sub._id}&path=${encodeURIComponent(sub.imagePath || '')}`}
                          alt={`Submission by ${sub.studentName}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          loading="lazy"
                        />

                        {/* Automated Verification Status Badge */}
                        <div className="absolute top-2 right-2">
                          {sub.isCorrect === true ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white shadow-md flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Correct</span>
                            </span>
                          ) : sub.isCorrect === false ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white shadow-md flex items-center gap-1">
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Incorrect</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-900/80 text-slate-300 backdrop-blur-sm border border-slate-700">
                              Submitted
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Meta */}
                      <div className="p-3 flex items-center justify-between">
                        <div className="truncate">
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate block">
                            {sub.studentName}
                          </span>
                          {sub.textResponse && (
                            <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate block">
                              &ldquo;{sub.textResponse}&rdquo;
                            </span>
                          )}
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">
                            {new Date(sub.submittedAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <Card className="p-12 text-center border-dashed border-slate-300 dark:border-slate-800">
            <Sparkles className="w-12 h-12 mx-auto text-blue-500 mb-4" />
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">No active classroom session</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 mb-6">
              Launch a live activity to display a QR code for students to upload handwritten answers in class.
            </p>
            <Button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Activity</span>
            </Button>
          </Card>
        )}

        {/* Modal: Create Activity */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create Classroom Activity</h3>
                </div>
                <button onClick={() => setShowCreateModal(false)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <form onSubmit={handleCreateSession} className="space-y-4 mt-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                    Session Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={sessionTitle}
                    onChange={(e) => setSessionTitle(e.target.value)}
                    placeholder="e.g. Lecture 8: AVL Tree Rotations"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                    Question Prompt (Displayed to Students) *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={questionPrompt}
                    onChange={(e) => setQuestionPrompt(e.target.value)}
                    placeholder="e.g. Insert key 45 into the AVL tree shown and sketch the resulting tree after balancing."
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                    Reference Answer (Revealed upon publication)
                  </label>
                  <textarea
                    rows={2}
                    value={referenceAnswer}
                    onChange={(e) => setReferenceAnswer(e.target.value)}
                    placeholder="e.g. Root 30, Left child 20, Right child 45 after right-left rotation."
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                    Time Limit
                  </label>
                  <select
                    value={timeLimit}
                    onChange={(e) => setTimeLimit(parseInt(e.target.value, 10))}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value={60}>1 Minute (Quick check)</option>
                    <option value={120}>2 Minutes</option>
                    <option value={180}>3 Minutes (Standard)</option>
                    <option value={300}>5 Minutes</option>
                    <option value={600}>10 Minutes</option>
                    <option value={0}>Untimed (Manual close)</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={actionLoading || !sessionTitle.trim() || !questionPrompt.trim()}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5"
                  >
                    {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    <span>Launch Activity & QR</span>
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: QR Code Enlarge */}
        {showQrModal && currentSession && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl">
              <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Student Join Code</h4>
              <p className="text-xs text-slate-500 mb-4">Scan with mobile camera to submit answer</p>

              {currentSession.qrCodeSvg && (
                <div
                  className="bg-white p-4 rounded-2xl border shadow-inner flex items-center justify-center mx-auto"
                  dangerouslySetInnerHTML={{ __html: currentSession.qrCodeSvg }}
                />
              )}

              <div className="mt-4">
                <span className="text-3xl font-extrabold font-mono text-blue-600 tracking-widest bg-blue-50 dark:bg-slate-800 px-4 py-1.5 rounded-xl border border-blue-200 dark:border-blue-900">
                  {currentSession.joinCode}
                </span>
              </div>

              <div className="mt-6 flex justify-center">
                <Button variant="outline" onClick={() => setShowQrModal(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Submission Inspector */}
        {reviewIndex !== null && submissions[reviewIndex] && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
            <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-4xl w-full h-[90vh] flex flex-col overflow-hidden shadow-2xl text-white">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="text-xs text-slate-300 font-medium">Submission ({reviewIndex + 1} of {submissions.length})</span>
                    <h3 className="text-base font-bold text-white truncate">{submissions[reviewIndex].studentName}</h3>
                  </div>

                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                    submissions[reviewIndex].isCorrect === true
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      : submissions[reviewIndex].isCorrect === false
                      ? 'bg-red-950 text-red-300 border-red-700'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}>
                    {submissions[reviewIndex].isCorrect === true
                      ? '✓ Verified Correct'
                      : submissions[reviewIndex].isCorrect === false
                      ? '✗ Verified Incorrect'
                      : 'Pending'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setReviewIndex(null)}
                    className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-300 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Automated Comparison Banner */}
              <div className="px-5 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                {submissions[reviewIndex].textResponse && (
                  <div>
                    <span className="text-slate-400 font-semibold">Student Answer: </span>
                    <strong className="text-slate-100 font-mono">{submissions[reviewIndex].textResponse}</strong>
                  </div>
                )}
                {currentActivity?.referenceAnswer && (
                  <div>
                    <span className="text-slate-400 font-semibold">Reference Solution: </span>
                    <strong className="text-emerald-300 font-mono">{currentActivity.referenceAnswer}</strong>
                  </div>
                )}
              </div>

              {/* Image Canvas Container */}
              <div className="flex-1 bg-black/90 p-4 flex items-center justify-center overflow-auto relative">
                <img
                  src={`/api/classroom/image?submissionId=${submissions[reviewIndex].id || submissions[reviewIndex]._id}&path=${encodeURIComponent(submissions[reviewIndex].imagePath || '')}`}
                  alt={`Submission by ${submissions[reviewIndex].studentName}`}
                  className="max-h-full max-w-full object-contain rounded-lg"
                />
              </div>

              {/* Navigation Footer */}
              <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reviewIndex <= 0}
                  onClick={() => setReviewIndex(prev => prev !== null && prev > 0 ? prev - 1 : prev)}
                  className="text-xs font-semibold"
                >
                  &larr; Previous Submission
                </Button>

                <div className="text-xs text-slate-300 font-medium hidden sm:block">
                  Automated answer verification active &bull; Arrow keys &larr; / &rarr; to navigate
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={reviewIndex >= submissions.length - 1}
                  onClick={() => setReviewIndex(prev => prev !== null && prev < submissions.length - 1 ? prev + 1 : prev)}
                  className="text-xs font-semibold"
                >
                  Next Submission &rarr;
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
