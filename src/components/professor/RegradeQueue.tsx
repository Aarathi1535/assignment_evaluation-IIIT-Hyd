'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DashboardLayout } from '@/components/ui/DashboardLayout';

type RequestStatus = 'OPEN' | 'REVIEWING' | 'RESOLVED';
type DecisionOutcome = 'APPROVED' | 'REJECTED';

interface QueueItem {
    id: string;
    exam: { id: string; title: string };
    answerScriptId: string;
    questionNumber: number;
    student: { id: string; name: string; email: string };
    reason: string;
    status: RequestStatus;
    createdAt: string;
    assignedTo: null | { id: string; name: string; email: string };
    canManageAssignment: boolean;
    reviewers: Array<{ _id: string; name: string; email: string; role: string }>;
    decision: null | {
        outcome: DecisionOutcome;
        reason: string;
        originalScore: number;
        revisedScore?: number;
        decidedAt: string;
    };
    evaluation: null | {
        score: number;
        maxMarks: number | null;
        feedback: string;
        criteria: Array<{ name: string; score: number; feedback: string }>;
    };
}

interface ScriptPage {
    id: string;
    pageNumber: number;
    imageUrl: string;
    width?: number;
    height?: number;
}

interface QueueResponse {
    requests: QueueItem[];
    page: number;
    totalPages: number;
    total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export default function RegradeQueue({ reviewerOnly = false }: { reviewerOnly?: boolean }) {
    const [result, setResult] = useState<QueueResponse | null>(null);
    const [status, setStatus] = useState<'ALL' | RequestStatus>('ALL');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedId, setExpandedId] = useState('');
    const [scriptPages, setScriptPages] = useState<Record<string, ScriptPage[]>>({});
    const [pageErrors, setPageErrors] = useState<Record<string, string>>({});
    const [loadingPages, setLoadingPages] = useState('');
    const [decisionReason, setDecisionReason] = useState('');
    const [revisedScore, setRevisedScore] = useState('');
    const [decisionError, setDecisionError] = useState('');
    const [savingDecision, setSavingDecision] = useState(false);
    const [selectedAssignments, setSelectedAssignments] = useState<Record<string, string>>({});
    const [assignmentErrors, setAssignmentErrors] = useState<Record<string, string>>({});
    const [savingAssignment, setSavingAssignment] = useState('');

