/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Camera,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  Sparkles,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

interface ActiveActivity {
  id: string;
  title: string;
  questionPrompt: string;
  timeLimit: number;
  expiresAt: string | null;
  status: string;
  isPublished?: boolean;
  referenceAnswer?: string | null;
}

interface PublishedResults {
  activityId: string;
  title: string;
  questionPrompt: string;
  referenceAnswer: string;
  totalSubmissions: number;
  correctCount: number;
  incorrectCount: number;
  successRate: number;
}

interface MySubmission {
  id: string;
  studentName: string;
  imagePath: string;
  status: string;
  isCorrect: boolean | null;
  score?: number | null;
  feedback?: string | null;
  textResponse?: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}

export default function MobileStudentClassroomSessionPage() {
  const params = useParams();
  const sessionCode = (params?.code as string || '').toUpperCase();

  const [participantToken, setParticipantToken] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(`cr_token_${sessionCode}`) || '';
  });
  const [participantName, setParticipantName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(`cr_name_${sessionCode}`) || '';
  });
  const [participantId, setParticipantId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(`cr_pid_${sessionCode}`) || '';
  });
  const [joined, setJoined] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!(localStorage.getItem(`cr_token_${sessionCode}`) && localStorage.getItem(`cr_name_${sessionCode}`));
  });

  const [sessionTitle, setSessionTitle] = useState('');
  const [activity, setActivity] = useState<ActiveActivity | null>(null);
  const [publishedResults, setPublishedResults] = useState<PublishedResults | null>(null);
  const [mySubmission, setMySubmission] = useState<MySubmission | null>(null);

  // File upload & answer state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Timer state
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch session data
  const fetchSessionData = useCallback(async () => {
    if (!sessionCode) return;
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionCode}`);
      const data = await res.json();
      if (data.success && data.data) {
        setSessionTitle(data.data.session.title);
        setActivity(data.data.activeActivity);
      } else {
        setError(data.message || 'Session not found');
      }
    } catch {
      setError('Failed to connect to session server');
    } finally {
      setLoading(false);
    }
  }, [sessionCode]);

  // Fetch my submission status
  const fetchMySubmission = useCallback(async () => {
    if (!sessionCode || !participantToken) return;
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionCode}/my-submission`, {
        headers: { 'x-participant-token': participantToken }
      });
      const data = await res.json();
      if (data.success && data.data) {
        setMySubmission(data.data);
      }
    } catch {
      // Ignore
    }
  }, [sessionCode, participantToken]);

  // Fetch published results
  const fetchResults = useCallback(async () => {
    if (!sessionCode) return;
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionCode}/results`);
      const data = await res.json();
      if (data.success && data.data) {
        setPublishedResults(data.data);
      }
    } catch {
      // Not yet published
    }
  }, [sessionCode]);

  // Initial load
  useEffect(() => {
    let active = true;
    const loadSession = async () => {
      if (!sessionCode) return;
      try {
        const res = await fetch(`/api/classroom/sessions/${sessionCode}`);
        const data = await res.json();
        if (!active) return;
        if (data.success && data.data) {
          setSessionTitle(data.data.session.title);
          setActivity(data.data.activeActivity);
        } else {
          setError(data.message || 'Session not found');
        }
      } catch {
        if (active) setError('Failed to connect to session server');
      } finally {
        if (active) setLoading(false);
      }
    };
    loadSession();
    return () => { active = false; };
  }, [sessionCode]);

  useEffect(() => {
    if (!joined || !participantToken || !sessionCode) return;
    let active = true;
    const loadSub = async () => {
      try {
        const res = await fetch(`/api/classroom/sessions/${sessionCode}/my-submission`, {
          headers: { 'x-participant-token': participantToken }
        });
        const data = await res.json();
        if (active && data.success && data.data) {
          setMySubmission(data.data);
        }
      } catch {
        // Ignore
      }
    };
    loadSub();
    return () => { active = false; };
  }, [joined, participantToken, sessionCode]);

  // SSE Realtime stream
  useEffect(() => {
    if (!sessionCode) return;

    const sseUrl = participantToken
      ? `/api/classroom/sessions/${sessionCode}/stream?token=${encodeURIComponent(participantToken)}`
      : `/api/classroom/sessions/${sessionCode}/stream`;

    const sse = new EventSource(sseUrl);
    eventSourceRef.current = sse;

    sse.addEventListener('initial', (e) => {
      try {
        const snap = JSON.parse(e.data);
        if (snap.activity) {
          setActivity(snap.activity);
          if (snap.activity.isPublished) {
            fetchResults();
          }
        }
      } catch {
        // Ignore parse error
      }
    });

    sse.addEventListener('classroom_event', (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.type === 'ACTIVITY_STARTED' || parsed.type === 'QUESTION_ACTIVATED') {
          fetchSessionData();
          setMySubmission(null);
          setSelectedFile(null);
          setPreviewUrl(null);
          setAnswerText('');
          setPublishedResults(null);
        } else if (parsed.type === 'TIMER_EXTENDED') {
          if (parsed.payload?.expiresAt) {
            setActivity((prev) => prev ? { ...prev, expiresAt: parsed.payload.expiresAt } : null);
          }
        } else if (parsed.type === 'ACTIVITY_CLOSED' || parsed.type === 'QUESTION_CLOSED') {
          setActivity((prev) => prev ? { ...prev, status: 'CLOSED' } : null);
        } else if (parsed.type === 'SUBMISSION_REVIEWED') {
          fetchMySubmission();
        } else if (parsed.type === 'ACTIVITY_PUBLISHED') {
          fetchSessionData();
          fetchResults();
          fetchMySubmission();
        }
      } catch {
        // Ignore
      }
    });

    return () => {
      sse.close();
      eventSourceRef.current = null;
    };
  }, [sessionCode, participantToken, fetchSessionData, fetchResults, fetchMySubmission]);

  // Timer countdown calculation
  useEffect(() => {
    if (!activity?.expiresAt || activity.status !== 'ACTIVE') {
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(activity.expiresAt!).getTime();
      const diffSeconds = Math.max(0, Math.floor((end - now) / 1000));
      setTimeLeft(diffSeconds);

      if (diffSeconds <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activity?.expiresAt, activity?.status]);

  // Join handler
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!participantName.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/classroom/sessions/${sessionCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: participantName.trim() })
      });

      const data = await res.json();
      if (data.success && data.data) {
        const token = data.data.participant.token;
        const pId = data.data.participant.id;
        const name = data.data.participant.name;

        setParticipantToken(token);
        setParticipantId(pId);
        setParticipantName(name);
        setJoined(true);

        localStorage.setItem(`cr_token_${sessionCode}`, token);
        localStorage.setItem(`cr_name_${sessionCode}`, name);
        localStorage.setItem(`cr_pid_${sessionCode}`, pId);

        if (data.data.activeActivity) {
          setActivity(data.data.activeActivity);
        }
      } else {
        setError(data.message || 'Failed to join session');
      }
    } catch {
      setError('Network error while joining session');
    } finally {
      setLoading(false);
    }
  };

  // Image Selection Handler
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Image size must be under 10MB');
      return;
    }

    setUploadError('');
    setSelectedFile(file);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  // Submission Handler
  const handleSubmit = async () => {
    if (!selectedFile || !participantToken) return;

    setUploading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('participantId', participantId);
      formData.append('studentName', participantName);
      if (answerText.trim()) {
        formData.append('answerText', answerText.trim());
      }

      const res = await fetch(`/api/classroom/sessions/${sessionCode}/submit`, {
        method: 'POST',
        headers: {
          'x-participant-token': participantToken
        },
        body: formData
      });

      const data = await res.json();
      if (data.success && data.data) {
        setMySubmission(data.data);
      } else {
        setUploadError(data.message || 'Failed to upload answer image');
      }
    } catch {
      setUploadError('Network error while submitting answer');
    } finally {
      setUploading(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Join Screen
  if (!joined) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center px-4 py-8">
        <div className="max-w-md w-full mx-auto bg-slate-900 border-2 border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-600/20 text-blue-400 mb-3 border-2 border-blue-500/40">
              <Sparkles className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Join Classroom Session</h1>
            <p className="text-sm text-slate-300 mt-1">Code: <span className="font-mono font-bold text-blue-300 tracking-wider text-base">{sessionCode}</span></p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-950/80 border-2 border-red-700 rounded-xl text-red-200 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-200 mb-1.5">
                Your Full Name or Roll Number
              </label>
              <input
                type="text"
                required
                value={participantName}
                onChange={(e) => setParticipantName(e.target.value)}
                placeholder="e.g. 20261042 - Aarathi Sree"
                className="w-full px-4 py-3 bg-slate-950 border-2 border-slate-600 rounded-xl text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-400 text-base font-medium"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading || !participantName.trim()}
              className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer text-base"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Join Activity
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-400 font-medium">
            IIIT Hyderabad Classroom Assessment Platform
          </div>
        </div>
      </div>
    );
  }

  // Active Session / Activity Screen
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 sticky top-0 z-30 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-400">Classroom Activity</span>
          <h2 className="text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-xs">{sessionTitle || `Session ${sessionCode}`}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className="text-[11px] text-slate-300 font-semibold block">Participant</span>
            <span className="text-xs font-bold text-white truncate max-w-[120px] block">{participantName}</span>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-2xl w-full mx-auto p-4 flex flex-col gap-5">
        {/* Activity Card */}
        {activity ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-blue-900 text-blue-200 border border-blue-600">
                {activity.status === 'ACTIVE' ? 'Active Question' : activity.status === 'PUBLISHED' ? 'Results Published' : 'Submissions Closed'}
              </span>

              {timeLeft !== null && activity.status === 'ACTIVE' && (
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border-2 ${
                  timeLeft < 30 ? 'bg-red-950 border-red-700 text-red-200 animate-pulse' : 'bg-slate-800 border-slate-600 text-slate-100'
                }`}>
                  <Clock className="w-3.5 h-3.5" />
                  <span>{formatTimer(timeLeft)}</span>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-lg font-bold text-white mb-2">{activity.title}</h3>
              <p className="text-base text-slate-100 whitespace-pre-wrap leading-relaxed">{activity.questionPrompt}</p>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-300">
            <Clock className="w-10 h-10 mx-auto mb-3 text-slate-400 animate-pulse" />
            <h3 className="text-base font-bold text-slate-200">Waiting for next activity...</h3>
            <p className="text-xs text-slate-400 mt-1">The professor will activate a question shortly.</p>
          </div>
        )}

        {/* Published Results View */}
        {publishedResults && (
          <div className="bg-slate-900 border-2 border-emerald-700 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>Results & Reference Answer</span>
            </div>

            {/* Student's Personal Outcome */}
            {mySubmission && (
              <div className={`p-4 rounded-xl border-2 flex items-center gap-3 ${
                mySubmission.isCorrect === true
                  ? 'bg-emerald-950/80 border-emerald-600 text-emerald-100'
                  : mySubmission.isCorrect === false
                  ? 'bg-red-950/80 border-red-600 text-red-100'
                  : 'bg-amber-950/80 border-amber-600 text-amber-100'
              }`}>
                {mySubmission.isCorrect === true ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                ) : mySubmission.isCorrect === false ? (
                  <XCircle className="w-6 h-6 text-red-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-6 h-6 text-amber-400 shrink-0" />
                )}
                <div>
                  <span className="text-xs uppercase tracking-wider font-bold block text-slate-300">Your Answer Evaluation</span>
                  <span className="text-base font-bold">
                    {mySubmission.isCorrect === true
                      ? 'Marked Correct ✓'
                      : mySubmission.isCorrect === false
                      ? 'Marked Incorrect ✗'
                      : 'Unable to Verify (Pending Review)'}
                  </span>
                </div>
              </div>
            )}

            {/* Reference Solution */}
            <div className="p-4 bg-slate-950 border border-slate-700 rounded-xl">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 block mb-1">
                Reference Solution
              </span>
              <p className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed font-semibold">
                {publishedResults.referenceAnswer || 'Correct solution demonstrated by professor.'}
              </p>
            </div>

            {/* Aggregate Class Statistics */}
            <div className="grid grid-cols-3 gap-2 text-center pt-2">
              <div className="bg-slate-800/90 border border-slate-700 p-3 rounded-xl">
                <span className="text-xs text-slate-300 font-semibold block">Class Total</span>
                <span className="text-lg font-bold text-white">{publishedResults.totalSubmissions}</span>
              </div>
              <div className="bg-emerald-950/80 border border-emerald-700 p-3 rounded-xl">
                <span className="text-xs text-emerald-300 font-semibold block">Correct</span>
                <span className="text-lg font-bold text-emerald-200">{publishedResults.correctCount}</span>
              </div>
              <div className="bg-red-950/80 border border-red-700 p-3 rounded-xl">
                <span className="text-xs text-red-300 font-semibold block">Incorrect</span>
                <span className="text-lg font-bold text-red-200">{publishedResults.incorrectCount}</span>
              </div>
            </div>
          </div>
        )}

        {/* Instant Automated Verification Status (shown whenever student has submitted) */}
        {mySubmission && !publishedResults && (
          <div className="bg-slate-900 border-2 border-slate-700 rounded-2xl p-5 shadow-xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Your Answer Verification
              </span>
              <span className="text-xs text-slate-300 font-medium">
                {new Date(mySubmission.submittedAt).toLocaleTimeString()}
              </span>
            </div>

            {mySubmission.isCorrect === true ? (
              <div className="p-4 bg-emerald-950/90 border-2 border-emerald-600 rounded-xl flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-base font-bold text-emerald-300">
                    ✓ Verified Correct
                  </div>
                  <p className="text-xs text-emerald-100 mt-1 leading-relaxed font-medium">
                    {mySubmission.feedback || 'Your answer matches the professor\'s reference solution!'}
                  </p>
                </div>
              </div>
            ) : mySubmission.isCorrect === false ? (
              <div className="p-4 bg-red-950/90 border-2 border-red-600 rounded-xl flex items-start gap-3">
                <XCircle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-base font-bold text-red-300">
                    ✗ Verified Incorrect
                  </div>
                  <p className="text-xs text-red-100 mt-1 leading-relaxed font-medium">
                    {mySubmission.feedback || 'Your answer does not match the professor\'s reference solution.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-amber-950/90 border-2 border-amber-600 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-base font-bold text-amber-300">
                    Unable to Verify
                  </div>
                  <p className="text-xs text-amber-100 mt-1 leading-relaxed font-medium">
                    {mySubmission.feedback || 'Handwriting extraction was uncertain. Your answer is recorded for professor review.'}
                  </p>
                </div>
              </div>
            )}

            {mySubmission.textResponse ? (
              <div className="p-3 bg-slate-950 border border-slate-700 rounded-xl text-xs flex flex-col gap-1">
                <span className="text-slate-300 font-bold">Extracted Handwritten Answer:</span>
                <span className="text-white font-mono font-bold text-sm whitespace-pre-wrap">{mySubmission.textResponse}</span>
              </div>
            ) : (
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-xs flex flex-col gap-1 text-slate-300">
                <span className="font-semibold italic">Handwritten answer image recorded</span>
              </div>
            )}

            {mySubmission.imagePath && (
              <div className="flex items-center gap-3 pt-1">
                <img
                  src={`/api/classroom/image?submissionId=${mySubmission.id}&path=${encodeURIComponent(mySubmission.imagePath)}&token=${encodeURIComponent(participantToken)}`}
                  alt="Uploaded answer paper"
                  className="w-16 h-16 object-cover rounded-lg border-2 border-slate-700 bg-black"
                />
                <div className="flex-1">
                  <span className="text-xs text-slate-200 block font-semibold">Uploaded Handwritten Paper</span>
                  <a
                    href={`/api/classroom/image?submissionId=${mySubmission.id}&path=${encodeURIComponent(mySubmission.imagePath)}&token=${encodeURIComponent(participantToken)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 underline font-bold mt-0.5 inline-block"
                  >
                    View Full Image ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Submission / Photo Upload Section */}
        {activity && activity.status !== 'PUBLISHED' && (
          <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-400" />
                <span>{mySubmission ? 'Resubmit Answer' : 'Submit Your Answer'}</span>
              </h4>
              {mySubmission && (
                <span className="text-xs text-emerald-400 font-bold">Already Submitted (Can Update)</span>
              )}
            </div>

            {uploadError && (
              <div className="p-3 bg-red-950/80 border-2 border-red-700 rounded-xl text-red-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Answer Text Value Input */}
            <div>
              <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider mb-1.5">
                Answer / Final Value <span className="text-slate-300 font-normal">(Automatically verified against professor solution)</span>
              </label>
              <input
                type="text"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="e.g. 42, TCP SYN, x = 5, etc."
                disabled={activity.status === 'CLOSED'}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-400 text-sm font-semibold disabled:opacity-50"
              />
            </div>

            {/* Already Submitted Status */}
            {mySubmission && !selectedFile && (
              <div className="p-4 bg-blue-950/60 border-2 border-blue-700 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-blue-400" />
                  <div>
                    <span className="text-xs font-bold text-blue-200 block">Answer Submitted</span>
                    <span className="text-xs text-slate-300 font-medium">
                      {new Date(mySubmission.submittedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={activity.status === 'CLOSED'}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-white border-2 border-slate-600 disabled:opacity-40"
                >
                  Replace Photo
                </button>
              </div>
            )}

            {/* Selected Photo Preview */}
            {previewUrl && (
              <div className="flex flex-col items-center gap-3">
                <div className="relative w-full max-h-72 rounded-xl overflow-hidden border-2 border-slate-600 bg-black flex items-center justify-center">
                  <img
                    src={previewUrl}
                    alt="Handwritten answer preview"
                    className="max-h-72 w-auto object-contain rounded-lg"
                  />
                </div>

                <div className="flex items-center gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null);
                      setPreviewUrl(null);
                    }}
                    className="flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-750 text-white rounded-xl text-xs font-bold border-2 border-slate-600"
                  >
                    Retake Photo
                  </button>

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={uploading || activity.status === 'CLOSED'}
                    className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md"
                  >
                    {uploading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Confirm & Submit
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Capture / Select Photo Buttons */}
            {!previewUrl && (!mySubmission || activity.status === 'ACTIVE') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* Mobile Camera Direct Button */}
                <button
                  type="button"
                  disabled={activity.status === 'CLOSED'}
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.setAttribute('capture', 'environment');
                      fileInputRef.current.click();
                    }
                  }}
                  className="py-4 px-4 bg-blue-900/40 hover:bg-blue-900/60 border-2 border-blue-500/60 rounded-xl text-blue-200 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
                >
                  <Camera className="w-7 h-7 text-blue-300" />
                  <span className="text-xs font-bold">Take Photo of Paper</span>
                </button>

                {/* File Upload Button */}
                <button
                  type="button"
                  disabled={activity.status === 'CLOSED'}
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.removeAttribute('capture');
                      fileInputRef.current.click();
                    }
                  }}
                  className="py-4 px-4 bg-slate-800 hover:bg-slate-750 border-2 border-slate-600 rounded-xl text-white flex flex-col items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
                >
                  <Upload className="w-7 h-7 text-slate-300" />
                  <span className="text-xs font-bold">Choose from Gallery</span>
                </button>

                {/* Hidden File Input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            )}

            {activity.status === 'CLOSED' && !publishedResults && (
              <div className="p-3 bg-amber-950/70 border-2 border-amber-600 rounded-xl text-amber-200 text-xs text-center font-bold">
                Submissions are closed. The professor is reviewing answers.
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-[11px] text-slate-600 border-t border-slate-900">
        Classroom Activity MVP &bull; IIIT Hyderabad
      </footer>
    </div>
  );
}
