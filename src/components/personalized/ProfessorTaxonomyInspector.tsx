'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
    Sparkles,
    CheckCircle2,
    Clock,
    AlertCircle,
    Search,
    ChevronDown,
    ChevronUp,
    Plus,
    Compass,
    Share2,
    UploadCloud,
    FileText,
    XCircle,
    AlertTriangle,
    Check,
    X,
    Upload,
    FileSpreadsheet,
    Code,
    Info
} from 'lucide-react';
import { BulkPreviewResult } from '@/services/BulkQuestionImportService';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export interface TaxonomyQuestion {
    _id: string;
    questionIndex: number;
    title: string;
    topic: string;
    subtopic?: string;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    category?: string;
    questionType?: string;
    questionPrompt: string;
    options?: string[];
    correctOptionIndex?: number | null;
    explanation?: string | null;
    expectedConcepts?: string[];
    skills?: string[];
    learningObjectives?: string[];
    prerequisites?: string[];
    relatedConcepts?: string[];
    combinesConcepts?: string[];
    organizationStatus?: 'PENDING' | 'ORGANIZED' | 'MANUAL' | 'FAILED' | 'UNORGANIZED' | 'PENDING_REVIEW' | 'MANUALLY_OVERRIDDEN';
    estimatedMinutes?: number;
    maxMarks: number;
    hints?: string[];
}

export interface TaxonomySummary {
    topics: Array<{
        name: string;
        totalQuestions: number;
        subtopics: Array<{
            name: string;
            questionCount: number;
            difficultyCounts: {
                EASY: number;
                MEDIUM: number;
                HARD: number;
            };
            prerequisites: string[];
            relatedConcepts: string[];
        }>;
    }>;
}

export interface OrganizationProgress {
    status: 'IDLE' | 'ORGANIZING' | 'COMPLETED' | 'FAILED';
    totalToProcess: number;
    processedCount: number;
    currentTitle?: string;
    failures: Array<{ questionId: string; title?: string; error: string }>;
}

interface Props {
    courseId?: string;
    courseCode?: string;
    courseName?: string;
    onOpenGenerateModal?: () => void;
    initialQuestions?: TaxonomyQuestion[];
}

