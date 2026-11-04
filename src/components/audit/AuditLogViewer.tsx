'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DashboardLayout } from '@/components/ui/DashboardLayout';

interface ExamOption {
    _id: string;
    title: string;
}

interface AuditLogRecord {
    id: string;
    actor: { id: string; name: string; role: string };
    action: string;
    outcome: 'SUCCESS' | 'FAILURE' | null;
    timestamp: string;
    target: { id: string; type: string } | null;
    details: unknown;
}

interface AuditLogResponse {
    logs: AuditLogRecord[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

interface IntegrityDiagnostic {
    code: string;
    sequence?: number;
    count?: number;
}

interface AuditIntegrityResult {
    status: 'INTACT' | 'MISMATCH' | 'UNSEALED';
    checkedRecords: number;
    sealedRecords: number;
    unsealedRecords: number;
    invalidSeals: number;
    missingSequences: number;
    diagnostics: IntegrityDiagnostic[];
    omittedDiagnostics: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAuditLogRecord(value: unknown): value is AuditLogRecord {
    if (!isRecord(value) || !isRecord(value.actor)) return false;
    const target = value.target;
    return typeof value.id === 'string' &&
        typeof value.actor.id === 'string' &&
        typeof value.actor.name === 'string' &&
        typeof value.actor.role === 'string' &&
        typeof value.action === 'string' &&
        (value.outcome === null || value.outcome === 'SUCCESS' || value.outcome === 'FAILURE') &&
        typeof value.timestamp === 'string' &&
        (target === null || (isRecord(target) && typeof target.id === 'string' && typeof target.type === 'string'));
}

function isAuditLogResponse(value: unknown): value is AuditLogResponse {
    return isRecord(value) &&
        Array.isArray(value.logs) &&
        value.logs.every(isAuditLogRecord) &&
        Number.isInteger(value.page) &&
        Number.isInteger(value.limit) &&
        Number.isInteger(value.total) &&
        Number.isInteger(value.totalPages);
}

function isIntegrityResult(value: unknown): value is AuditIntegrityResult {
    return isRecord(value) &&
        (value.status === 'INTACT' || value.status === 'MISMATCH' || value.status === 'UNSEALED') &&
        Number.isInteger(value.checkedRecords) &&
        Number.isInteger(value.sealedRecords) &&
        Number.isInteger(value.unsealedRecords) &&
        Number.isInteger(value.invalidSeals) &&
        Number.isInteger(value.missingSequences) &&
        Array.isArray(value.diagnostics) &&
        value.diagnostics.every(item => isRecord(item) && typeof item.code === 'string') &&
        Number.isInteger(value.omittedDiagnostics);
}

function detailValue(details: unknown, key: 'before' | 'after'): unknown {
    return isRecord(details) ? details[key] : undefined;
}

function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

export default function AuditLogViewer({ isAdmin }: { isAdmin: boolean }) {
    const [exams, setExams] = useState<ExamOption[]>([]);
    const [examId, setExamId] = useState('');
    const [actorIdInput, setActorIdInput] = useState('');
    const [appliedActorId, setAppliedActorId] = useState('');
    const [result, setResult] = useState<AuditLogResponse | null>(null);
    const [page, setPage] = useState(1);
    const [loadingExams, setLoadingExams] = useState(!isAdmin);
    const [loading, setLoading] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState('');
    const [examError, setExamError] = useState('');
    const [integrityError, setIntegrityError] = useState('');
    const [integrityResult, setIntegrityResult] = useState<AuditIntegrityResult | null>(null);

    const loadExams = useCallback(async () => {
        setLoadingExams(true);
        setExamError('');
        try {
            const response = await fetch('/api/exams', { cache: 'no-store' });
            const payload: unknown = await response.json();
            if (!response.ok || !isRecord(payload) || payload.success !== true ||
                !Array.isArray(payload.data)) {
                throw new Error(isRecord(payload) && typeof payload.message === 'string'
                    ? payload.message : 'Could not load exams.');
            }
            setExams(payload.data.filter((item): item is ExamOption =>
                isRecord(item) && typeof item._id === 'string' && typeof item.title === 'string'
            ));
        } catch (cause) {
            setExamError(cause instanceof Error ? cause.message : 'Could not load exams.');
        } finally {
            setLoadingExams(false);
        }
    }, []);

    const loadLogs = useCallback(async (pageToLoad: number, requestedExamId: string, requestedActorId: string) => {
        if (!isAdmin && !requestedExamId) {
            setResult(null);
            return;
        }

        setLoading(true);
        setError('');
        try {
            const query = new URLSearchParams({ page: String(pageToLoad), limit: '20' });
            if (requestedExamId) query.set('examId', requestedExamId);
            if (requestedActorId) query.set('userId', requestedActorId);
            const response = await fetch(`/api/audit-logs?${query}`, { cache: 'no-store' });
            const payload: unknown = await response.json();
            if (!response.ok || !isRecord(payload) || payload.success !== true ||
                !isAuditLogResponse(payload.data)) {
                throw new Error(isRecord(payload) && typeof payload.message === 'string'
                    ? payload.message : 'Could not load audit records.');
            }
            setResult(payload.data);
            setPage(pageToLoad);
        } catch (cause) {
            setResult(null);
            setError(cause instanceof Error ? cause.message : 'Could not load audit records.');
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    useEffect(() => {
        // Fetching on mount is the synchronization effect for this server-backed view.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadExams();
        if (isAdmin) void loadLogs(1, '', '');
    }, [isAdmin, loadExams, loadLogs]);

    const applyFilters = () => {
        const actorId = actorIdInput.trim();
        setAppliedActorId(actorId);
        setPage(1);
        void loadLogs(1, examId, actorId);
    };

    const retry = () => {
        if (examError) void loadExams();
        else void loadLogs(page, examId, appliedActorId);
    };

    const verifyIntegrity = async () => {
        setVerifying(true);
        setIntegrityError('');
        try {
            const response = await fetch('/api/audit-logs/verify', { method: 'POST' });
            const payload: unknown = await response.json();
            if (!response.ok || !isRecord(payload) || payload.success !== true ||
                !isIntegrityResult(payload.data)) {
                throw new Error(isRecord(payload) && typeof payload.message === 'string'
                    ? payload.message : 'Could not verify audit trail integrity.');
            }
            setIntegrityResult(payload.data);
        } catch (cause) {
            setIntegrityResult(null);
            setIntegrityError(cause instanceof Error ? cause.message : 'Could not verify audit trail integrity.');
        } finally {
            setVerifying(false);
        }
    };

    return (
        <DashboardLayout
            title="Audit history"
            description="Review immutable audit events for exams you are authorized to access."
            quickActions={
                <Link href={isAdmin ? '/admin' : '/professor'}>
                    <Button variant="outline" size="md"><ArrowLeft className="h-4 w-4" />Dashboard</Button>
                </Link>
            }
        >
            <section aria-label="Audit history" className="space-y-4">
                <form
                    className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto]"
                    onSubmit={event => {
                        event.preventDefault();
                        applyFilters();
                    }}
                >
                    <label className="text-sm font-medium text-slate-700">
                        Exam
                        <select
                            aria-label="Filter by exam"
                            value={examId}
                            onChange={event => setExamId(event.target.value)}
                            disabled={loadingExams}
                            required={!isAdmin}
                            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                        >
                            {isAdmin && <option value="">All exams</option>}
                            {!isAdmin && <option value="">Select an exam</option>}
                            {exams.map(exam => <option key={exam._id} value={exam._id}>{exam.title}</option>)}
                        </select>
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                        Actor user ID (optional)
                        <input
                            value={actorIdInput}
                            onChange={event => setActorIdInput(event.target.value)}
                            placeholder="MongoDB user ID"
                            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                        />
                    </label>
                    <div className="flex flex-wrap items-end gap-2">
                        <Button variant="primary" size="md" type="submit" disabled={loading || loadingExams}>
                            Apply filters
                        </Button>
                        <Button variant="outline" size="md" type="button" onClick={retry} disabled={loading}>
                            <RefreshCw className="h-4 w-4" />Refresh
                        </Button>
                        <Button variant="secondary" size="md" type="button" onClick={() => void verifyIntegrity()} disabled={verifying}>
                            <ShieldCheck className="h-4 w-4" />{verifying ? 'Verifying…' : 'Verify integrity'}
                        </Button>
                        {examId && (
                            <a
                                href={`/api/audit-logs/export?examId=${encodeURIComponent(examId)}`}
                                className="inline-flex items-center justify-center gap-2 rounded-brand border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                            >
                                Export CSV
                            </a>
                        )}
                    </div>
                </form>

                {integrityError && (
                    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
                        {integrityError}
                    </div>
                )}
                {integrityResult && (
                    <section
                        aria-label="Audit trail integrity result"
                        className={`rounded-lg border p-4 ${
                            integrityResult.status === 'INTACT'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                : integrityResult.status === 'UNSEALED'
                                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                                    : 'border-rose-200 bg-rose-50 text-rose-900'
                        }`}
                    >
                        <h2 className="font-semibold">Audit trail integrity: {integrityResult.status}</h2>
                        <p className="mt-1 text-sm">
                            Checked {integrityResult.checkedRecords} records; {integrityResult.sealedRecords} sealed,
                            {' '}{integrityResult.unsealedRecords} unsealed, {integrityResult.invalidSeals} invalid seals,
                            {' '}{integrityResult.missingSequences} missing sequence(s).
                        </p>
                        {integrityResult.diagnostics.length > 0 && (
                            <ul className="mt-2 list-disc pl-5 text-sm">
                                {integrityResult.diagnostics.map((item, index) => (
                                    <li key={`${item.code}-${item.sequence ?? 'none'}-${index}`}>
                                        {item.code}{item.sequence === undefined ? '' : ` at sequence ${item.sequence}`}
                                        {item.count === undefined ? '' : ` (${item.count})`}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {integrityResult.omittedDiagnostics > 0 && (
                            <p className="mt-2 text-sm">{integrityResult.omittedDiagnostics} additional diagnostics omitted.</p>
                        )}
                    </section>
                )}
                {examError && (
                    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
                        <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{examError}</span>
                        <Button variant="outline" size="sm" onClick={retry}>Retry</Button>
                    </div>
                )}
                {loading && <p role="status" className="rounded-lg border bg-white p-4 text-slate-600">Loading audit history…</p>}
                {error && (
                    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
                        <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</span>
                        <Button variant="outline" size="sm" onClick={retry}>Retry</Button>
                    </div>
                )}
                {!loading && !error && !isAdmin && !examId && (
                    <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">
                        Select an exam to review its audit history.
                    </p>
                )}
                {!loading && !error && result?.logs.length === 0 && (
                    <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">No audit records match these filters.</p>
                )}
                {!loading && !error && result && result.logs.length > 0 && (
                    <>
                        <ol aria-label="Audit events, newest first" className="space-y-3">
                            {result.logs.map(record => (
                                <li key={record.id} className="rounded-xl border border-slate-200 bg-white p-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <h2 className="font-semibold text-slate-900">{record.action.replace(/_/g, ' ')}</h2>
                                            <p className="mt-1 text-sm text-slate-700">
                                                {record.actor.name} · {record.actor.role}
                                                {record.outcome && <span> · {record.outcome}</span>}
                                            </p>
                                        </div>
                                        <time dateTime={record.timestamp} className="text-sm text-slate-600">{formatTime(record.timestamp)}</time>
                                    </div>
                                    {record.target && (
                                        <p className="mt-2 text-sm text-slate-600">
                                            Affected resource: {record.target.type} · <code>{record.target.id}</code>
                                        </p>
                                    )}
                                    {(detailValue(record.details, 'before') !== undefined ||
                                        detailValue(record.details, 'after') !== undefined) && (
                                        <details className="mt-3 rounded-md bg-slate-50 p-3">
                                            <summary className="cursor-pointer text-sm font-medium text-slate-700">Before and after</summary>
                                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                                                {(['before', 'after'] as const).map(key => {
                                                    const value = detailValue(record.details, key);
                                                    return value === undefined ? null : (
                                                        <div key={key}>
                                                            <h3 className="text-xs font-bold uppercase text-slate-500">{key}</h3>
                                                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs text-slate-700">
                                                                {JSON.stringify(value, null, 2)}
                                                            </pre>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </details>
                                    )}
                                </li>
                            ))}
                        </ol>
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
                            <p className="text-sm text-slate-600">
                                Page {result.page} of {Math.max(result.totalPages, 1)} · {result.total} records
                            </p>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={loading || page <= 1}
                                    onClick={() => void loadLogs(page - 1, examId, appliedActorId)}
                                >
                                    <ChevronLeft className="h-4 w-4" />Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={loading || !result.totalPages || page >= result.totalPages}
                                    onClick={() => void loadLogs(page + 1, examId, appliedActorId)}
                                >
                                    Next<ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </section>
        </DashboardLayout>
    );
}
