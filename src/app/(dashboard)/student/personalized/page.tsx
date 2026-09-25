'use client';

import React, { useState, useEffect } from 'react';
import {
    Calendar,
    Clock,
    CheckCircle2,
    XCircle,
    Lock,
    Play,
    Send,
    Award,
    Flame,
    AlertCircle,
    Info,
    HelpCircle
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';

interface QuestionDetails {
    _id: string;
    title: string;
    topic: string;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    maxMarks: number;
    questionPrompt: string | null;
    hints?: string[];
    referenceAnswer?: string | null;
}

interface AssignmentData {
    _id: string;
    dayNumber: number;
    scheduledDate: string;
    windowStart: string;
    windowEnd: string;
    status: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'SUBMITTED' | 'MISSED';
    startedAt?: string | null;
    submittedAt?: string | null;
    studentAnswer?: string | null;
    score?: number | null;
    feedback?: string | null;
    question: QuestionDetails | null;
}

interface ScheduleInfo {
    _id: string;
    title: string;
    totalQuestionsTarget: number;
    totalWeeks: number;
    dailyWindowStartTime: string;
    dailyWindowEndTime: string;
    course?: {
        courseCode: string;
        courseName: string;
    };
}

interface SlotSummary {
    _id: string;
    dayNumber: number;
    scheduledDate: string;
    status: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'SUBMITTED' | 'MISSED';
    score?: number | null;
    question?: {
        title: string;
        topic: string;
        difficulty: string;
        maxMarks: number;
    } | null;
}

interface StatsSummary {
    total: number;
    completed: number;
    missed: number;
    locked: number;
    inProgress: number;
    streak: number;
    completionPercentage: number;
}

export default function StudentPersonalizedAssessmentPage() {
    const [loading, setLoading] = useState(true);
    const [todayData, setTodayData] = useState<AssignmentData | null>(null);
    const [scheduleInfo, setScheduleInfo] = useState<ScheduleInfo | null>(null);
    const [allSlots, setAllSlots] = useState<SlotSummary[]>([]);
    const [stats, setStats] = useState<StatsSummary | null>(null);
    const [answerText, setAnswerText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [starting, setStarting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [showHints, setShowHints] = useState(false);

    const loadAssessmentData = async () => {
        setLoading(true);
        setErrorMsg(null);
        try {
            // 1. Fetch today's assignment
            const todayRes = await fetch('/api/personalized/today');
            const todayJson = await todayRes.json();

            if (todayJson.success && todayJson.data) {
                setScheduleInfo(todayJson.data.schedule);
                setTodayData(todayJson.data.assignment);
                if (todayJson.data.assignment?.studentAnswer) {
                    setAnswerText(todayJson.data.assignment.studentAnswer);
                }
            }

            // 2. Fetch full 100-day schedule progress
            const scheduleRes = await fetch('/api/personalized/my-schedule');
            const scheduleJson = await scheduleRes.json();

            if (scheduleJson.success && scheduleJson.data) {
                setAllSlots(scheduleJson.data.slots || []);
                setStats(scheduleJson.data.stats || null);
                if (!scheduleInfo && scheduleJson.data.schedule) {
                    setScheduleInfo(scheduleJson.data.schedule);
                }
            }
        } catch {
            setErrorMsg('Failed to load personalized assessment schedule. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let mounted = true;
        async function init() {
            if (mounted) {
                await loadAssessmentData();
            }
        }
        init();
        return () => {
            mounted = false;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleStartAssignment = async () => {
        if (!todayData) return;
        setStarting(true);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/personalized/today/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignmentId: todayData._id })
            });
            const json = await res.json();
            if (json.success) {
                await loadAssessmentData();
            } else {
                setErrorMsg(json.message || 'Failed to start assignment');
            }
        } catch {
            setErrorMsg('Network error starting assignment');
        } finally {
            setStarting(false);
        }
    };

    const handleSubmitAnswer = async () => {
        if (!todayData || !answerText.trim()) return;
        setSubmitting(true);
        setErrorMsg(null);
        setSuccessMsg(null);
        try {
            const res = await fetch('/api/personalized/today/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assignmentId: todayData._id,
                    answer: answerText.trim()
                })
            });
            const json = await res.json();
            if (json.success) {
                setSuccessMsg('Answer successfully submitted for today!');
                await loadAssessmentData();
            } else {
                setErrorMsg(json.message || 'Submission failed');
            }
        } catch {
            setErrorMsg('Network error submitting answer');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center space-y-3">
                    <LoadingSpinner size="lg" />
                    <p className="text-sm font-semibold text-slate-500">Loading your personalized assessment...</p>
                </div>
            </div>
        );
    }

    if (!scheduleInfo) {
        return (
            <div className="p-6 max-w-5xl mx-auto space-y-6">
                <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
                    <Calendar className="h-8 w-8 text-brand-primary" />
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Daily Assessment</h1>
                        <p className="text-sm text-slate-500">Continuous individual learning and assessment across the semester</p>
                    </div>
                </div>
                <EmptyState
                    title="No Active Assessment Schedule"
                    description="You are not currently enrolled in an active personalized assessment course. Your instructor will activate the schedule."
                    icon={Calendar}
                />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-8">
            {/* Header & Course Details */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand-primary/10 text-brand-primary">
                            {scheduleInfo.course?.courseCode || 'Course'}
                        </span>
                        <h1 className="text-2xl font-extrabold text-slate-900">{scheduleInfo.title}</h1>
                    </div>
                    <p className="text-sm text-slate-600 mt-1">
                        100 Questions across {scheduleInfo.totalWeeks} Weeks • Daily Window:{' '}
                        <span className="font-semibold text-slate-800">
                            {scheduleInfo.dailyWindowStartTime} – {scheduleInfo.dailyWindowEndTime}
                        </span>
                    </p>
                </div>

                {/* Quick Stats Badges */}
                {stats && (
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
                            <Flame className="h-4 w-4 text-amber-600 fill-amber-500" />
                            <span className="text-xs font-bold">{stats.streak} Day Streak</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800">
                            <Award className="h-4 w-4 text-emerald-600" />
                            <span className="text-xs font-bold">{stats.completed} / 100 Completed</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Error / Success Notifications */}
            {errorMsg && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-rose-800 text-sm">
                    <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
                    <span>{errorMsg}</span>
                </div>
            )}
            {successMsg && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-emerald-800 text-sm">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <span>{successMsg}</span>
                </div>
            )}

            {/* Main Daily Assessment Hero Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    {todayData ? (
                        <Card className="p-6 border-slate-200 shadow-sm relative overflow-hidden">
                            {/* Card Top Banner */}
                            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                                <div className="flex items-center gap-2.5">
                                    <span className="h-8 w-8 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center font-bold text-sm">
                                        {todayData.dayNumber}
                                    </span>
                                    <div>
                                        <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                                            Day {todayData.dayNumber} of {scheduleInfo.totalQuestionsTarget}
                                        </span>
                                        <h2 className="text-lg font-bold text-slate-900">
                                            {todayData.question?.title || 'Daily Assessment'}
                                        </h2>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {todayData.status === 'AVAILABLE' && (
                                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                            Window Open
                                        </span>
                                    )}
                                    {todayData.status === 'IN_PROGRESS' && (
                                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                            In Progress
                                        </span>
                                    )}
                                    {todayData.status === 'SUBMITTED' && (
                                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            Submitted
                                        </span>
                                    )}
                                    {todayData.status === 'MISSED' && (
                                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                            Window Expired
                                        </span>
                                    )}
                                    {todayData.status === 'LOCKED' && (
                                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                            Locked
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Status Specific Content */}
                            {todayData.status === 'LOCKED' && (
                                <div className="py-8 text-center space-y-3">
                                    <Lock className="h-10 w-10 text-slate-400 mx-auto" />
                                    <h3 className="text-base font-bold text-slate-800">
                                        Today&apos;s Question Unlocks at {scheduleInfo.dailyWindowStartTime}
                                    </h3>
                                    <p className="text-sm text-slate-500 max-w-md mx-auto">
                                        The daily question will become available during your cohort&apos;s configured time window.
                                        Check back shortly.
                                    </p>
                                </div>
                            )}

                            {todayData.status === 'MISSED' && (
                                <div className="py-8 text-center space-y-3">
                                    <XCircle className="h-10 w-10 text-rose-500 mx-auto" />
                                    <h3 className="text-base font-bold text-slate-900">
                                        Assessment Window Expired
                                    </h3>
                                    <p className="text-sm text-slate-600 max-w-md mx-auto">
                                        The daily submission window for this question closed at {scheduleInfo.dailyWindowEndTime}.
                                        Questions cannot be submitted after the daily window closes.
                                    </p>
                                </div>
                            )}

                            {todayData.status === 'SUBMITTED' && (
                                <div className="space-y-4">
                                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
                                        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                                        <div>
                                            <p className="text-sm font-bold text-emerald-900">
                                                Response Successfully Recorded!
                                            </p>
                                            <p className="text-xs text-emerald-700 mt-0.5">
                                                Submitted on{' '}
                                                {todayData.submittedAt
                                                    ? new Date(todayData.submittedAt).toLocaleTimeString([], {
                                                          hour: '2-digit',
                                                          minute: '2-digit'
                                                      })
                                                    : 'Today'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Question prompt recap */}
                                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                                            Question Prompt
                                        </p>
                                        <p className="text-sm text-slate-800 whitespace-pre-wrap font-medium">
                                            {todayData.question?.questionPrompt}
                                        </p>
                                    </div>

                                    {/* Submitted Answer view */}
                                    <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                                            Your Submitted Response
                                        </p>
                                        <pre className="text-sm text-slate-800 whitespace-pre-wrap font-mono bg-slate-50 p-3 rounded-lg border border-slate-200">
                                            {todayData.studentAnswer}
                                        </pre>
                                    </div>
                                </div>
                            )}

                            {(todayData.status === 'AVAILABLE' || todayData.status === 'IN_PROGRESS') && (
                                <div className="space-y-5">
                                    {/* Question Meta & Prompt */}
                                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                                        <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                                            <span>Topic: {todayData.question?.topic}</span>
                                            <span>Max Marks: {todayData.question?.maxMarks}</span>
                                        </div>
                                        <div className="text-sm text-slate-900 font-medium whitespace-pre-wrap">
                                            {todayData.question?.questionPrompt}
                                        </div>

                                        {todayData.question?.hints && todayData.question.hints.length > 0 && (
                                            <div>
                                                <button
                                                    onClick={() => setShowHints(!showHints)}
                                                    className="text-xs font-bold text-brand-primary flex items-center gap-1 hover:underline"
                                                >
                                                    <HelpCircle className="h-3.5 w-3.5" />
                                                    {showHints ? 'Hide Hints' : 'View Hints'}
                                                </button>
                                                {showHints && (
                                                    <ul className="mt-2 text-xs text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200 list-disc list-inside space-y-1">
                                                        {todayData.question.hints.map((hint, i) => (
                                                            <li key={i}>{hint}</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Action State: Start vs Submit */}
                                    {todayData.status === 'AVAILABLE' ? (
                                        <div className="text-center py-4 space-y-3">
                                            <p className="text-sm text-slate-600">
                                                Ready to solve today&apos;s question? Click Start to begin your session.
                                            </p>
                                            <Button
                                                variant="primary"
                                                size="md"
                                                onClick={handleStartAssignment}
                                                disabled={starting}
                                            >
                                                <Play className="h-4 w-4" />
                                                <span>{starting ? 'Starting...' : 'Start Solving Today’s Question'}</span>
                                            </Button>
                                        </div>
                                    ) : (
                                        /* In Progress Answer Box */
                                        <div className="space-y-3">
                                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                                                Your Solution / Explanation
                                            </label>
                                            <textarea
                                                value={answerText}
                                                onChange={(e) => setAnswerText(e.target.value)}
                                                rows={8}
                                                placeholder="Write your answer, derivation, or code solution here..."
                                                className="w-full rounded-xl border border-slate-300 p-3.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary font-mono transition-all resize-y"
                                            />
                                            <div className="flex items-center justify-between text-xs text-slate-500">
                                                <span>{answerText.length} characters</span>
                                                <Button
                                                    variant="primary"
                                                    size="md"
                                                    onClick={handleSubmitAnswer}
                                                    disabled={submitting || !answerText.trim()}
                                                >
                                                    <Send className="h-4 w-4" />
                                                    <span>{submitting ? 'Submitting...' : 'Submit Today’s Answer'}</span>
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </Card>
                    ) : (
                        <Card className="p-8 text-center space-y-3 border-slate-200">
                            <Clock className="h-10 w-10 text-slate-400 mx-auto" />
                            <h3 className="text-base font-bold text-slate-800">No Assessment Scheduled Today</h3>
                            <p className="text-sm text-slate-500">
                                Today is a scheduled rest or review day according to your cohort&apos;s weekly timetable.
                            </p>
                        </Card>
                    )}
                </div>

                {/* Right Column: Progress Metrics & Cohort Invariants */}
                <div className="space-y-6">
                    {/* Stats Card */}
                    <Card className="p-5 border-slate-200 space-y-4">
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                            Overall Completion Progress
                        </h3>

                        {stats && (
                            <div className="space-y-3">
                                <div>
                                    <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                                        <span>Target: 100 Questions</span>
                                        <span>{Math.round(stats.completionPercentage)}%</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                                        <div
                                            className="bg-brand-primary h-2.5 rounded-full transition-all duration-500"
                                            style={{ width: `${Math.min(stats.completionPercentage, 100)}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 pt-2">
                                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                                        <p className="text-2xs font-bold text-slate-400 uppercase">Submitted</p>
                                        <p className="text-lg font-black text-emerald-600">{stats.completed}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                                        <p className="text-2xs font-bold text-slate-400 uppercase">Missed</p>
                                        <p className="text-lg font-black text-rose-600">{stats.missed}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </Card>

                    {/* Guidelines Card */}
                    <Card className="p-5 border-slate-200 bg-indigo-50/50 space-y-3">
                        <div className="flex items-center gap-2 text-indigo-950 font-bold text-sm">
                            <Info className="h-4 w-4 text-brand-primary" />
                            <span>Daily Assessment Guidelines</span>
                        </div>
                        <ul className="text-xs text-indigo-900 space-y-2 list-disc list-inside">
                            <li>Each student receives 100 distinct personalized questions across 16 weeks.</li>
                            <li>Daily questions are tailored individually for each student.</li>
                            <li>Each question is solvable strictly within today&apos;s daily window.</li>
                            <li>Completed questions count towards your daily streak.</li>
                        </ul>
                    </Card>
                </div>
            </div>

            {/* Assessment Visual Journey Grid */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">Assessment Roadmap</h2>
                        <p className="text-xs text-slate-500">Your personalized daily assessment journey across the semester</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-semibold text-slate-600">
                        <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Submitted
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Missed
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-brand-primary" /> Active/Today
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> Locked
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-20 gap-2 p-4 bg-white rounded-xl border border-slate-200">
                    {allSlots.map((slot) => {
                        let bgClass = 'bg-slate-100 text-slate-400 border-slate-200';
                        if (slot.status === 'SUBMITTED') {
                            bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-300 font-bold';
                        } else if (slot.status === 'MISSED') {
                            bgClass = 'bg-rose-50 text-rose-700 border-rose-300 font-bold';
                        } else if (slot.status === 'AVAILABLE' || slot.status === 'IN_PROGRESS') {
                            bgClass = 'bg-brand-primary text-white border-brand-primary font-extrabold shadow-sm';
                        }

                        return (
                            <div
                                key={slot._id}
                                title={`Day ${slot.dayNumber}: ${slot.status} (${new Date(slot.scheduledDate).toLocaleDateString()})`}
                                className={`h-10 flex flex-col items-center justify-center rounded-lg border text-xs transition-all ${bgClass}`}
                            >
                                <span>{slot.dayNumber}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