    const loadRequests = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const query = new URLSearchParams({ page: String(page), limit: '20' });
            if (status !== 'ALL') query.set('status', status);
            const response = await fetch(`/api/professor/regrade-requests?${query}`, { cache: 'no-store' });
            const payload: unknown = await response.json();
            if (!response.ok || !isRecord(payload) || payload.success !== true ||
                !isRecord(payload.data) || !Array.isArray(payload.data.requests)) {
                throw new Error(isRecord(payload) && typeof payload.message === 'string'
                    ? payload.message : 'Could not load regrade requests.');
            }
            setResult(payload.data as unknown as QueueResponse);
        } catch (cause) {
            setResult(null);
            setError(cause instanceof Error ? cause.message : 'Could not load regrade requests.');
        } finally {
            setLoading(false);
        }
    }, [page, status]);

    useEffect(() => { void loadRequests(); }, [loadRequests]);

    const toggleDetails = async (item: QueueItem) => {
        if (expandedId === item.id) {
            setExpandedId('');
            return;
        }
        setExpandedId(item.id);
        setDecisionReason('');
        setRevisedScore('');
        setDecisionError('');
        if (scriptPages[item.answerScriptId]) return;

        setLoadingPages(item.id);
        setPageErrors(current => ({ ...current, [item.id]: '' }));
        try {
            const response = await fetch(`/api/scripts/${item.answerScriptId}/pages`, { cache: 'no-store' });
            const payload: unknown = await response.json();
            if (!response.ok || !isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
                throw new Error(isRecord(payload) && typeof payload.message === 'string'
                    ? payload.message : 'Could not load the submitted answer.');
            }
            const pages = payload.data as ScriptPage[];
            setScriptPages(current => ({ ...current, [item.answerScriptId]: pages }));
        } catch (cause) {
            setPageErrors(current => ({
                ...current,
                [item.id]: cause instanceof Error ? cause.message : 'Could not load the submitted answer.'
            }));
        } finally {
            setLoadingPages('');
        }
    };

    const decide = async (item: QueueItem, outcome: DecisionOutcome) => {
        if (!decisionReason.trim()) {
            setDecisionError('A decision reason is required.');
            return;
        }
        const score = revisedScore.trim() === '' ? undefined : Number(revisedScore);
        if (outcome === 'APPROVED' && score !== undefined && !Number.isFinite(score)) {
            setDecisionError('Enter a valid revised score.');
            return;
        }

        setSavingDecision(true);
        setDecisionError('');
        try {
            const response = await fetch(`/api/professor/regrade-requests/${item.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    outcome,
                    reason: decisionReason,
                    ...(outcome === 'APPROVED' && score !== undefined ? { revisedScore: score } : {})
                })
            });
            const payload: unknown = await response.json();
            if (!response.ok || !isRecord(payload) || payload.success !== true) {
                throw new Error(isRecord(payload) && typeof payload.message === 'string'
                    ? payload.message : 'Could not save the decision.');
            }
            await loadRequests();
        } catch (cause) {
            setDecisionError(cause instanceof Error ? cause.message : 'Could not save the decision.');
        } finally {
            setSavingDecision(false);
        }
    };

    const assignReviewer = async (item: QueueItem) => {
        setSavingAssignment(item.id);
        setAssignmentErrors(current => ({ ...current, [item.id]: '' }));
        try {
            const response = await fetch(`/api/professor/regrade-requests/${item.id}/assignment`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reviewerId: selectedAssignments[item.id] ?? item.assignedTo?.id ?? '' })
            });
            const payload: unknown = await response.json();
            if (!response.ok || !isRecord(payload) || payload.success !== true) {
                throw new Error(isRecord(payload) && typeof payload.message === 'string'
                    ? payload.message : 'Could not assign the reviewer.');
            }
            setSelectedAssignments(current => {
                const next = { ...current };
                delete next[item.id];
                return next;
            });
            await loadRequests();
        } catch (cause) {
            setAssignmentErrors(current => ({
                ...current,
                [item.id]: cause instanceof Error ? cause.message : 'Could not assign the reviewer.'
            }));
        } finally {
            setSavingAssignment('');
        }
    };

    return (
        <DashboardLayout
            title="Regrade requests"
            description={reviewerOnly ? 'Review regrade requests assigned to you.' : 'Review student requests for exams you own.'}
            quickActions={
                <Link href={reviewerOnly ? '/ta' : '/professor'}>
                    <Button variant="outline" size="md"><ArrowLeft className="h-4 w-4" />Dashboard</Button>
                </Link>
            }
        >
            <section aria-label="Regrade request queue" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        Status
                        <select
                            value={status}
                            onChange={event => { setStatus(event.target.value as typeof status); setPage(1); }}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2"
                        >
                            <option value="ALL">All requests</option>
                            <option value="OPEN">Open</option>
                            <option value="REVIEWING">Reviewing</option>
                            <option value="RESOLVED">Resolved</option>
                        </select>
                    </label>
                    <Button variant="outline" size="sm" onClick={() => void loadRequests()} disabled={loading}>
                        <RefreshCw className="h-4 w-4" />Refresh
                    </Button>
                </div>

                {loading && <p role="status" className="rounded-lg border bg-white p-4 text-slate-600">Loading regrade requests…</p>}
                {error && (
                    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
                        <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</span>
                        <Button variant="outline" size="sm" onClick={() => void loadRequests()}>Retry</Button>
                    </div>
                )}
                {!loading && !error && result?.requests.length === 0 && (
                    <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">No regrade requests to review.</p>
                )}
                {!loading && !error && result && result.requests.length > 0 && (
                    <>
                        <ul className="space-y-3">
                            {result.requests.map(item => (
                                <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                                    <button
                                        type="button"
                                        className="flex w-full items-start justify-between gap-3 text-left"
                                        aria-expanded={expandedId === item.id}
                                        onClick={() => void toggleDetails(item)}
                                    >
                                        <span>
                                            <span className="block font-semibold text-slate-900">{item.exam.title} · Question {item.questionNumber}</span>
                                            <span className="mt-1 block text-sm text-slate-700">{item.student.name} ({item.student.email})</span>
                                            <span className="mt-1 block text-sm text-slate-600">{item.reason}</span>
                                        </span>
                                        <span className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
                                            {item.status}
                                            {expandedId === item.id ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                                        </span>
                                    </button>
                                    {item.canManageAssignment && item.status !== 'RESOLVED' && (
                                        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                                            <label className="min-w-60 text-sm font-medium text-slate-700">
                                                Reviewer
                                                <select
                                                    aria-label={`Reviewer for ${item.exam.title}, question ${item.questionNumber}`}
                                                    value={selectedAssignments[item.id] ?? item.assignedTo?.id ?? ''}
                                                    onChange={event => setSelectedAssignments(current => ({
                                                        ...current,
                                                        [item.id]: event.target.value
                                                    }))}
                                                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                                                >
                                                    <option value="">Unassigned</option>
                                                    {item.reviewers.map(reviewer => (
                                                        <option key={reviewer._id} value={reviewer._id}>
                                                            {reviewer.name} ({reviewer.role})
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={savingAssignment === item.id}
                                                onClick={() => void assignReviewer(item)}
                                            >
                                                {savingAssignment === item.id ? 'Saving…' : 'Assign reviewer'}
                                            </Button>
                                            {assignmentErrors[item.id] && <p role="alert" className="basis-full text-sm text-rose-700">{assignmentErrors[item.id]}</p>}
                                        </div>
                                    )}
                                    {expandedId === item.id && (
                                        <div className="mt-4 border-t border-slate-200 pt-4">
                                            <h2 className="font-semibold text-slate-900">Existing evaluation</h2>
                                            {item.evaluation ? (
                                                <div className="mt-2 text-sm text-slate-700">
                                                    <p>Score: {item.evaluation.score}{item.evaluation.maxMarks === null ? '' : ` / ${item.evaluation.maxMarks}`}</p>
                                                    {item.evaluation.feedback && <p className="mt-1">{item.evaluation.feedback}</p>}
                                                    {item.evaluation.criteria.length > 0 && (
                                                        <ul className="mt-2 list-disc pl-5">
                                                            {item.evaluation.criteria.map((criterion, index) => (
                                                                <li key={`${criterion.name}-${index}`}>{criterion.name}: {criterion.score}{criterion.feedback ? ` — ${criterion.feedback}` : ''}</li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            ) : <p className="mt-2 text-sm text-slate-600">No finalized evaluation is available.</p>}

                                            {item.decision ? (
                                                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                                                    <p className="font-semibold">{item.decision.outcome} · {item.decision.originalScore} → {item.decision.revisedScore ?? item.decision.originalScore}</p>
                                                    <p className="mt-1">{item.decision.reason}</p>
                                                </div>
                                            ) : (
                                                <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                                    <h2 className="font-semibold text-slate-900">Record a decision</h2>
                                                    <label className="block text-sm font-medium text-slate-700">
                                                        Decision reason
                                                        <textarea
                                                            required
                                                            maxLength={2000}
                                                            value={decisionReason}
                                                            onChange={event => setDecisionReason(event.target.value)}
                                                            className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-2"
                                                            rows={3}
                                                        />
                                                    </label>
                                                    <label className="block text-sm font-medium text-slate-700">
                                                        Revised score (optional)
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max={item.evaluation?.maxMarks ?? undefined}
                                                            step="any"
                                                            value={revisedScore}
                                                            onChange={event => setRevisedScore(event.target.value)}
                                                            className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-2"
                                                        />
                                                    </label>
                                                    {decisionError && <p role="alert" className="text-sm text-rose-700">{decisionError}</p>}
                                                    <div className="flex flex-wrap gap-2">
                                                        <Button variant="primary" size="sm" disabled={savingDecision} onClick={() => void decide(item, 'APPROVED')}>
                                                            {savingDecision ? 'Saving…' : 'Approve'}
                                                        </Button>
                                                        <Button variant="outline" size="sm" disabled={savingDecision} onClick={() => void decide(item, 'REJECTED')}>
                                                            Reject
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}

                                            <h2 className="mt-5 font-semibold text-slate-900">Original submitted answer</h2>
                                            {loadingPages === item.id && <p role="status" className="mt-2 text-sm text-slate-600">Loading answer pages…</p>}
                                            {pageErrors[item.id] && <p role="alert" className="mt-2 text-sm text-rose-700">{pageErrors[item.id]}</p>}
                                            {scriptPages[item.answerScriptId]?.length === 0 && (
                                                <p className="mt-2 text-sm text-slate-600">No answer pages are available.</p>
                                            )}
                                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                {(scriptPages[item.answerScriptId] || []).map(answerPage => (
                                                    <figure key={answerPage.id} className="overflow-hidden rounded-lg border border-slate-200">
                                                        <Image
                                                            src={answerPage.imageUrl}
                                                            alt={`Submitted answer page ${answerPage.pageNumber}`}
                                                            width={answerPage.width || 900}
                                                            height={answerPage.height || 1200}
                                                            unoptimized
                                                            className="h-auto w-full"
                                                        />
                                                        <figcaption className="border-t bg-slate-50 px-3 py-2 text-xs text-slate-600">Page {answerPage.pageNumber}</figcaption>
                                                    </figure>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <div className="flex items-center justify-between text-sm text-slate-600">
                            <span>{result.total} requests · Page {result.page} of {Math.max(result.totalPages, 1)}</span>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>Previous</Button>
                                <Button variant="outline" size="sm" disabled={page >= result.totalPages || loading} onClick={() => setPage(current => current + 1)}>Next</Button>
                            </div>
                        </div>
                    </>
                )}
            </section>
        </DashboardLayout>
    );
}
