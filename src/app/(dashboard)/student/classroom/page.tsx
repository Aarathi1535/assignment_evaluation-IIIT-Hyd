/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  Sparkles,
  RefreshCw,
  AlertCircle,
  ArrowRight
} from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

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
  submittedAt: string;
}

export default function StudentClassroomPage() {
  const [sessionCode, setSessionCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [activity, setActivity] = useState<ActiveActivity | null>(null);
  const [mySubmission, setMySubmission] = useState<MySubmission | null>(null);
  const [publishedResults, setPublishedResults] = useState<PublishedResults | null>(null);

  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Timer state
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch session data
  const fetchSession = useCallback(async (code: string) => {
    if (!code) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/classroom/sessions/${code}`);
      const data = await res.json();
      if (data.success && data.data) {
        setSessionTitle(data.data.session.title);
        setActivity(data.data.activeActivity);
        setJoined(true);
      } else {
        setErrorMessage(data.message || 'Session not found');
      }
    } catch {
      setErrorMessage('Failed to connect to classroom session');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch my submission
  const fetchMySubmission = useCallback(async (code: string) => {
    if (!code) return;
    try {
      const res = await fetch(`/api/classroom/sessions/${code}/my-submission`);
      const data = await res.json();
      if (data.success && data.data) {
        setMySubmission(data.data);
      }
    } catch {
      // Ignore
    }
  }, []);

  // Fetch published results
  const fetchResults = useCallback(async (code: string) => {
    if (!code) return;
    try {
      const res = await fetch(`/api/classroom/sessions/${code}/results`);
      const data = await res.json();
      if (data.success && data.data) {
        setPublishedResults(data.data);
      }
    } catch {
      // Ignore
    }
  }, []);

  // SSE Stream
  useEffect(() => {
    if (!joined || !sessionCode) return;

    const sse = new EventSource(`/api/classroom/sessions/${sessionCode}/stream`);
    eventSourceRef.current = sse;

    sse.addEventListener('initial', (e) => {
      try {
        const snap = JSON.parse(e.data);
        if (snap.activity) {
          setActivity(snap.activity);
          if (snap.activity.isPublished) {
            fetchResults(sessionCode);
          }
        }
      } catch {
        // Ignore
      }
    });

    sse.addEventListener('classroom_event', (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.type === 'ACTIVITY_STARTED' || parsed.type === 'QUESTION_ACTIVATED') {
          fetchSession(sessionCode);
          setMySubmission(null);
          setSelectedFile(null);
          setPreviewUrl(null);
          setPublishedResults(null);
        } else if (parsed.type === 'TIMER_EXTENDED') {
          if (parsed.payload?.expiresAt) {
            setActivity((prev) => prev ? { ...prev, expiresAt: parsed.payload.expiresAt, status: 'ACTIVE' } : null);
          }
        } else if (parsed.type === 'ACTIVITY_CLOSED' || parsed.type === 'QUESTION_CLOSED') {
          setActivity((prev) => prev ? { ...prev, status: 'CLOSED' } : null);
        } else if (parsed.type === 'SUBMISSION_REVIEWED') {
          fetchMySubmission(sessionCode);
        } else if (parsed.type === 'ACTIVITY_PUBLISHED') {
          fetchSession(sessionCode);
          fetchResults(sessionCode);
          fetchMySubmission(sessionCode);
        }
      } catch {
        // Ignore
      }
    });

    return () => {
      sse.close();
      eventSourceRef.current = null;
    };
  }, [joined, sessionCode, fetchSession, fetchResults, fetchMySubmission]);

  // Countdown timer
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

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionCode.trim()) return;
    const code = sessionCode.trim().toUpperCase();

    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/classroom/sessions/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await res.json();
      if (data.success) {
        setSessionCode(code);
        setJoined(true);
        if (data.data.session) {
          setSessionTitle(data.data.session.title);
        }
        if (data.data.activeActivity) {
          setActivity(data.data.activeActivity);
        }
        fetchMySubmission(code);
      } else {
        setErrorMessage(data.message || 'Failed to join session');
      }
    } catch {
      setErrorMessage('Network error while joining session');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file');
      return;
    }

    setUploadError('');
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if (!selectedFile || !sessionCode) return;

    setUploading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch(`/api/classroom/sessions/${sessionCode}/submit`, {
        method: 'POST',
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

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <DashboardLayout
      title="Classroom Activity"
      description="Participate in live class exercises and upload handwritten answers."
    >
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto flex flex-col gap-6">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
            Interactive Classroom
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mt-1">{sessionTitle || 'Classroom Activity'}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Participate in live class exercises and upload handwritten answers.
          </p>
        </div>

        {errorMessage && (
          <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {!joined ? (
          <Card className="p-8 text-center max-w-md mx-auto w-full border-slate-200 dark:border-slate-800">
            <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 mx-auto flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Enter Classroom Join Code</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-6">
              Enter the 6-character code shown on the classroom screen.
            </p>

            <form onSubmit={handleJoin} className="space-y-4">
              <input
                type="text"
                required
                maxLength={6}
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                placeholder="e.g. B7K9X2"
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono text-center tracking-widest text-2xl uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <Button
                type="submit"
                disabled={loading || sessionCode.trim().length < 3}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center justify-center gap-2 py-3"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Join Session</span>}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </form>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {activity ? (
              <Card className="p-6 border-slate-200 dark:border-slate-800 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {activity.status === 'ACTIVE' ? 'Submissions Open' : activity.status === 'PUBLISHED' ? 'Results Published' : 'Submissions Closed'}
                  </span>

                  {timeLeft !== null && activity.status === 'ACTIVE' && (
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                      timeLeft < 30 ? 'bg-red-50 text-red-600 border-red-300 dark:bg-red-950/60 dark:text-red-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}>
                      <Clock className="w-4 h-4" />
                      <span>{formatTimer(timeLeft)}</span>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{activity.title}</h3>
                  <p className="text-base text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{activity.questionPrompt}</p>
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center text-slate-500">
                <Clock className="w-8 h-8 mx-auto mb-2 text-slate-400 animate-pulse" />
                <h4 className="font-semibold">Waiting for professor to activate a question...</h4>
              </Card>
            )}

            {/* Published Results View */}
            {publishedResults && (
              <Card className="p-6 border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 flex flex-col gap-4">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Classroom Results & Reference Answer</span>
                </div>

                {mySubmission && (
                  <div className={`p-4 rounded-xl border flex items-center gap-3 ${
                    mySubmission.isCorrect === true
                      ? 'bg-emerald-100/60 border-emerald-300 dark:bg-emerald-950/60 dark:border-emerald-700'
                      : mySubmission.isCorrect === false
                      ? 'bg-red-100/60 border-red-300 dark:bg-red-950/60 dark:border-red-700'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                  }`}>
                    {mySubmission.isCorrect === true ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                    ) : mySubmission.isCorrect === false ? (
                      <XCircle className="w-6 h-6 text-red-600 shrink-0" />
                    ) : (
                      <Clock className="w-6 h-6 text-slate-500 shrink-0" />
                    )}
                    <div>
                      <span className="text-xs uppercase tracking-wider font-bold block text-slate-500">Your Answer</span>
                      <span className="text-base font-bold text-slate-900 dark:text-white">
                        {mySubmission.isCorrect === true
                          ? 'Marked Correct ✓'
                          : mySubmission.isCorrect === false
                          ? 'Marked Incorrect ✗'
                          : 'Under Review'}
                      </span>
                    </div>
                  </div>
                )}

                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block mb-1">
                    Reference Solution
                  </span>
                  <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
                    {publishedResults.referenceAnswer}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center pt-2">
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                    <span className="text-xs text-slate-500 block">Class Total</span>
                    <span className="text-lg font-bold text-slate-900 dark:text-white">{publishedResults.totalSubmissions}</span>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 block">Correct</span>
                    <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{publishedResults.correctCount}</span>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/30 p-3 rounded-xl border border-red-200 dark:border-red-800">
                    <span className="text-xs text-red-700 dark:text-red-400 block">Incorrect</span>
                    <span className="text-lg font-bold text-red-700 dark:text-red-300">{publishedResults.incorrectCount}</span>
                  </div>
                </div>
              </Card>
            )}

            {/* Handwritten Image Upload Card */}
            {activity && activity.status !== 'PUBLISHED' && (
              <Card className="p-6 border-slate-200 dark:border-slate-800 flex flex-col gap-4">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Upload className="w-4 h-4 text-blue-500" />
                  <span>Upload Handwritten Answer</span>
                </h4>

                {uploadError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {mySubmission && !selectedFile && (
                  <div className="p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                      <div>
                        <span className="text-xs font-bold text-blue-800 dark:text-blue-300 block">Answer Submitted</span>
                        <span className="text-xs text-slate-500">
                          {new Date(mySubmission.submittedAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={activity.status === 'CLOSED'}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Replace Photo
                    </button>
                  </div>
                )}

                {previewUrl && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative w-full max-h-72 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-black flex items-center justify-center">
                      <img
                        src={previewUrl}
                        alt="Handwritten answer preview"
                        className="max-h-72 w-auto object-contain rounded-lg"
                      />
                    </div>

                    <div className="flex items-center gap-2 w-full">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectedFile(null);
                          setPreviewUrl(null);
                        }}
                        className="flex-1 text-xs"
                      >
                        Retake Photo
                      </Button>

                      <Button
                        onClick={handleSubmit}
                        disabled={uploading || activity.status === 'CLOSED'}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                      >
                        {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        <span>Confirm & Submit</span>
                      </Button>
                    </div>
                  </div>
                )}

                {!previewUrl && (!mySubmission || activity.status === 'ACTIVE') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={activity.status === 'CLOSED'}
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.setAttribute('capture', 'environment');
                          fileInputRef.current.click();
                        }
                      }}
                      className="py-4 px-4 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl text-blue-700 dark:text-blue-300 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
                    >
                      <Camera className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                      <span className="text-xs font-bold">Take Photo of Paper</span>
                    </button>

                    <button
                      type="button"
                      disabled={activity.status === 'CLOSED'}
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.removeAttribute('capture');
                          fileInputRef.current.click();
                        }
                      }}
                      className="py-4 px-4 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
                    >
                      <Upload className="w-7 h-7 text-slate-500" />
                      <span className="text-xs font-bold">Upload Image File</span>
                    </button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