export function ProfessorTaxonomyInspector({
    courseId,
    courseCode = 'Course',
    courseName = 'Self-Paced Assessment',
    onOpenGenerateModal,
    initialQuestions
}: Props) {
    const [loading, setLoading] = useState(!initialQuestions);
    const [questions, setQuestions] = useState<TaxonomyQuestion[]>(initialQuestions || []);
    const [taxonomySummary, setTaxonomySummary] = useState<TaxonomySummary | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // AI Organization state & progress
    const [isOrganizing, setIsOrganizing] = useState(false);
    const [progress, setProgress] = useState<OrganizationProgress>({
        status: 'IDLE',
        totalToProcess: 0,
        processedCount: 0,
        failures: []
    });

    // Filters
    const [selectedTopic, setSelectedTopic] = useState('ALL');
    const [selectedDifficulty, setSelectedDifficulty] = useState('ALL');
    const [selectedStatus, setSelectedStatus] = useState('ALL');
    const [searchQuery, setSearchQuery] = useState('');

    // Expand card state
    const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);

    // Ingest / Add Question Modal
    const [showAddModal, setShowAddModal] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newTopic, setNewTopic] = useState('');
    const [newSubtopic, setNewSubtopic] = useState('');
    const [newDifficulty, setNewDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>('MEDIUM');
    const [newType, setNewType] = useState('CODING');
    const [newPrompt, setNewPrompt] = useState('');
    const [newHints, setNewHints] = useState('');
    const [isSavingQuestion, setIsSavingQuestion] = useState(false);

    // Bulk Add Questions Modal state
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkInputMode, setBulkInputMode] = useState<'FILE' | 'PASTE'>('FILE');
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkRawText, setBulkRawText] = useState('');
    const [bulkDefaultTopic, setBulkDefaultTopic] = useState('General');
    const [bulkPreviewResult, setBulkPreviewResult] = useState<BulkPreviewResult | null>(null);
    const [isValidatingBulk, setIsValidatingBulk] = useState(false);
    const [isImportingBulk, setIsImportingBulk] = useState(false);
    const [bulkModalError, setBulkModalError] = useState<string | null>(null);
    const [bulkModalSuccess, setBulkModalSuccess] = useState<string | null>(null);
    const [showSampleGuide, setShowSampleGuide] = useState(false);

    const loadData = async () => {
        if (!courseId) return;
        setLoading(true);
        setErrorMsg(null);
        try {
            const timestamp = Date.now();
            // 1. Fetch course questions
            const qRes = await fetch(`/api/personalized/questions?courseId=${courseId}&_t=${timestamp}`);
            const qJson = await qRes.json();
            if (qJson.success && Array.isArray(qJson.data)) {
                setQuestions(qJson.data);
            }

            // 2. Fetch taxonomy graph summary
            const taxRes = await fetch(`/api/personalized/taxonomy?courseId=${courseId}&_t=${timestamp}`);
            const taxJson = await taxRes.json();
            if (taxJson.success && taxJson.data) {
                setTaxonomySummary(taxJson.data);
            }
        } catch {
            setErrorMsg('Failed to load course taxonomy and questions.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let isMounted = true;
        const fetchData = async () => {
            if (!courseId) return;
            try {
                const timestamp = Date.now();
                const [qRes, taxRes] = await Promise.all([
                    fetch(`/api/personalized/questions?courseId=${courseId}&_t=${timestamp}`),
                    fetch(`/api/personalized/taxonomy?courseId=${courseId}&_t=${timestamp}`)
                ]);
                const [qJson, taxJson] = await Promise.all([qRes.json(), taxRes.json()]);
                if (isMounted) {
                    if (qJson.success && Array.isArray(qJson.data)) {
                        setQuestions(qJson.data);
                    }
                    if (taxJson.success && taxJson.data) {
                        setTaxonomySummary(taxJson.data);
                    }
                    setLoading(false);
                }
            } catch {
                if (isMounted) {
                    setErrorMsg('Failed to load course taxonomy and questions.');
                    setLoading(false);
                }
            }
        };
        fetchData();
        return () => {
            isMounted = false;
        };
    }, [courseId]);

    const handleOrganizeWithAI = async (forceReorganize = false) => {
        if (!courseId) return;

        let targetQuestions = forceReorganize
            ? questions
            : questions.filter((q) => q.organizationStatus !== 'ORGANIZED');

        if (targetQuestions.length === 0) {
            targetQuestions = questions;
        }

        if (targetQuestions.length === 0) {
            setErrorMsg('No questions available in this course to organize.');
            return;
        }

        setIsOrganizing(true);
        setErrorMsg(null);
        setSuccessMsg(null);
        setProgress({
            status: 'ORGANIZING',
            totalToProcess: targetQuestions.length,
            processedCount: 0,
            currentTitle: targetQuestions[0]?.title,
            failures: []
        });

        const failures: Array<{ questionId: string; title?: string; error: string }> = [];
        let organizedCount = 0;

        try {
            for (let i = 0; i < targetQuestions.length; i++) {
                const targetQ = targetQuestions[i];
                setProgress({
                    status: 'ORGANIZING',
                    totalToProcess: targetQuestions.length,
                    processedCount: i,
                    currentTitle: targetQ.title,
                    failures
                });

                try {
                    const res = await fetch('/api/personalized/questions/organize', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            courseId,
                            questionIds: [targetQ._id],
                            forceReorganize: true
                        })
                    });
                    const data = await res.json();

                    if (data.success && data.data) {
                        if (data.data.failures && data.data.failures.length > 0) {
                            const err = data.data.failures[0].error || 'Failed to organize';
                            failures.push({ questionId: targetQ._id, title: targetQ.title, error: err });
                        } else if (Array.isArray(data.data.questions) && data.data.questions.length > 0) {
                            const updatedQ = data.data.questions[0];
                            organizedCount++;
                            setQuestions((prev) =>
                                prev.map((q) => (q._id === updatedQ._id ? { ...q, ...updatedQ } : q))
                            );
                        }
                    } else {
                        failures.push({
                            questionId: targetQ._id,
                            title: targetQ.title,
                            error: data.message || 'Server error organizing question'
                        });
                    }
                } catch (netErr) {
                    failures.push({
                        questionId: targetQ._id,
                        title: targetQ.title,
                        error: netErr instanceof Error ? netErr.message : 'Network communication error'
                    });
                }
            }

            setProgress({
                status: failures.length > 0 && organizedCount === 0 ? 'FAILED' : 'COMPLETED',
                totalToProcess: targetQuestions.length,
                processedCount: targetQuestions.length,
                currentTitle: undefined,
                failures
            });

            if (failures.length === 0) {
                setSuccessMsg(`✓ Organization complete: ${organizedCount} questions organized with calibrated difficulty and AI taxonomy.`);
            } else if (organizedCount > 0) {
                setSuccessMsg(`✓ Organization complete: ${organizedCount} questions organized.`);
                setErrorMsg(`${failures.length} question(s) encountered issues and require review.`);
            } else {
                setErrorMsg(`Failed to organize ${failures.length} question(s). Please review errors.`);
            }

            await loadData();
        } catch {
            setErrorMsg('Unexpected error while running AI Question Organizer.');
            setProgress((prev) => ({ ...prev, status: 'FAILED' }));
        } finally {
            setIsOrganizing(false);
        }
    };

    const handleCreateQuestion = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!courseId || !newTitle || !newTopic || !newPrompt) return;

        setIsSavingQuestion(true);
        setErrorMsg(null);
        try {
            const parsedHints = newHints
                .split('\n')
                .map((h) => h.trim())
                .filter(Boolean);

            const res = await fetch('/api/personalized/questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    course: courseId,
                    questionIndex: questions.length + 1,
                    title: newTitle,
                    topic: newTopic,
                    subtopic: newSubtopic || undefined,
                    difficulty: newDifficulty,
                    questionType: newType,
                    questionPrompt: newPrompt,
                    hints: parsedHints,
                    maxMarks: 10
                })
            });
            const json = await res.json();
            if (json.success) {
                setSuccessMsg('Professor question created successfully! You can now organize it with AI.');
                setShowAddModal(false);
                setNewTitle('');
                setNewTopic('');
                setNewSubtopic('');
                setNewPrompt('');
                setNewHints('');
                await loadData();
            } else {
                setErrorMsg(json.message || 'Failed to create question.');
            }
        } catch {
            setErrorMsg('Error creating question.');
        } finally {
            setIsSavingQuestion(false);
        }
    };

    const handlePreviewBulk = async (overrideText?: string, overrideFile?: File) => {
        if (!courseId) return;
        setIsValidatingBulk(true);
        setBulkModalError(null);
        setBulkModalSuccess(null);
        setBulkPreviewResult(null);

        try {
            const activeFile = overrideFile !== undefined ? overrideFile : bulkFile;
            const activeText = overrideText !== undefined ? overrideText : bulkRawText;

            if (bulkInputMode === 'FILE' && activeFile) {
                const formData = new FormData();
                formData.append('file', activeFile);
                formData.append('courseId', courseId);
                formData.append('action', 'preview');
                formData.append('defaultTopic', bulkDefaultTopic || 'General');

                const res = await fetch('/api/personalized/questions/bulk', {
                    method: 'POST',
                    body: formData,
                });
                const data = await res.json();
                if (data.success && data.data) {
                    setBulkPreviewResult(data.data as BulkPreviewResult);
                } else {
                    setBulkModalError(data.message || 'Failed to preview questions from file.');
                }
            } else {
                if (!activeText.trim()) {
                    setBulkModalError('Please enter or paste JSON or CSV content to preview.');
                    setIsValidatingBulk(false);
                    return;
                }
                const res = await fetch('/api/personalized/questions/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        courseId,
                        action: 'preview',
                        content: activeText,
                        defaultTopic: bulkDefaultTopic || 'General',
                        filename: activeText.trim().startsWith('[') || activeText.trim().startsWith('{') ? 'input.json' : 'input.csv',
                    }),
                });
                const data = await res.json();
                if (data.success && data.data) {
                    setBulkPreviewResult(data.data as BulkPreviewResult);
                } else {
                    setBulkModalError(data.message || 'Failed to parse and validate questions.');
                }
            }
        } catch {
            setBulkModalError('Network error while analyzing questions.');
        } finally {
            setIsValidatingBulk(false);
        }
    };

    const handleConfirmBulkImport = async () => {
        if (!courseId || !bulkPreviewResult) return;
        const validItems = bulkPreviewResult.items.filter((item) => item.status === 'VALID');
        if (validItems.length === 0) {
            setBulkModalError('No valid questions available to import.');
            return;
        }

        setIsImportingBulk(true);
        setBulkModalError(null);
        setBulkModalSuccess(null);

        try {
            const res = await fetch('/api/personalized/questions/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId,
                    action: 'commit',
                    items: validItems,
                    defaultTopic: bulkDefaultTopic || 'General'
                }),
            });
            const data = await res.json();
            if (data.success) {
                const count = data.data?.importedCount || validItems.length;
                setBulkModalSuccess(
                    `Successfully imported ${count} questions! Initial organization status is PENDING. You can now organize them with AI.`
                );
                setSuccessMsg(
                    `Imported ${count} questions into course question bank. Ready for AI organization.`
                );
                await loadData();
            } else {
                setBulkModalError(data.message || 'Failed to import valid questions.');
            }
        } catch {
            setBulkModalError('Network error while importing questions.');
        } finally {
            setIsImportingBulk(false);
        }
    };

    const handleLoadSampleJson = () => {
        const sampleJson = JSON.stringify([
            {
                title: "Two Sum Problem",
                question: "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
                topic: "Arrays",
                subtopic: "Hash Maps",
                difficulty: "EASY",
                questionType: "CODING",
                category: "APPLICATION",
                options: ["O(N^2) brute force", "O(N) with Hash Map", "O(N log N) sorting", "O(1) space"],
                correctAnswer: 1,
                explanation: "Using a hash map allows O(1) complement lookup.",
                hints: ["Use a hash map to store each number and its index as you iterate."]
            },
            {
                title: "Valid Parentheses",
                question: "Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.",
                topic: "Stacks",
                subtopic: "Parentheses Matching",
                difficulty: "MEDIUM",
                questionType: "CODING",
                category: "APPLICATION",
                options: ["Stack matching opening brackets", "Queue FIFO processing", "Regex substitution only", "Binary search"],
                correctAnswer: 0,
                explanation: "Push opening brackets onto stack and pop to verify match with closing brackets.",
                hints: ["When encountering a closing bracket, check if it matches the top of the stack."]
            }
        ], null, 2);
        setBulkRawText(sampleJson);
        setBulkInputMode('PASTE');
        setBulkFile(null);
        handlePreviewBulk(sampleJson);
    };

    const handleLoadSampleCsv = () => {
        const sampleCsv = `title,prompt,topic,difficulty,optionA,optionB,optionC,optionD,correctAnswer,explanation
"Stack Operations","Which data structure operates on a Last-In First-Out (LIFO) basis?","Stacks","EASY","Queue","Stack","Linked List","Tree","Stack","A stack removes the most recently added item first."
"Binary Search Time Complexity","What is the worst-case time complexity of binary search on a sorted array of N elements?","Searching","MEDIUM","O(1)","O(log N)","O(N)","O(N log N)","O(log N)","Binary search cuts the search space in half each step."`;
        setBulkRawText(sampleCsv);
        setBulkInputMode('PASTE');
        setBulkFile(null);
        handlePreviewBulk(sampleCsv);
    };

    // Derived statistics
    const stats = useMemo(() => {
        const total = questions.length;
        const organized = questions.filter((q) => q.organizationStatus === 'ORGANIZED').length;
        const pending = total - organized;
        const multiConcept = questions.filter(
            (q) => Array.isArray(q.combinesConcepts) && q.combinesConcepts.length > 0
        ).length;
        const uniqueTopics = Array.from(new Set(questions.map((q) => q.topic).filter(Boolean)));
        const uniqueSubtopics = Array.from(new Set(questions.map((q) => q.subtopic).filter(Boolean)));

        return {
            total,
            organized,
            pending,
            multiConcept,
            uniqueTopicsCount: uniqueTopics.length,
            uniqueSubtopicsCount: uniqueSubtopics.length
        };
    }, [questions]);

    // Filtered questions
    const filteredQuestions = useMemo(() => {
        return questions.filter((q) => {
            if (selectedTopic !== 'ALL' && q.topic !== selectedTopic) return false;
            if (selectedDifficulty !== 'ALL' && q.difficulty !== selectedDifficulty) return false;
            if (selectedStatus === 'ORGANIZED' && q.organizationStatus !== 'ORGANIZED') return false;
            if (selectedStatus === 'PENDING' && q.organizationStatus === 'ORGANIZED') return false;
            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase();
                const matchTitle = q.title?.toLowerCase().includes(query);
                const matchTopic = q.topic?.toLowerCase().includes(query);
                const matchSubtopic = q.subtopic?.toLowerCase().includes(query);
                const matchSkills = q.skills?.some((s) => s.toLowerCase().includes(query));
                if (!matchTitle && !matchTopic && !matchSubtopic && !matchSkills) return false;
            }
            return true;
        });
    }, [questions, selectedTopic, selectedDifficulty, selectedStatus, searchQuery]);

    const availableTopics = useMemo(() => {
        return Array.from(new Set(questions.map((q) => q.topic).filter(Boolean)));
    }, [questions]);

    if (!courseId) {
        return (
            <Card className="p-8 text-center text-slate-500">
                Please select a course to inspect and organize its question bank.
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {/* Notifications */}
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

            {/* AI Organization Live Progress Area */}
            {progress.status === 'ORGANIZING' && (
                <Card className="p-5 bg-indigo-50/80 border-indigo-200 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <LoadingSpinner size="sm" />
                            <div>
                                <span className="text-sm font-black text-indigo-950 block">
                                    Organizing questions with AI...
                                </span>
                                <span className="text-2xs text-indigo-700">
                                    Inferring syllabus taxonomy, cognitive difficulty, skills, and concepts
                                </span>
                            </div>
                        </div>
                        <span className="font-mono text-sm font-black text-indigo-700">
                            {progress.totalToProcess > 0
                                ? `${Math.round((progress.processedCount / progress.totalToProcess) * 100)}%`
                                : '0%'}
                        </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-indigo-200/80 rounded-full h-3 overflow-hidden">
                        <div
                            className="bg-indigo-600 h-3 rounded-full transition-all duration-300 ease-out"
                            style={{
                                width: `${progress.totalToProcess > 0 ? (progress.processedCount / progress.totalToProcess) * 100 : 0}%`
                            }}
                        />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-2xs text-indigo-800 font-semibold">
                        <span>
                            Processed {progress.processedCount} of {progress.totalToProcess} questions
                        </span>
                        {progress.currentTitle && (
                            <span className="truncate max-w-md text-indigo-600 italic">
                                Analyzing: &ldquo;{progress.currentTitle}&rdquo;
                            </span>
                        )}
                    </div>
                </Card>
            )}

            {/* AI Organization Failures Review Card */}
            {progress.status === 'FAILED' && progress.failures.length > 0 && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-rose-900 text-sm">
                    <div className="flex items-center gap-2 font-bold text-rose-800">
                        <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
                        <span>{progress.failures.length} question(s) could not be organized. Review them below:</span>
                    </div>
                    <ul className="text-xs text-rose-700 list-disc list-inside space-y-1">
                        {progress.failures.map((f, idx) => (
                            <li key={idx}>
                                {f.title ? <span className="font-semibold">&ldquo;{f.title}&rdquo;: </span> : ''}
                                {f.error}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Workflow Separation: Clearly Distinct Workflows */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Workflow Option A: Generate Questions via AI */}
                <Card className="p-5 bg-gradient-to-br from-amber-50/60 via-white to-orange-50/30 border-amber-200/80 hover:border-amber-300 transition-all flex flex-col justify-between shadow-sm">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase bg-amber-100 text-amber-800 border border-amber-200">
                                Option A • AI Generator
                            </span>
                        </div>
                        <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-amber-600" />
                            <span>Generate Questions via AI</span>
                        </h3>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            Generate new syllabus-grounded questions across difficulty levels using Gemini AI from your semester syllabus modules.
                        </p>
                    </div>
                    <div className="pt-4 mt-3 border-t border-amber-100 flex items-center justify-between">
                        <span className="text-2xs font-semibold text-slate-500">
                            AI-Synthesized Bank
                        </span>
                        <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={() => onOpenGenerateModal ? onOpenGenerateModal() : null}
                            className="flex items-center gap-1.5 border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100 font-bold"
                        >
                            <Sparkles className="h-4 w-4 text-amber-600" />
                            <span>Generate Questions via AI</span>
                        </Button>
                    </div>
                </Card>

                {/* Workflow Option B: Upload Question Bank */}
                <Card className="p-5 bg-gradient-to-br from-indigo-50/60 via-white to-blue-50/30 border-indigo-200/80 hover:border-indigo-300 transition-all flex flex-col justify-between shadow-sm">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                                Option B • Professor Bank
                            </span>
                            {stats.pending > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase bg-amber-100 text-amber-800 border border-amber-200">
                                    {stats.pending} Needs Organization
                                </span>
                            )}
                        </div>
                        <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                            <UploadCloud className="h-4 w-4 text-indigo-600" />
                            <span>Upload Question Bank</span>
                        </h3>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            Upload a CSV or JSON containing raw professor questions. AI organizes each question into calibrated difficulties, topics, and skills.
                        </p>
                    </div>
                    <div className="pt-4 mt-3 border-t border-indigo-100 flex items-center justify-between">
                        <span className="text-2xs font-semibold text-slate-500">
                            Raw CSV &rarr; AI Taxonomy
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="primary"
                                size="sm"
                                type="button"
                                onClick={() => {
                                    setShowBulkModal(true);
                                    setBulkModalError(null);
                                    setBulkModalSuccess(null);
                                }}
                                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-sm"
                            >
                                <UploadCloud className="h-4 w-4" />
                                <span>Upload Question Bank</span>
                            </Button>
                            <Button
                                variant="primary"
                                size="sm"
                                type="button"
                                disabled={isOrganizing || stats.total === 0}
                                onClick={() => handleOrganizeWithAI(stats.pending === 0)}
                                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-sm"
                            >
                                <Sparkles className={`h-4 w-4 ${isOrganizing ? 'animate-spin' : ''}`} />
                                <span>{isOrganizing ? 'Organizing...' : stats.pending > 0 ? `Organize with AI (${stats.pending})` : 'Reorganize All'}</span>
                            </Button>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Header & Primary Actions */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {courseCode} • {courseName}
                        </span>
                        <h1 className="text-xl font-black text-slate-900">
                            Course Question Bank & AI Taxonomy
                        </h1>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                        Authoritative questions organized by AI into topics, subtopics, prerequisites, and calibrated difficulties.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-1.5"
                    >
                        <Plus className="h-4 w-4" />
                        <span>Add Question</span>
                    </Button>

                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                            setShowBulkModal(true);
                            setBulkModalError(null);
                            setBulkModalSuccess(null);
                        }}
                        className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-sm"
                    >
                        <UploadCloud className="h-4 w-4" />
                        <span>Upload Question Bank</span>
                    </Button>

                    <Button
                        variant="primary"
                        size="sm"
                        disabled={isOrganizing || stats.total === 0}
                        onClick={() => handleOrganizeWithAI(stats.pending === 0)}
                        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-sm"
                    >
                        <Sparkles className={`h-4 w-4 ${isOrganizing ? 'animate-spin' : ''}`} />
                        <span>{isOrganizing ? 'Organizing with AI...' : stats.pending > 0 ? `Organize with AI (${stats.pending})` : 'Reorganize All'}</span>
                    </Button>
                </div>
            </div>

            {/* Metric Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Card className="p-4 bg-white border-slate-200">
                    <p className="text-2xs font-extrabold uppercase text-slate-400">Total Questions</p>
                    <p className="text-2xl font-black text-slate-900 mt-1">{stats.total}</p>
                    <p className="text-2xs text-slate-500 mt-0.5">Authoritative bank</p>
                </Card>

                <Card className="p-4 bg-white border-slate-200">
                    <p className="text-2xs font-extrabold uppercase text-slate-400">AI Organized</p>
                    <p className="text-2xl font-black text-emerald-600 mt-1">{stats.organized}</p>
                    <p className="text-2xs text-slate-500 mt-0.5">
                        {stats.total > 0 ? Math.round((stats.organized / stats.total) * 100) : 0}% classified
                    </p>
                </Card>

                <Card className="p-4 bg-white border-slate-200">
                    <p className="text-2xs font-extrabold uppercase text-slate-400">Pending Review</p>
                    <p className="text-2xl font-black text-amber-600 mt-1">{stats.pending}</p>
                    <p className="text-2xs text-slate-500 mt-0.5">Needs classification</p>
                </Card>

                <Card className="p-4 bg-white border-slate-200">
                    <p className="text-2xs font-extrabold uppercase text-slate-400">Topics</p>
                    <p className="text-2xl font-black text-indigo-600 mt-1">{stats.uniqueTopicsCount}</p>
                    <p className="text-2xs text-slate-500 mt-0.5">{stats.uniqueSubtopicsCount} subtopics</p>
                </Card>

                <Card className="p-4 bg-white border-slate-200">
                    <p className="text-2xs font-extrabold uppercase text-slate-400">Multi-Concept</p>
                    <p className="text-2xl font-black text-purple-600 mt-1">{stats.multiConcept}</p>
                    <p className="text-2xs text-slate-500 mt-0.5">Cross-topic problems</p>
                </Card>

                <Card className="p-4 bg-white border-slate-200">
                    <p className="text-2xs font-extrabold uppercase text-slate-400">Self-Paced Ready</p>
                    <p className={`text-2xl font-black mt-1 ${stats.total >= 50 ? 'text-emerald-600' : 'text-amber-500'}`}>
                        {stats.total >= 50 ? '✓ Ready' : `${stats.total}/50+`}
                    </p>
                    <p className="text-2xs text-slate-500 mt-0.5">50+ benchmark</p>
                </Card>
            </div>

            {/* Class Learning & Taxonomy Overview */}
            {taxonomySummary && taxonomySummary.topics.length > 0 && (
                <Card className="p-5 bg-white border-slate-200 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                            <Compass className="h-5 w-5 text-indigo-600" />
                            <h3 className="font-bold text-slate-900 text-sm">Course Concept & Dependency Graph</h3>
                        </div>
                        <span className="text-xs font-semibold text-slate-500">
                            {taxonomySummary.topics.length} Syllabus Modules
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {taxonomySummary.topics.map((top) => (
                            <div
                                key={top.name}
                                className="p-3.5 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-indigo-200 transition-all space-y-2"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-slate-800 text-xs">{top.name}</span>
                                    <span className="text-2xs font-extrabold px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-700">
                                        {top.totalQuestions} questions
                                    </span>
                                </div>
                                <div className="space-y-1">
                                    {top.subtopics.map((sub) => (
                                        <div
                                            key={sub.name}
                                            className="flex items-center justify-between text-2xs text-slate-600 bg-white px-2.5 py-1 rounded border border-slate-100"
                                        >
                                            <span className="truncate max-w-[150px] font-medium">{sub.name}</span>
                                            <div className="flex items-center gap-1 font-mono text-3xs">
                                                <span className="text-emerald-600">{sub.difficultyCounts.EASY}E</span>
                                                <span className="text-amber-600">{sub.difficultyCounts.MEDIUM}M</span>
                                                <span className="text-rose-600">{sub.difficultyCounts.HARD}H</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Filter & Search Bar */}
            <Card className="p-4 bg-white border-slate-200 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Topic Filter */}
                    <div>
                        <label className="block text-2xs font-extrabold uppercase text-slate-400 mb-1">
                            Filter Topic
                        </label>
                        <select
                            value={selectedTopic}
                            onChange={(e) => setSelectedTopic(e.target.value)}
                            className="w-full text-xs rounded-lg border border-slate-200 bg-slate-50 p-2 font-medium text-slate-800"
                        >
                            <option value="ALL">All Topics ({stats.total})</option>
                            {availableTopics.map((top) => (
                                <option key={top} value={top}>
                                    {top}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Difficulty Filter */}
                    <div>
                        <label className="block text-2xs font-extrabold uppercase text-slate-400 mb-1">
                            Difficulty
                        </label>
                        <select
                            value={selectedDifficulty}
                            onChange={(e) => setSelectedDifficulty(e.target.value)}
                            className="w-full text-xs rounded-lg border border-slate-200 bg-slate-50 p-2 font-medium text-slate-800"
                        >
                            <option value="ALL">All Difficulties</option>
                            <option value="EASY">Easy</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HARD">Hard</option>
                        </select>
                    </div>

                    {/* Status Filter */}
                    <div>
                        <label className="block text-2xs font-extrabold uppercase text-slate-400 mb-1">
                            Organization Status
                        </label>
                        <select
                            value={selectedStatus}
                            onChange={(e) => setSelectedStatus(e.target.value)}
                            className="w-full text-xs rounded-lg border border-slate-200 bg-slate-50 p-2 font-medium text-slate-800"
                        >
                            <option value="ALL">All Statuses</option>
                            <option value="ORGANIZED">Organized ({stats.organized})</option>
                            <option value="PENDING">Pending Review ({stats.pending})</option>
                            <option value="FAILED">Failed ({questions.filter((q) => q.organizationStatus === 'FAILED').length})</option>
                        </select>
                    </div>

                    {/* Search query */}
                    <div>
                        <label className="block text-2xs font-extrabold uppercase text-slate-400 mb-1">
                            Search Concept / Title
                        </label>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search skills, topics, title..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 font-medium text-slate-800"
                            />
                        </div>
                    </div>
                </div>
            </Card>

            {/* Questions List */}
            {loading ? (
                <div className="py-12 flex justify-center">
                    <LoadingSpinner />
                </div>
            ) : filteredQuestions.length === 0 ? (
                <Card className="p-8 text-center text-slate-500">
                    No questions found matching the selected filters.
                </Card>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                        <span>Showing {filteredQuestions.length} of {questions.length} questions</span>
                    </div>

                    {filteredQuestions.map((q) => {
                        const isExpanded = expandedQuestionId === q._id;
                        const isOrganized = q.organizationStatus === 'ORGANIZED';

                        return (
                            <Card
                                key={q._id}
                                className={`p-4 border transition-all ${
                                    isExpanded ? 'border-indigo-300 shadow-sm' : 'border-slate-200 hover:border-slate-300'
                                }`}
                            >
                                <div
                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none"
                                    onClick={() => setExpandedQuestionId(isExpanded ? null : q._id)}
                                >
                                    <div className="space-y-1.5 flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-2xs font-extrabold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                                #{q.questionIndex}
                                            </span>

                                            {/* Organization Status Badge */}
                                            {isOrganized ? (
                                                <span className="flex items-center gap-1 text-3xs font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    Organized
                                                </span>
                                            ) : q.organizationStatus === 'FAILED' ? (
                                                <span className="flex items-center gap-1 text-3xs font-extrabold uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                                                    <AlertCircle className="h-3 w-3" />
                                                    Failed
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-3xs font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                                    <Clock className="h-3 w-3" />
                                                    Pending AI Review
                                                </span>
                                            )}

                                            {/* Topic & Subtopic */}
                                            <span className="text-2xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                                                {q.topic}
                                            </span>
                                            {q.subtopic && (
                                                <span className="text-2xs font-semibold text-slate-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                                    ↳ {q.subtopic}
                                                </span>
                                            )}

                                            {/* Difficulty Badge */}
                                            <span
                                                className={`text-3xs font-black uppercase px-2 py-0.5 rounded ${
                                                    q.difficulty === 'EASY'
                                                        ? 'bg-emerald-100 text-emerald-800'
                                                        : q.difficulty === 'MEDIUM'
                                                        ? 'bg-amber-100 text-amber-800'
                                                        : 'bg-rose-100 text-rose-800'
                                                }`}
                                            >
                                                {q.difficulty}
                                            </span>

                                            {/* Question Type / Category */}
                                            {q.questionType && (
                                                <span className="text-3xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                                    {q.questionType}
                                                </span>
                                            )}

                                            {/* Multi concept badge */}
                                            {q.combinesConcepts && q.combinesConcepts.length > 0 && (
                                                <span className="text-3xs font-bold px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                                                    <Share2 className="h-2.5 w-2.5" />
                                                    Multi-Concept
                                                </span>
                                            )}
                                        </div>

                                        <h4 className="font-bold text-slate-900 text-sm truncate">
                                            {q.title}
                                        </h4>
                                    </div>

                                    <div className="flex items-center gap-3 shrink-0">
                                        <button
                                            type="button"
                                            className="text-slate-400 hover:text-slate-600 p-1"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setExpandedQuestionId(isExpanded ? null : q._id);
                                            }}
                                        >
                                            {isExpanded ? (
                                                <ChevronUp className="h-5 w-5" />
                                            ) : (
                                                <ChevronDown className="h-5 w-5" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded Question Details */}
                                {isExpanded && (
                                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-4 text-xs">
                                        {/* Prompt */}
                                        <div>
                                            <p className="font-extrabold uppercase text-2xs text-slate-400 mb-1">
                                                Question Prompt
                                            </p>
                                            <div className="p-3 bg-slate-50 rounded-lg text-slate-800 font-mono whitespace-pre-wrap leading-relaxed">
                                                {q.questionPrompt}
                                            </div>
                                        </div>

                                        {/* Taxonomy Tags Grid */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 bg-indigo-50/40 p-3 rounded-xl border border-indigo-100">
                                            {/* Skills */}
                                            <div>
                                                <span className="text-3xs font-extrabold uppercase text-indigo-700 block mb-1">
                                                    Skills Covered
                                                </span>
                                                <div className="flex flex-wrap gap-1">
                                                    {q.skills && q.skills.length > 0 ? (
                                                        q.skills.map((s) => (
                                                            <span
                                                                key={s}
                                                                className="px-1.5 py-0.5 rounded text-3xs font-medium bg-white text-indigo-800 border border-indigo-200"
                                                            >
                                                                {s}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-3xs text-slate-400 italic">None tagged</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Prerequisites */}
                                            <div>
                                                <span className="text-3xs font-extrabold uppercase text-amber-700 block mb-1">
                                                    Prerequisites
                                                </span>
                                                <div className="flex flex-wrap gap-1">
                                                    {q.prerequisites && q.prerequisites.length > 0 ? (
                                                        q.prerequisites.map((p) => (
                                                            <span
                                                                key={p}
                                                                className="px-1.5 py-0.5 rounded text-3xs font-medium bg-white text-amber-800 border border-amber-200"
                                                            >
                                                                {p}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-3xs text-slate-400 italic">Foundational / None</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Related & Combines */}
                                            <div>
                                                <span className="text-3xs font-extrabold uppercase text-purple-700 block mb-1">
                                                    Connected Concepts
                                                </span>
                                                <div className="flex flex-wrap gap-1">
                                                    {q.combinesConcepts && q.combinesConcepts.length > 0 ? (
                                                        q.combinesConcepts.map((c) => (
                                                            <span
                                                                key={c}
                                                                className="px-1.5 py-0.5 rounded text-3xs font-medium bg-white text-purple-800 border border-purple-200"
                                                            >
                                                                {c}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-3xs text-slate-400 italic">Single-concept focus</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Progressive Hints */}
                                        {q.hints && q.hints.length > 0 && (
                                            <div>
                                                <p className="font-extrabold uppercase text-2xs text-slate-400 mb-1">
                                                    Progressive Hints ({q.hints.length})
                                                </p>
                                                <div className="space-y-1">
                                                    {q.hints.map((h, idx) => (
                                                        <div
                                                            key={idx}
                                                            className="text-2xs p-2 rounded bg-amber-50/60 border border-amber-100 text-amber-900 flex items-start gap-1.5"
                                                        >
                                                            <span className="font-bold">L{idx + 1}:</span>
                                                            <span>{h}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Modal: Add Professor Question */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
                    <Card className="w-full max-w-xl p-6 bg-white max-h-[90vh] overflow-y-auto space-y-4">
                        <div className="flex items-center justify-between border-b pb-3">
                            <h3 className="text-lg font-bold text-slate-900">Add Professor Question</h3>
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleCreateQuestion} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Question Title *
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    placeholder="e.g. Invert a Binary Tree Efficiently"
                                    className="w-full text-xs rounded-lg border border-slate-300 p-2.5"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Topic *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={newTopic}
                                        onChange={(e) => setNewTopic(e.target.value)}
                                        placeholder="e.g. Trees"
                                        className="w-full text-xs rounded-lg border border-slate-300 p-2.5"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Subtopic
                                    </label>
                                    <input
                                        type="text"
                                        value={newSubtopic}
                                        onChange={(e) => setNewSubtopic(e.target.value)}
                                        placeholder="e.g. Binary Tree Traversal"
                                        className="w-full text-xs rounded-lg border border-slate-300 p-2.5"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Difficulty
                                    </label>
                                    <select
                                        value={newDifficulty}
                                        onChange={(e) =>
                                            setNewDifficulty(e.target.value as 'EASY' | 'MEDIUM' | 'HARD')
                                        }
                                        className="w-full text-xs rounded-lg border border-slate-300 p-2.5"
                                    >
                                        <option value="EASY">EASY</option>
                                        <option value="MEDIUM">MEDIUM</option>
                                        <option value="HARD">HARD</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Question Type
                                    </label>
                                    <select
                                        value={newType}
                                        onChange={(e) => setNewType(e.target.value)}
                                        className="w-full text-xs rounded-lg border border-slate-300 p-2.5"
                                    >
                                        <option value="CODING">CODING</option>
                                        <option value="DEBUGGING">DEBUGGING</option>
                                        <option value="ANALYTICAL">ANALYTICAL</option>
                                        <option value="NUMERICAL">NUMERICAL</option>
                                        <option value="THEORY">THEORY</option>
                                        <option value="MULTI_CONCEPT">MULTI_CONCEPT</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Question Prompt / Code *
                                </label>
                                <textarea
                                    required
                                    rows={4}
                                    value={newPrompt}
                                    onChange={(e) => setNewPrompt(e.target.value)}
                                    placeholder="Write problem statement, code snippet, or theoretical question..."
                                    className="w-full text-xs font-mono rounded-lg border border-slate-300 p-2.5"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Progressive Hints (one per line)
                                </label>
                                <textarea
                                    rows={3}
                                    value={newHints}
                                    onChange={(e) => setNewHints(e.target.value)}
                                    placeholder="Hint 1: Conceptual reminder&#10;Hint 2: Approach strategy&#10;Hint 3: Edge case reminder"
                                    className="w-full text-xs rounded-lg border border-slate-300 p-2.5"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    type="submit"
                                    disabled={isSavingQuestion}
                                >
                                    {isSavingQuestion ? 'Saving Question...' : 'Save Question'}
                                </Button>
                            </div>
                        </form>
                    </Card>
                </div>
            )}

            {/* Bulk Add Questions Modal */}
            {showBulkModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <Card className="w-full max-w-4xl bg-white shadow-2xl rounded-2xl max-h-[92vh] flex flex-col border border-slate-200 overflow-hidden">
                        {/* Modal Header */}
                        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700">
                                    <UploadCloud className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-lg font-black text-slate-900">Bulk Add Questions</h2>
                                        <span className="text-2xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                                            .JSON • .CSV
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500">
                                        Import questions from JSON or CSV. Preview and validate rows before committing. Newly imported questions start as <span className="font-semibold text-slate-700">PENDING</span> organization.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowBulkModal(false);
                                    setBulkPreviewResult(null);
                                    setBulkModalError(null);
                                    setBulkModalSuccess(null);
                                }}
                                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto space-y-6 flex-1">
                            {/* Alerts */}
                            {bulkModalError && (
                                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-800 text-sm">
                                    <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold">Import Warning</p>
                                        <p className="text-xs mt-0.5 text-rose-700">{bulkModalError}</p>
                                    </div>
                                </div>
                            )}

                            {bulkModalSuccess && (
                                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-emerald-800 text-sm">
                                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold">Questions Imported Successfully</p>
                                        <p className="text-xs mt-0.5 text-emerald-700">{bulkModalSuccess}</p>
                                    </div>
                                </div>
                            )}

                            {/* Format Guide & Templates Accordion */}
                            <div className="border border-slate-200 rounded-xl bg-slate-50/50 p-3.5">
                                <div className="flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setShowSampleGuide(!showSampleGuide)}
                                        className="flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-indigo-600 transition"
                                    >
                                        <Info className="h-4 w-4 text-indigo-500" />
                                        <span>Supported Formats & Field Guide</span>
                                        {showSampleGuide ? (
                                            <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                                        ) : (
                                            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                                        )}
                                    </button>

                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            type="button"
                                            onClick={handleLoadSampleJson}
                                            className="text-2xs py-1 px-2.5 h-auto bg-white border-slate-200"
                                        >
                                            <Code className="h-3.5 w-3.5 mr-1 text-slate-500" />
                                            Load Sample JSON
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            type="button"
                                            onClick={handleLoadSampleCsv}
                                            className="text-2xs py-1 px-2.5 h-auto bg-white border-slate-200"
                                        >
                                            <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-slate-500" />
                                            Load Sample CSV
                                        </Button>
                                    </div>
                                </div>

                                {showSampleGuide && (
                                    <div className="mt-3 pt-3 border-t border-slate-200 space-y-3 text-xs text-slate-600">
                                        <p>
                                            You do <span className="font-bold text-slate-800">not</span> need to supply AI metadata such as prerequisites, skills, or subtopics upfront. After importing, click <span className="font-semibold text-indigo-600">&quot;Organize with AI&quot;</span> to populate them.
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="bg-white p-3 rounded-lg border border-slate-200">
                                                <p className="font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                                                    <Code className="h-3.5 w-3.5 text-indigo-500" /> JSON Format (.json)
                                                </p>
                                                <pre className="text-2xs bg-slate-900 text-slate-100 p-2.5 rounded font-mono overflow-x-auto">
{`[
  {
    "title": "Reverse Linked List",
    "prompt": "How to reverse a list in-place?",
    "topic": "Linked Lists",
    "difficulty": "MEDIUM",
    "questionType": "CODING",
    "options": ["O(1) space", "O(N) space"],
    "correctAnswer": 0,
    "explanation": "Pointers can be reversed in O(1) space.",
    "hints": ["Use three pointers: prev, curr, next"]
  }
]`}
                                                </pre>
                                            </div>

                                            <div className="bg-white p-3 rounded-lg border border-slate-200">
                                                <p className="font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                                                    <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" /> CSV Format (.csv)
                                                </p>
                                                <pre className="text-2xs bg-slate-900 text-slate-100 p-2.5 rounded font-mono overflow-x-auto">
{`title,prompt,topic,difficulty,optionA,optionB,optionC,optionD,correctAnswer,explanation
"Stack LIFO","Which structure is LIFO?","Stacks","EASY","Queue","Stack","Tree","Graph","Stack","LIFO removes latest"`}
                                                </pre>
                                                <p className="text-2xs text-slate-500 mt-1">
                                                    * Options can be discrete columns (<code>optionA..D</code>) or pipe-delimited (<code>options: &quot;A | B | C&quot;</code>).
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Input Mode Selector */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setBulkInputMode('FILE');
                                            setBulkModalError(null);
                                        }}
                                        className={`text-xs font-bold pb-2 -mb-2 border-b-2 flex items-center gap-1.5 transition ${
                                            bulkInputMode === 'FILE'
                                                ? 'border-indigo-600 text-indigo-600'
                                                : 'border-transparent text-slate-500 hover:text-slate-700'
                                        }`}
                                    >
                                        <Upload className="h-3.5 w-3.5" />
                                        Upload File (.json, .csv)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setBulkInputMode('PASTE');
                                            setBulkModalError(null);
                                        }}
                                        className={`text-xs font-bold pb-2 -mb-2 border-b-2 flex items-center gap-1.5 transition ${
                                            bulkInputMode === 'PASTE'
                                                ? 'border-indigo-600 text-indigo-600'
                                                : 'border-transparent text-slate-500 hover:text-slate-700'
                                        }`}
                                    >
                                        <FileText className="h-3.5 w-3.5" />
                                        Paste JSON or CSV Content
                                    </button>
                                </div>

                                {/* Default Topic setting */}
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                    <div className="flex-1">
                                        <label className="block text-2xs font-extrabold uppercase text-slate-500 mb-1">
                                            Default Topic Fallback
                                        </label>
                                        <input
                                            type="text"
                                            value={bulkDefaultTopic}
                                            onChange={(e) => setBulkDefaultTopic(e.target.value)}
                                            placeholder="Used if question does not specify a topic (e.g. General, Data Structures)"
                                            className="w-full text-xs rounded-lg border border-slate-300 p-2.5 bg-slate-50/50"
                                        />
                                    </div>
                                </div>

                                {/* Mode 1: File dropzone */}
                                {bulkInputMode === 'FILE' ? (
                                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-indigo-400 transition bg-slate-50/40">
                                        <input
                                            type="file"
                                            id="bulk-question-file-input"
                                            accept=".json,.csv,application/json,text/csv,text/plain"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0] || null;
                                                setBulkFile(file);
                                                setBulkPreviewResult(null);
                                                setBulkModalError(null);
                                                if (file) {
                                                    handlePreviewBulk(undefined, file);
                                                }
                                            }}
                                            className="hidden"
                                        />
                                        <label
                                            htmlFor="bulk-question-file-input"
                                            className="cursor-pointer flex flex-col items-center justify-center"
                                        >
                                            <div className="h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2">
                                                <UploadCloud className="h-6 w-6" />
                                            </div>
                                            <p className="text-sm font-bold text-slate-800">
                                                {bulkFile ? bulkFile.name : 'Click to select or drag & drop questions file'}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-1">
                                                {bulkFile
                                                    ? `${(bulkFile.size / 1024).toFixed(1)} KB • Click to change file`
                                                    : 'Accepts .json (array of questions) or .csv'}
                                            </p>
                                        </label>
                                    </div>
                                ) : (
                                    /* Mode 2: Paste content */
                                    <div>
                                        <label className="block text-2xs font-extrabold uppercase text-slate-500 mb-1">
                                            Raw JSON Array or CSV Text
                                        </label>
                                        <textarea
                                            rows={7}
                                            value={bulkRawText}
                                            onChange={(e) => {
                                                setBulkRawText(e.target.value);
                                                setBulkPreviewResult(null);
                                            }}
                                            placeholder='Paste JSON array e.g. [{"title": "...", "question": "..."}] or CSV rows with headers...'
                                            className="w-full text-xs font-mono rounded-lg border border-slate-300 p-2.5"
                                        />
                                    </div>
                                )}

                                <div className="flex justify-end">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        type="button"
                                        disabled={isValidatingBulk || (bulkInputMode === 'FILE' && !bulkFile) || (bulkInputMode === 'PASTE' && !bulkRawText.trim())}
                                        onClick={() => handlePreviewBulk()}
                                        className="flex items-center gap-1.5"
                                    >
                                        {isValidatingBulk ? (
                                            <>
                                                <LoadingSpinner size="sm" />
                                                <span>Validating...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Search className="h-4 w-4" />
                                                <span>Validate & Preview Questions</span>
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>

                            {/* Preview & Validation Results Section */}
                            {bulkPreviewResult && (
                                <div className="space-y-4 pt-4 border-t border-slate-200 animate-in fade-in">
                                    {/* Import Summary Bar */}
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-900">
                                                    Import Summary: {bulkPreviewResult.totalFound} questions found
                                                </h3>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    Check rows below. Only valid and non-duplicate questions will be imported.
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-100 text-emerald-800 flex items-center gap-1 border border-emerald-200">
                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                    {bulkPreviewResult.validCount} Valid
                                                </span>
                                                {bulkPreviewResult.invalidCount > 0 && (
                                                    <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-rose-100 text-rose-800 flex items-center gap-1 border border-rose-200">
                                                        <XCircle className="h-3.5 w-3.5" />
                                                        {bulkPreviewResult.invalidCount} Invalid
                                                    </span>
                                                )}
                                                {bulkPreviewResult.duplicateCount > 0 && (
                                                    <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-amber-100 text-amber-800 flex items-center gap-1 border border-amber-200">
                                                        <AlertTriangle className="h-3.5 w-3.5" />
                                                        {bulkPreviewResult.duplicateCount} Duplicate
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Questions Preview List */}
                                    <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                                        {bulkPreviewResult.items.map((item, idx) => (
                                            <div
                                                key={idx}
                                                className={`p-3.5 rounded-xl border text-xs transition ${
                                                    item.status === 'VALID'
                                                        ? 'bg-white border-slate-200 hover:border-slate-300'
                                                        : item.status === 'DUPLICATE'
                                                        ? 'bg-amber-50/40 border-amber-200'
                                                        : 'bg-rose-50/40 border-rose-200'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                                                        <span className="text-2xs font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                                                            #{item.rowNumber}
                                                        </span>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="font-bold text-slate-900 truncate">
                                                                    {item.title || '(Untitled Question)'}
                                                                </span>
                                                                <span className="text-2xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                                                                    {item.topic}
                                                                </span>
                                                                <span
                                                                    className={`text-2xs px-1.5 py-0.5 rounded font-bold ${
                                                                        item.difficulty === 'EASY'
                                                                            ? 'bg-emerald-100 text-emerald-800'
                                                                            : item.difficulty === 'MEDIUM'
                                                                            ? 'bg-amber-100 text-amber-800'
                                                                            : 'bg-rose-100 text-rose-800'
                                                                    }`}
                                                                >
                                                                    {item.difficulty}
                                                                </span>
                                                                {item.questionType && (
                                                                    <span className="text-2xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">
                                                                        {item.questionType}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-slate-600 line-clamp-2 mt-1 font-mono text-2xs bg-slate-50/70 p-1.5 rounded border border-slate-100">
                                                                {item.questionPrompt || '(Empty question prompt)'}
                                                            </p>
                                                            {item.options && item.options.length > 0 && (
                                                                <p className="text-2xs text-slate-400 mt-1">
                                                                    Options: {item.options.length} {item.correctOptionIndex !== null ? `(Correct: Option ${item.correctOptionIndex + 1})` : ''}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Status Badge */}
                                                    <div className="shrink-0">
                                                        {item.status === 'VALID' && (
                                                            <span className="px-2 py-0.5 rounded-full text-2xs font-black bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                                                                <Check className="h-3 w-3" />
                                                                VALID
                                                            </span>
                                                        )}
                                                        {item.status === 'DUPLICATE' && (
                                                            <span className="px-2 py-0.5 rounded-full text-2xs font-black bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                                                                <AlertTriangle className="h-3 w-3" />
                                                                DUPLICATE
                                                            </span>
                                                        )}
                                                        {item.status === 'INVALID' && (
                                                            <span className="px-2 py-0.5 rounded-full text-2xs font-black bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1">
                                                                <XCircle className="h-3 w-3" />
                                                                INVALID
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Error list for invalid items */}
                                                {item.errors.length > 0 && (
                                                    <div className="mt-2.5 pt-2 border-t border-rose-200/80 text-rose-700 text-2xs space-y-0.5">
                                                        {item.errors.map((err, eIdx) => (
                                                            <p key={eIdx} className="flex items-center gap-1.5 font-medium">
                                                                <span className="h-1 w-1 rounded-full bg-rose-600 shrink-0" />
                                                                {err}
                                                            </p>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
                            <div className="text-2xs text-slate-500">
                                {bulkPreviewResult ? (
                                    <span>
                                        {bulkPreviewResult.validCount} ready to import • Status will be initialized to{' '}
                                        <span className="font-bold text-slate-700">PENDING</span>
                                    </span>
                                ) : (
                                    <span>Upload or paste questions to validate first</span>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    type="button"
                                    onClick={() => {
                                        setShowBulkModal(false);
                                        setBulkPreviewResult(null);
                                        setBulkModalError(null);
                                        setBulkModalSuccess(null);
                                    }}
                                >
                                    Cancel
                                </Button>
                                {bulkPreviewResult && (
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        type="button"
                                        disabled={isImportingBulk || bulkPreviewResult.validCount === 0}
                                        onClick={handleConfirmBulkImport}
                                        className="flex items-center gap-1.5"
                                    >
                                        {isImportingBulk ? (
                                            <>
                                                <LoadingSpinner size="sm" />
                                                <span>Importing Questions...</span>
                                            </>
                                        ) : (
                                            <>
                                                <UploadCloud className="h-4 w-4" />
                                                <span>Confirm Import ({bulkPreviewResult.validCount} Valid Questions)</span>
                                            </>
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
