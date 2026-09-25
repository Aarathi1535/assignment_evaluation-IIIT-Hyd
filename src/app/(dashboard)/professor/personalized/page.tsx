'use client';

import React, { useState, useEffect } from 'react';
import {
    Calendar,
    Plus,
    CheckCircle2,
    AlertCircle,
    Sparkles,
    BookOpen,
    Layers,
    UploadCloud,
    HelpCircle,
    Eye,
    ChevronRight
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';

interface CourseOption {
    _id: string;
    courseCode: string;
    courseName: string;
    enrolledStudents?: Array<{ _id: string; name: string; email: string }>;
}

interface SyllabusUnit {
    unitNumber: number;
    unitTitle: string;
    topics: string[];
    description?: string;
}

interface CourseSyllabusData {
    _id: string;
    course: string;
    title: string;
    rawText: string;
    units: SyllabusUnit[];
    extractedTopics: string[];
    learningObjectives?: string[];
    updatedAt: string;
}

interface QuestionItem {
    _id: string;
    questionIndex: number;
    title: string;
    topic: string;
    unit?: string;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    questionPrompt: string;
    expectedConcepts?: string[];
    maxMarks: number;
    hints?: string[];
    referenceAnswer?: string;
    rubricCriteria?: Array<{ criterionName: string; points: number }>;
}

interface ScheduleItem {
    _id: string;
    title: string;
    totalQuestionsTarget: number;
    totalWeeks: number;
    startDate: string;
    endDate: string;
    activeDaysOfWeek: number[];
    dailyWindowStartTime: string;
    dailyWindowEndTime: string;
    status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'PAUSED';
    course: {
        _id: string;
        courseCode: string;
        courseName: string;
    };
    enrolledStudents: Array<{ _id: string; name: string; email: string }>;
    questionPool: string[];
}

interface StudentProgressItem {
    studentId: string;
    studentName: string;
    studentEmail: string;
    totalAssigned: number;
    submittedCount: number;
    missedCount: number;
    inProgressCount: number;
    totalScore: number;
    completionPercentage: number;
}

type TabType = 'SYLLABUS' | 'QUESTION_BANK' | 'SCHEDULES';

export default function ProfessorPersonalizedAssessmentPage() {
    const [loading, setLoading] = useState(true);
    const [courses, setCourses] = useState<CourseOption[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState('');
    const [activeTab, setActiveTab] = useState<TabType>('SYLLABUS');

    // Syllabus state
    const [syllabus, setSyllabus] = useState<CourseSyllabusData | null>(null);
    const [syllabusInputText, setSyllabusInputText] = useState('');
    const [processingSyllabus, setProcessingSyllabus] = useState(false);
    const [isEditingSyllabus, setIsEditingSyllabus] = useState(false);

    // Question bank state
    const [questions, setQuestions] = useState<QuestionItem[]>([]);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [showGenerateModal, setShowGenerateModal] = useState(false);
    const [generateTargetCount, setGenerateTargetCount] = useState(100);
    const [generating, setGenerating] = useState(false);
    const [previewQuestion, setPreviewQuestion] = useState<QuestionItem | null>(null);

    // Schedules state
    const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
    const [selectedSchedule, setSelectedSchedule] = useState<ScheduleItem | null>(null);
    const [progressData, setProgressData] = useState<StudentProgressItem[]>([]);
    const [loadingProgress, setLoadingProgress] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [scheduleTitle, setScheduleTitle] = useState('');
    const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
    const [selectedDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('22:00');
    const [creating, setCreating] = useState(false);

    // Notifications
    const [formError, setFormError] = useState<string | null>(null);
    const [formSuccess, setFormSuccess] = useState<string | null>(null);
    const [aiSetupWarning, setAiSetupWarning] = useState<string | null>(null);

    interface ApiResponse<T> {
        ok: boolean;
        status: number;
        data?: T;
        message?: string;
        error?: {
            code?: string;
            message?: string;
            details?: unknown;
        };
    }

    const safeFetchJson = async <T,>(url: string, options?: RequestInit): Promise<ApiResponse<T>> => {
        let res: Response;
        try {
            res = await fetch(url, options);
        } catch (networkErr: unknown) {
            const message = networkErr instanceof Error ? networkErr.message : 'Connection failed';
            return {
                ok: false,
                status: 0,
                message: `Network communication failure: ${message}`,
                error: {
                    code: 'NETWORK_ERROR',
                    message: `Network communication failure: ${message}`
                }
            };
        }

        let payload: { success?: boolean; data?: T; message?: string; error?: { code?: string; message?: string; details?: unknown } } | null = null;
        const rawText = await res.text();
        if (rawText && rawText.trim().length > 0) {
            try {
                payload = JSON.parse(rawText);
            } catch {
                return {
                    ok: false,
                    status: res.status,
                    message: `Server returned non-JSON response (${res.status} ${res.statusText})`,
                    error: {
                        code: res.status === 401 ? 'UNAUTHORIZED' : res.status === 403 ? 'FORBIDDEN' : 'SERVER_ERROR',
                        message: `Server response error (${res.status}): ${res.statusText || 'Unexpected response format'}`
                    }
                };
            }
        }

        if (!res.ok || (payload && payload.success === false)) {
            const code =
                payload?.error?.code ||
                (res.status === 401
                    ? 'UNAUTHORIZED'
                    : res.status === 403
                    ? 'FORBIDDEN'
                    : res.status === 400
                    ? 'VALIDATION_FAILED'
                    : res.status === 404
                    ? 'NOT_FOUND'
                    : res.status === 503
                    ? 'AI_NOT_CONFIGURED'
                    : 'SERVER_ERROR');

            const message =
                payload?.error?.message ||
                payload?.message ||
                (res.status === 401
                    ? 'Session expired or unauthenticated. Please log in again.'
                    : res.status === 403
                    ? 'You do not have permission to perform this action.'
                    : res.status === 400
                    ? 'Validation failed: Please check input fields.'
                    : res.status === 404
                    ? 'Requested resource not found.'
                    : `Request failed with status ${res.status}`);

            return {
                ok: false,
                status: res.status,
                message,
                error: {
                    code,
                    message,
                    details: payload?.error?.details
                }
            };
        }

        return {
            ok: true,
            status: res.status,
            data: payload?.data,
            message: payload?.message
        };
    };

    const formatError = (res: ApiResponse<unknown>, fallback: string): string => {
        if (res.error?.code && res.error.message) {
            return `[${res.error.code}] ${res.error.message}`;
        }
        return res.message || fallback;
    };

    // Load initial data
    const loadCoursesAndSchedules = async () => {
        setLoading(true);
        const coursesRes = await safeFetchJson<CourseOption[]>('/api/courses');
        if (coursesRes.ok && coursesRes.data && coursesRes.data.length > 0) {
            setCourses(coursesRes.data);
            const initialCourseId = coursesRes.data[0]._id;
            setSelectedCourseId(initialCourseId);
            await loadCourseSyllabus(initialCourseId);
            await loadCourseQuestions(initialCourseId);
        } else if (!coursesRes.ok) {
            setFormError(formatError(coursesRes, 'Failed to load courses'));
        }

        const schedRes = await safeFetchJson<ScheduleItem[]>('/api/personalized/schedules');
        if (schedRes.ok && schedRes.data) {
            setSchedules(schedRes.data);
            if (schedRes.data.length > 0) {
                const first = schedRes.data[0];
                setSelectedSchedule(first);
                await loadScheduleProgress(first._id);
            }
        }
        setLoading(false);
    };

    const loadCourseSyllabus = async (courseId: string) => {
        const res = await safeFetchJson<CourseSyllabusData>(`/api/personalized/syllabus?courseId=${courseId}`);
        if (res.ok && res.data) {
            setSyllabus(res.data);
            setSyllabusInputText(res.data.rawText || '');
            setIsEditingSyllabus(false);
        } else {
            setSyllabus(null);
            setSyllabusInputText('');
            setIsEditingSyllabus(true);
        }
    };

    const loadCourseQuestions = async (courseId: string) => {
        setLoadingQuestions(true);
        const res = await safeFetchJson<QuestionItem[]>(`/api/personalized/questions?courseId=${courseId}`);
        if (res.ok && res.data) {
            setQuestions(res.data);
        } else {
            setQuestions([]);
        }
        setLoadingQuestions(false);
    };

    const loadScheduleProgress = async (scheduleId: string) => {
        setLoadingProgress(true);
        const res = await safeFetchJson<{ studentProgress: StudentProgressItem[] }>(`/api/personalized/schedules/${scheduleId}/progress`);
        if (res.ok && res.data) {
            setProgressData(res.data.studentProgress || []);
        } else {
            setProgressData([]);
        }
        setLoadingProgress(false);
    };

    useEffect(() => {
        let isMounted = true;
        async function init() {
            if (isMounted) {
                await loadCoursesAndSchedules();
            }
        }
        init();
        return () => {
            isMounted = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleCourseChange = async (newCourseId: string) => {
        setSelectedCourseId(newCourseId);
        setFormError(null);
        setFormSuccess(null);
        setAiSetupWarning(null);
        await loadCourseSyllabus(newCourseId);
        await loadCourseQuestions(newCourseId);
    };

    // Syllabus processing
    const handleProcessSyllabus = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCourseId) {
            setFormError('[VALIDATION_FAILED] Please select a course first');
            return;
        }
        if (!syllabusInputText.trim()) {
            setFormError('[VALIDATION_FAILED] Please enter or paste the syllabus text');
            return;
        }

        setProcessingSyllabus(true);
        setFormError(null);
        setFormSuccess(null);

        const result = await safeFetchJson<CourseSyllabusData>('/api/personalized/syllabus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                courseId: selectedCourseId,
                syllabusText: syllabusInputText
            })
        });

        if (result.ok && result.data) {
            setSyllabus(result.data);
            setIsEditingSyllabus(false);
            setFormSuccess(`Syllabus parsed successfully: ${result.data.units.length} units and ${result.data.extractedTopics.length} topics extracted.`);
        } else {
            setFormError(formatError(result, 'Failed to process syllabus'));
        }
        setProcessingSyllabus(false);
    };

    // Generate questions with AI
    const handleGenerateQuestionBank = async () => {
        if (!selectedCourseId) return;
        setGenerating(true);
        setFormError(null);
        setFormSuccess(null);
        setAiSetupWarning(null);

        const result = await safeFetchJson<{ totalGenerated: number; totalInPool: number }>('/api/personalized/questions/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                courseId: selectedCourseId,
                targetCount: generateTargetCount
            })
        });

        if (result.ok && result.data) {
            setShowGenerateModal(false);
            setFormSuccess(`Successfully generated ${result.data.totalGenerated} syllabus-grounded questions! Total pool: ${result.data.totalInPool}`);
            await loadCourseQuestions(selectedCourseId);
        } else {
            if (result.error?.code === 'AI_NOT_CONFIGURED' || result.status === 503) {
                setAiSetupWarning(result.error?.message || result.message || 'AI Question Generation provider is not configured in the environment.');
            } else {
                setFormError(formatError(result, 'Failed to generate question bank.'));
            }
        }
        setGenerating(false);
    };

    // Create schedule
    const handleCreateSchedule = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);
        setFormSuccess(null);
        setCreating(true);

        const course = courses.find((c) => c._id === selectedCourseId);
        const enrolled = course?.enrolledStudents?.map((s) => s._id) || [];

        if (enrolled.length === 0) {
            setFormError('[VALIDATION_FAILED] The selected course has no enrolled students. Please enroll students first.');
            setCreating(false);
            return;
        }

        const result = await safeFetchJson('/api/personalized/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                course: selectedCourseId,
                title: scheduleTitle || `${course?.courseCode} Personalized Assessment`,
                startDate,
                activeDaysOfWeek: selectedDays,
                dailyWindowStartTime: startTime,
                dailyWindowEndTime: endTime,
                enrolledStudents: enrolled,
                totalQuestionsTarget: 100,
                totalWeeks: 16
            })
        });

        if (result.ok) {
            setFormSuccess('Personalized assessment schedule created and activated successfully!');
            setShowCreateModal(false);
            const schedRes = await safeFetchJson<ScheduleItem[]>('/api/personalized/schedules');
            if (schedRes.ok && schedRes.data) {
                setSchedules(schedRes.data);
                if (schedRes.data.length > 0) {
                    setSelectedSchedule(schedRes.data[0]);
                    await loadScheduleProgress(schedRes.data[0]._id);
                }
            }
        } else {
            setFormError(formatError(result, 'Failed to create schedule'));
        }
        setCreating(false);
    };


    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center space-y-3">
                    <LoadingSpinner size="lg" />
                    <p className="text-sm font-semibold text-slate-500">Loading personalized assessment management...</p>
                </div>
            </div>
        );
    }

    const currentCourse = courses.find((c) => c._id === selectedCourseId);
    const enrolledCount = currentCourse?.enrolledStudents?.length || 0;
    const requiredPoolSize = Math.max(100, enrolledCount);
    const isPoolSufficient = questions.length >= requiredPoolSize;

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8">
            {/* Header & Course Selection */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
                <div>
                    <h1 className="text-2xl font-extrabold text-slate-900">Personalized Assessment</h1>
                    <p className="text-sm text-slate-600 mt-1">
                        Create structured, personalized assessments from your course syllabus.
                    </p>
                </div>

                {/* Course Switcher */}
                <div className="flex items-center gap-3">
                    <label className="text-xs font-bold text-slate-500 uppercase">Course:</label>
                    <select
                        value={selectedCourseId}
                        onChange={(e) => handleCourseChange(e.target.value)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                    >
                        {courses.map((c) => (
                            <option key={c._id} value={c._id}>
                                {c.courseCode} - {c.courseName} ({c.enrolledStudents?.length || 0} students)
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Notification Alerts */}
            {formSuccess && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-emerald-800 text-sm shadow-sm">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <span>{formSuccess}</span>
                </div>
            )}
            {formError && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-rose-800 text-sm shadow-sm">
                    <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
                    <span>{formError}</span>
                </div>
            )}
            {aiSetupWarning && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-900 text-sm shadow-sm">
                    <HelpCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-bold">AI Provider Configuration Required</p>
                        <p className="text-xs text-amber-800 mt-0.5">{aiSetupWarning}</p>
                    </div>
                </div>
            )}

            {/* Workflow Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-200">
                <button
                    onClick={() => setActiveTab('SYLLABUS')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 transition-all ${
                        activeTab === 'SYLLABUS'
                            ? 'border-brand-primary text-brand-primary bg-brand-primary/5'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <BookOpen className="h-4 w-4" />
                    <span>1. Semester Syllabus</span>
                    {syllabus && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500 ml-1" title="Syllabus Configured" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('QUESTION_BANK')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 transition-all ${
                        activeTab === 'QUESTION_BANK'
                            ? 'border-brand-primary text-brand-primary bg-brand-primary/5'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <Layers className="h-4 w-4" />
                    <span>2. Question Bank ({questions.length})</span>
                    {isPoolSufficient && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500 ml-1" title="Pool Capacity Ready" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('SCHEDULES')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 transition-all ${
                        activeTab === 'SCHEDULES'
                            ? 'border-brand-primary text-brand-primary bg-brand-primary/5'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <Calendar className="h-4 w-4" />
                    <span>3. Assessment Schedules ({schedules.length})</span>
                </button>
            </div>

            {/* TAB 1: SEMESTER SYLLABUS */}
            {activeTab === 'SYLLABUS' && (
                <div className="space-y-6">
                    {syllabus && !isEditingSyllabus ? (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Syllabus Overview</h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Extracted course structure and topic distribution for {currentCourse?.courseCode}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setIsEditingSyllabus(true)}
                                    >
                                        Update Syllabus
                                    </Button>
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => setActiveTab('QUESTION_BANK')}
                                    >
                                        <span>Proceed to Question Bank</span>
                                        <ChevronRight className="h-4 w-4 ml-1" />
                                    </Button>
                                </div>
                            </div>

                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Card className="p-4 bg-white border-slate-200">
                                    <p className="text-xs font-bold text-slate-400 uppercase">Total Units / Modules</p>
                                    <p className="text-2xl font-black text-slate-900 mt-1">{syllabus.units.length}</p>
                                </Card>
                                <Card className="p-4 bg-white border-slate-200">
                                    <p className="text-xs font-bold text-slate-400 uppercase">Extracted Topics</p>
                                    <p className="text-2xl font-black text-brand-primary mt-1">{syllabus.extractedTopics.length}</p>
                                </Card>
                                <Card className="p-4 bg-white border-slate-200">
                                    <p className="text-xs font-bold text-slate-400 uppercase">Estimated Daily Coverage</p>
                                    <p className="text-2xl font-black text-emerald-600 mt-1">100 Days</p>
                                </Card>
                            </div>

                            {/* Units Breakdown */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                                    Structured Units & Topics
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {syllabus.units.map((u) => (
                                        <Card key={u.unitNumber} className="p-5 bg-white border-slate-200 space-y-3 shadow-sm">
                                            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                                <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-brand-primary/10 text-brand-primary">
                                                    Unit {u.unitNumber}
                                                </span>
                                                <span className="text-xs text-slate-400 font-semibold">{u.topics.length} topics</span>
                                            </div>
                                            <h4 className="text-sm font-bold text-slate-900">{u.unitTitle}</h4>
                                            <ul className="text-xs text-slate-600 space-y-1.5 list-disc list-inside">
                                                {u.topics.map((t, idx) => (
                                                    <li key={idx} className="truncate">{t}</li>
                                                ))}
                                            </ul>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <Card className="p-6 bg-white border-slate-200 space-y-5">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Upload or Paste Course Syllabus</h2>
                                <p className="text-xs text-slate-500 mt-1">
                                    Paste your syllabus outline or module descriptions. The system will extract units and topics to ground your assessment questions.
                                </p>
                            </div>

                            <form onSubmit={handleProcessSyllabus} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                        Syllabus Content
                                    </label>
                                    <textarea
                                        rows={12}
                                        value={syllabusInputText}
                                        onChange={(e) => setSyllabusInputText(e.target.value)}
                                        placeholder={`Example Syllabus Format:

Unit 1: Foundations of Algorithms & Asymptotics
- Big-O, Omega, Theta notation
- Recurrence relations and Master Theorem
- Divide and conquer strategies

Unit 2: Dynamic Programming & Optimization
- Optimal substructure and overlapping subproblems
- Longest common subsequence, Knapsack problem
- Matrix chain multiplication

Unit 3: Graph Algorithms & Network Flow
- Graph traversals (BFS, DFS)
- Shortest paths (Dijkstra, Bellman-Ford)
- Minimum spanning trees (Prim, Kruskal)

Unit 4: Advanced Data Structures
- Red-Black trees and AVL trees
- Disjoint set union (DSU)
- B-Trees and indexing`}
                                        className="w-full rounded-xl border border-slate-300 p-3.5 text-xs font-mono text-slate-800 shadow-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary leading-relaxed"
                                        required
                                    />
                                </div>

                                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                                    <div className="text-xs text-slate-500">
                                        💡 Structured units like &quot;Unit 1&quot; or &quot;Module 1&quot; help ground questions accurately.
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {syllabus && (
                                            <Button
                                                variant="secondary"
                                                size="md"
                                                type="button"
                                                onClick={() => setIsEditingSyllabus(false)}
                                            >
                                                Cancel
                                            </Button>
                                        )}
                                        <Button
                                            variant="primary"
                                            size="md"
                                            type="submit"
                                            disabled={processingSyllabus}
                                        >
                                            <UploadCloud className="h-4 w-4 mr-1.5" />
                                            <span>{processingSyllabus ? 'Extracting Structure...' : 'Process Syllabus'}</span>
                                        </Button>
                                    </div>
                                </div>
                            </form>
                        </Card>
                    )}
                </div>
            )}

            {/* TAB 2: QUESTION BANK */}
            {activeTab === 'QUESTION_BANK' && (
                <div className="space-y-6">
                    {/* Top Action Bar & Capacity Status */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">Course Question Bank</h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {questions.length} questions available for {currentCourse?.courseCode}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                variant="primary"
                                size="md"
                                onClick={() => setShowGenerateModal(true)}
                            >
                                <Sparkles className="h-4 w-4 mr-1.5" />
                                <span>Generate Questions with AI</span>
                            </Button>
                        </div>
                    </div>

                    {/* Question Bank Metrics */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <Card className="p-4 bg-white border-slate-200">
                            <p className="text-xs font-bold text-slate-400 uppercase">Total Questions</p>
                            <p className="text-2xl font-black text-slate-900 mt-1">{questions.length}</p>
                        </Card>
                        <Card className="p-4 bg-white border-slate-200">
                            <p className="text-xs font-bold text-slate-400 uppercase">Capacity Status</p>
                            <p className={`text-sm font-bold mt-2 ${isPoolSufficient ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {isPoolSufficient
                                    ? `✓ Meets ${requiredPoolSize} required capacity`
                                    : `Requires ${requiredPoolSize} for ${enrolledCount} students`}
                            </p>
                        </Card>
                        <Card className="p-4 bg-white border-slate-200">
                            <p className="text-xs font-bold text-slate-400 uppercase">Difficulty Breakdown</p>
                            <div className="flex items-center gap-2 mt-2">
                                <span className="px-2 py-0.5 rounded text-2xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    {questions.filter((q) => q.difficulty === 'EASY').length} Easy
                                </span>
                                <span className="px-2 py-0.5 rounded text-2xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                    {questions.filter((q) => q.difficulty === 'MEDIUM').length} Med
                                </span>
                                <span className="px-2 py-0.5 rounded text-2xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                    {questions.filter((q) => q.difficulty === 'HARD').length} Hard
                                </span>
                            </div>
                        </Card>
                        <Card className="p-4 bg-white border-slate-200">
                            <p className="text-xs font-bold text-slate-400 uppercase">Enrolled Students</p>
                            <p className="text-2xl font-black text-slate-700 mt-1">{enrolledCount}</p>
                        </Card>
                    </div>

                    {/* Question List Table */}
                    {loadingQuestions ? (
                        <div className="py-12 text-center">
                            <LoadingSpinner size="md" />
                            <p className="text-xs text-slate-500 mt-2">Loading question bank...</p>
                        </div>
                    ) : questions.length === 0 ? (
                        <EmptyState
                            title="Question Bank is Empty"
                            description="Upload your syllabus and generate questions with AI to populate your course question bank."
                            icon={Layers}
                        />
                    ) : (
                        <Card className="overflow-hidden border-slate-200 bg-white">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                        <tr>
                                            <th className="p-3">#</th>
                                            <th className="p-3">Title & Prompt</th>
                                            <th className="p-3">Topic / Unit</th>
                                            <th className="p-3">Difficulty</th>
                                            <th className="p-3">Marks</th>
                                            <th className="p-3 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {questions.map((q) => (
                                            <tr key={q._id} className="hover:bg-slate-50/50">
                                                <td className="p-3 font-mono font-bold text-slate-500">
                                                    {q.questionIndex}
                                                </td>
                                                <td className="p-3 max-w-md">
                                                    <p className="font-bold text-slate-900">{q.title}</p>
                                                    <p className="text-slate-500 truncate mt-0.5">{q.questionPrompt}</p>
                                                </td>
                                                <td className="p-3">
                                                    <span className="font-semibold text-slate-800">{q.topic}</span>
                                                    {q.unit && (
                                                        <p className="text-2xs text-slate-400 mt-0.5">{q.unit}</p>
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    <span
                                                        className={`px-2 py-0.5 rounded text-2xs font-extrabold ${
                                                            q.difficulty === 'EASY'
                                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                                : q.difficulty === 'MEDIUM'
                                                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                                                        }`}
                                                    >
                                                        {q.difficulty}
                                                    </span>
                                                </td>
                                                <td className="p-3 font-semibold text-slate-700">{q.maxMarks} pts</td>
                                                <td className="p-3 text-right">
                                                    <button
                                                        onClick={() => setPreviewQuestion(q)}
                                                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
                                                    >
                                                        <Eye className="h-3.5 w-3.5 inline mr-1" />
                                                        Preview
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    )}
                </div>
            )}

            {/* TAB 3: ASSESSMENT SCHEDULES */}
            {activeTab === 'SCHEDULES' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">Personalized Assessment Schedules</h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Active 16-week daily assessment schedules and student progress
                            </p>
                        </div>
                        <Button
                            variant="primary"
                            size="md"
                            onClick={() => setShowCreateModal(true)}
                        >
                            <Plus className="h-4 w-4 mr-1.5" />
                            <span>Create Assessment Schedule</span>
                        </Button>
                    </div>

                    {schedules.length === 0 ? (
                        <EmptyState
                            title="No Active Assessment Schedules"
                            description="Create a personalized assessment schedule for your course to activate continuous daily assessments."
                            icon={Calendar}
                        />
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                            {/* Schedule Selector */}
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    Schedules ({schedules.length})
                                </h3>
                                <div className="space-y-2">
                                    {schedules.map((sched) => (
                                        <button
                                            key={sched._id}
                                            onClick={() => {
                                                setSelectedSchedule(sched);
                                                loadScheduleProgress(sched._id);
                                            }}
                                            className={`w-full text-left p-4 rounded-xl border transition-all ${
                                                selectedSchedule?._id === sched._id
                                                    ? 'bg-brand-primary/5 border-brand-primary ring-1 ring-brand-primary'
                                                    : 'bg-white border-slate-200 hover:border-slate-300'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-700">
                                                    {sched.course?.courseCode || 'Course'}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                    {sched.status}
                                                </span>
                                            </div>
                                            <p className="text-sm font-bold text-slate-900 truncate">{sched.title}</p>
                                            <p className="text-xs text-slate-500 mt-1">
                                                {sched.enrolledStudents?.length || 0} Students • 100 Daily Questions
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Schedule Detail & Roster */}
                            <div className="lg:col-span-3 space-y-6">
                                {selectedSchedule && (
                                    <Card className="p-6 border-slate-200 space-y-6 bg-white">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                                            <div>
                                                <h3 className="text-lg font-bold text-slate-900">{selectedSchedule.title}</h3>
                                                <p className="text-xs text-slate-500 mt-1">
                                                    Start: {new Date(selectedSchedule.startDate).toLocaleDateString()} •
                                                    Daily Window: {selectedSchedule.dailyWindowStartTime} – {selectedSchedule.dailyWindowEndTime}
                                                </p>
                                            </div>
                                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                                Active Assessment Schedule
                                            </span>
                                        </div>

                                        {/* Progress Roster */}
                                        <div className="space-y-3">
                                            <h4 className="text-sm font-bold text-slate-800">
                                                Student Progress Overview ({progressData.length})
                                            </h4>
                                            {loadingProgress ? (
                                                <div className="py-8 text-center">
                                                    <LoadingSpinner size="sm" />
                                                </div>
                                            ) : progressData.length === 0 ? (
                                                <p className="text-xs text-slate-500">No student progress recorded yet.</p>
                                            ) : (
                                                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                                                    <table className="w-full text-left text-xs">
                                                        <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                                            <tr>
                                                                <th className="p-3">Student</th>
                                                                <th className="p-3">Completed</th>
                                                                <th className="p-3">Missed</th>
                                                                <th className="p-3">Progress</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {progressData.map((sp) => (
                                                                <tr key={sp.studentId} className="hover:bg-slate-50/50">
                                                                    <td className="p-3">
                                                                        <p className="font-bold text-slate-900">{sp.studentName}</p>
                                                                        <p className="text-2xs text-slate-400">{sp.studentEmail}</p>
                                                                    </td>
                                                                    <td className="p-3 font-semibold text-emerald-600">
                                                                        {sp.submittedCount} / 100
                                                                    </td>
                                                                    <td className="p-3 font-semibold text-rose-600">
                                                                        {sp.missedCount}
                                                                    </td>
                                                                    <td className="p-3">
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="w-24 bg-slate-100 h-2 rounded-full overflow-hidden">
                                                                                <div
                                                                                    className="bg-brand-primary h-2 rounded-full"
                                                                                    style={{ width: `${Math.min(sp.completionPercentage, 100)}%` }}
                                                                                />
                                                                            </div>
                                                                            <span className="font-bold text-slate-700">{sp.completionPercentage}%</span>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    </Card>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* MODAL: GENERATE QUESTIONS WITH AI */}
            {showGenerateModal && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <Card className="max-w-md w-full p-6 space-y-5 bg-white">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-900">
                                Generate Question Bank with AI
                            </h3>
                            <button
                                onClick={() => setShowGenerateModal(false)}
                                className="text-slate-400 hover:text-slate-600 font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                    Number of Questions to Generate
                                </label>
                                <input
                                    type="number"
                                    min={10}
                                    max={300}
                                    value={generateTargetCount}
                                    onChange={(e) => setGenerateTargetCount(Number(e.target.value))}
                                    className="w-full rounded-xl border border-slate-300 p-2.5 text-sm font-semibold"
                                />
                                <p className="text-2xs text-slate-400 mt-1">
                                    Recommended: At least {requiredPoolSize} questions for {enrolledCount} enrolled students.
                                </p>
                            </div>

                            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-900 space-y-1">
                                <p className="font-bold">Syllabus Grounding Rule:</p>
                                <p>• Generated questions are strictly grounded in the {syllabus?.units?.length || 0} extracted course units.</p>
                                <p>• Balanced across Easy, Medium, and Hard difficulty levels.</p>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                            <Button
                                variant="secondary"
                                size="md"
                                onClick={() => setShowGenerateModal(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                size="md"
                                onClick={handleGenerateQuestionBank}
                                disabled={generating}
                            >
                                <Sparkles className="h-4 w-4 mr-1.5" />
                                <span>{generating ? 'Generating Questions...' : 'Generate Questions'}</span>
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {/* MODAL: PREVIEW QUESTION */}
            {previewQuestion && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <Card className="max-w-xl w-full p-6 space-y-4 bg-white max-h-[85vh] overflow-y-auto">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <div>
                                <span className="text-2xs font-extrabold uppercase text-slate-400">
                                    Question {previewQuestion.questionIndex} • {previewQuestion.difficulty}
                                </span>
                                <h3 className="text-base font-bold text-slate-900">{previewQuestion.title}</h3>
                            </div>
                            <button
                                onClick={() => setPreviewQuestion(null)}
                                className="text-slate-400 hover:text-slate-600 font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div>
                                <p className="font-bold text-slate-700 uppercase mb-1">Topic / Unit</p>
                                <p className="text-slate-600">{previewQuestion.topic} ({previewQuestion.unit || 'General'})</p>
                            </div>

                            <div>
                                <p className="font-bold text-slate-700 uppercase mb-1">Question Prompt</p>
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 leading-relaxed whitespace-pre-wrap">
                                    {previewQuestion.questionPrompt}
                                </div>
                            </div>

                            {previewQuestion.hints && previewQuestion.hints.length > 0 && (
                                <div>
                                    <p className="font-bold text-slate-700 uppercase mb-1">Hints</p>
                                    <ul className="list-disc list-inside text-slate-600 space-y-1">
                                        {previewQuestion.hints.map((h, idx) => (
                                            <li key={idx}>{h}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {previewQuestion.rubricCriteria && previewQuestion.rubricCriteria.length > 0 && (
                                <div>
                                    <p className="font-bold text-slate-700 uppercase mb-1">Rubric Criteria ({previewQuestion.maxMarks} pts)</p>
                                    <div className="space-y-1.5">
                                        {previewQuestion.rubricCriteria.map((rc, idx) => (
                                            <div key={idx} className="flex justify-between p-2 bg-slate-50 border border-slate-100 rounded-lg">
                                                <span className="font-medium text-slate-700">{rc.criterionName}</span>
                                                <span className="font-bold text-slate-900">{rc.points} pts</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end pt-3 border-t border-slate-100">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setPreviewQuestion(null)}
                            >
                                Close
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {/* MODAL: CREATE SCHEDULE */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <Card className="max-w-lg w-full p-6 space-y-5 bg-white max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-900">
                                Configure Assessment Schedule
                            </h3>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="text-slate-400 hover:text-slate-600 font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleCreateSchedule} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                    Target Course
                                </label>
                                <select
                                    value={selectedCourseId}
                                    onChange={(e) => setSelectedCourseId(e.target.value)}
                                    className="w-full rounded-xl border border-slate-300 p-2.5 text-sm font-semibold"
                                    required
                                >
                                    {courses.map((c) => (
                                        <option key={c._id} value={c._id}>
                                            {c.courseCode} - {c.courseName} ({c.enrolledStudents?.length || 0} students)
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                    Schedule Title
                                </label>
                                <input
                                    type="text"
                                    value={scheduleTitle}
                                    onChange={(e) => setScheduleTitle(e.target.value)}
                                    placeholder="e.g. Monsoon 2026 Daily Assessment"
                                    className="w-full rounded-xl border border-slate-300 p-2.5 text-sm"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                        Start Date
                                    </label>
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="w-full rounded-xl border border-slate-300 p-2.5 text-sm"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                        Daily Window
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="time"
                                            value={startTime}
                                            onChange={(e) => setStartTime(e.target.value)}
                                            className="w-1/2 rounded-xl border border-slate-300 p-2 text-xs"
                                        />
                                        <span>–</span>
                                        <input
                                            type="time"
                                            value={endTime}
                                            onChange={(e) => setEndTime(e.target.value)}
                                            className="w-1/2 rounded-xl border border-slate-300 p-2 text-xs"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Pool Capacity Status */}
                            <div className={`p-3 rounded-xl border text-xs space-y-1 ${
                                isPoolSufficient
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                    : 'bg-amber-50 border-amber-200 text-amber-900'
                            }`}>
                                <p className="font-bold">Question Bank Capacity Status:</p>
                                <p>• Current question pool: <strong>{questions.length} questions</strong></p>
                                <p>• Enrolled cohort: <strong>{enrolledCount} students</strong> (Requires at least {requiredPoolSize} questions)</p>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                                <Button
                                    variant="secondary"
                                    size="md"
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="primary"
                                    size="md"
                                    type="submit"
                                    disabled={creating || !isPoolSufficient}
                                >
                                    <span>{creating ? 'Validating & Activating...' : 'Activate Assessment Schedule'}</span>
                                </Button>
                            </div>
                        </form>
                    </Card>
                </div>
            )}
        </div>
    );
}
