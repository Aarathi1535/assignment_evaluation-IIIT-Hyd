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
  textResponse?: string | null;
  feedback?: string | null;
  status: string;
  isCorrect: boolean | null;
  submittedAt: string;
}

export default function StudentClassroomPage() {
  const [sessionCode, setSessionCode] = useState('');
  const [participantToken, setParticipantToken] = useState('');
  const [joined, setJoined] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [activity, setActivity] = useState<ActiveActivity | null>(null);
  const [mySubmission, setMySubmission] = useState<MySubmission | null>(null);
  const [publishedResults, setPublishedResults] = useState<PublishedResults | null>(null);

  // Form & upload state
  const [answerText, setAnswerText] = useState('');
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
  }, [joined, sessionCode, participantToken, fetchSession, fetchResults, fetchMySubmission]);

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
        if (data.data?.participant?.token) {
          setParticipantToken(data.data.participant.token);
        }
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
      if (answerText.trim()) {
        formData.append('answerText', answerText.trim());
      }
      if (participantToken) {
        formData.append('participantToken', participantToken);
      }

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
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-900 border border-blue-300">
            Interactive Classroom
          </span>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 mt-1">{sessionTitle || 'Classroom Activity'}</h1>
          <p className="text-sm text-slate-700 font-medium">
            Participate in live class exercises and upload handwritten answers.
          </p>
        </div>

        {errorMessage && (
          <div className="p-4 bg-red-50 border-2 border-red-300 rounded-xl text-red-900 font-semibold text-sm flex items-center gap-2 shadow-sm">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-700" />
            <span>{errorMessage}</span>
          </div>
        )}

        {!joined ? (
          <Card className="p-8 text-center max-w-md mx-auto w-full border-2 border-slate-200 bg-white shadow-sm">
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 mx-auto flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-black text-slate-900">Enter Classroom Join Code</h2>
            <p className="text-sm text-slate-600 font-medium mt-1 mb-6">
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
                className="w-full px-4 py-3 bg-white border-2 border-slate-300 rounded-xl text-slate-900 font-mono text-center tracking-widest text-3xl font-black uppercase focus:outline-none focus:border-blue-600 placeholder:text-slate-400"
              />

              <Button
                type="submit"
                disabled={loading || sessionCode.trim().length < 3}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-center gap-2 py-3 text-base shadow-sm"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Join Session</span>}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </form>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {activity ? (
              <Card className="p-6 border-2 border-slate-200 bg-white shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    activity.status === 'ACTIVE'
                      ? 'bg-blue-100 text-blue-900 border-blue-300'
                      : activity.status === 'PUBLISHED'
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      : 'bg-amber-100 text-amber-900 border-amber-300'
                  }`}>
                    {activity.status === 'ACTIVE' ? 'Submissions Open' : activity.status === 'PUBLISHED' ? 'Results Published' : 'Submissions Closed'}
                  </span>

                  {timeLeft !== null && activity.status === 'ACTIVE' && (
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border-2 ${
                      timeLeft < 30 ? 'bg-red-100 text-red-900 border-red-300 animate-pulse' : 'bg-slate-100 text-slate-800 border-slate-300'
                    }`}>
                      <Clock className="w-4 h-4 text-slate-700" />
                      <span>{formatTimer(timeLeft)}</span>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-xl font-black text-slate-900 mb-2">{activity.title}</h3>
                  <p className="text-base text-slate-800 font-medium whitespace-pre-wrap leading-relaxed">{activity.questionPrompt}</p>
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center border-2 border-slate-200 bg-white text-slate-700">
                <Clock className="w-8 h-8 mx-auto mb-2 text-slate-400 animate-pulse" />
                <h4 className="font-bold text-slate-800">Waiting for professor to activate a question...</h4>
              </Card>
            )}

            {/* Published Results View */}
            {publishedResults && (
              <Card className="p-6 border-2 border-emerald-300 bg-emerald-50/60 shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-2 text-emerald-950 font-black text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                  <span>Classroom Results & Reference Answer</span>
                </div>

                {mySubmission && (
                  <div className={`p-4 rounded-xl border-2 flex items-center gap-3 ${
                    mySubmission.isCorrect === true
                      ? 'bg-emerald-100 border-emerald-400 text-emerald-950'
                      : mySubmission.isCorrect === false
                      ? 'bg-red-100 border-red-400 text-red-950'
                      : 'bg-white border-slate-300 text-slate-900'
                  }`}>
                    {mySubmission.isCorrect === true ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
                    ) : mySubmission.isCorrect === false ? (
                      <XCircle className="w-6 h-6 text-red-700 shrink-0" />
                    ) : (
                      <Clock className="w-6 h-6 text-slate-600 shrink-0" />
                    )}
                    <div>
                      <span className="text-xs uppercase tracking-wider font-bold block text-slate-700">Your Answer</span>
                      <span className="text-base font-black text-slate-900">
                        {mySubmission.isCorrect === true
                          ? 'Marked Correct ✓'
                          : mySubmission.isCorrect === false
                          ? 'Marked Incorrect ✗'
                          : 'Under Review'}
                      </span>
                    </div>
                  </div>
                )}

                <div className="p-4 bg-white border-2 border-emerald-200 rounded-xl">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-900 block mb-1">
                    Reference Solution
                  </span>
                  <p className="text-sm text-slate-900 font-semibold whitespace-pre-wrap leading-relaxed">
                    {publishedResults.referenceAnswer}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center pt-2">
                  <div className="bg-white p-3 rounded-xl border-2 border-slate-200">
                    <span className="text-xs text-slate-600 font-bold block">Class Total</span>
                    <span className="text-lg font-black text-slate-900">{publishedResults.totalSubmissions}</span>
                  </div>
                  <div className="bg-emerald-100 p-3 rounded-xl border-2 border-emerald-300">
                    <span className="text-xs text-emerald-900 font-bold block">Correct</span>
                    <span className="text-lg font-black text-emerald-900">{publishedResults.correctCount}</span>
                  </div>
                  <div className="bg-red-100 p-3 rounded-xl border-2 border-red-300">
                    <span className="text-xs text-red-900 font-bold block">Incorrect</span>
                    <span className="text-lg font-black text-red-900">{publishedResults.incorrectCount}</span>
                  </div>
                </div>
              </Card>
            )}

            {/* Handwritten Image Upload Card */}
            {activity && activity.status !== 'PUBLISHED' && (
              <Card className="p-6 border-2 border-slate-200 bg-white shadow-sm flex flex-col gap-4">
                <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-blue-600" />
                  <span>Upload Handwritten Answer</span>
                </h4>

                {uploadError && (
                  <div className="p-3 bg-red-50 border-2 border-red-300 rounded-xl text-red-900 font-semibold text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {/* Answer Text Input for Automatic Verification */}
                {activity.status === 'ACTIVE' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-1.5">
                      Your Answer / Solution Value
                    </label>
                    <input
                      type="text"
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder="e.g. 42, SYN, SYN-ACK, ACK, O(n log n)"
                      className="w-full px-4 py-2.5 bg-white border-2 border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 text-sm font-semibold"
                    />
                    <p className="text-xs text-slate-600 font-medium mt-1">
                      Your answer will be automatically verified against the reference solution upon submission.
                    </p>
                  </div>
                )}

                {mySubmission && !selectedFile && (
                  <div className={`p-4 rounded-xl border-2 flex flex-col gap-3 ${
                    mySubmission.isCorrect === true
                      ? 'bg-emerald-50 border-emerald-300'
                      : mySubmission.isCorrect === false
                      ? 'bg-red-50 border-red-300'
                      : 'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {mySubmission.isCorrect === true ? (
                          <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
                        ) : mySubmission.isCorrect === false ? (
                          <XCircle className="w-6 h-6 text-red-700 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-6 h-6 text-blue-700" />
                        )}
                        <div>
                          <span className={`text-xs font-black block ${
                            mySubmission.isCorrect === true
                              ? 'text-emerald-950'
                              : mySubmission.isCorrect === false
                              ? 'text-red-950'
                              : 'text-blue-950'
                          }`}>
                            {mySubmission.isCorrect === true
                              ? '✓ Verified Correct'
                              : mySubmission.isCorrect === false
                              ? '✗ Verified Incorrect'
                              : 'Answer Submitted'}
                          </span>
                          <span className="text-xs text-slate-600 font-semibold">
                            {new Date(mySubmission.submittedAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={activity.status === 'CLOSED'}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white text-slate-800 border-2 border-slate-300 hover:bg-slate-100 disabled:opacity-40"
                      >
                        Replace Photo
                      </button>
                    </div>

                    {mySubmission.textResponse && (
                      <div className="text-xs pt-1.5 border-t border-slate-200 flex items-center gap-2">
                        <span className="text-slate-700 font-bold">Submitted Answer:</span>
                        <strong className="text-slate-900 font-mono font-bold">{mySubmission.textResponse}</strong>
                      </div>
                    )}

                    {mySubmission.feedback && (
                      <p className="text-xs text-slate-800 font-semibold italic">
                        {mySubmission.feedback}
                      </p>
                    )}
                  </div>
                )}

                {previewUrl && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative w-full max-h-72 rounded-xl overflow-hidden border-2 border-slate-300 bg-black flex items-center justify-center">
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
                        className="flex-1 text-xs border-2 border-slate-300 text-slate-800 hover:bg-slate-100 font-bold bg-white"
                      >
                        Retake Photo
                      </Button>

                      <Button
                        onClick={handleSubmit}
                        disabled={uploading || activity.status === 'CLOSED'}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
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
                      className="py-4 px-4 bg-blue-50 hover:bg-blue-100 border-2 border-blue-300 rounded-xl text-blue-900 font-bold flex flex-col items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
                    >
                      <Camera className="w-7 h-7 text-blue-700" />
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
                      className="py-4 px-4 bg-slate-50 hover:bg-slate-100 border-2 border-slate-300 rounded-xl text-slate-800 font-bold flex flex-col items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
                    >
                      <Upload className="w-7 h-7 text-slate-700" />
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
