'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { countPdfPages, validateFiles } from '@/utils/clientFileValidation';

interface ExamOption { _id: string; title: string; course?: string; }
interface StudentOption { id: string; name: string; email: string; }
interface ExamRosterState { examId: string; hasStudents: boolean; }
interface StudentSearchState {
    examId: string;
    query: string;
    students: StudentOption[];
    complete: boolean;
}
interface AnalysisResult {
    answerScriptId: string;
    studentId: string;
    studentName?: string;
    outcome: string;
    pagesProcessed: number;
    reviewRequired: boolean;
    flagId: string | null;
    comparisons: Array<{
        pageNumber?: number;
        status: string;
        distance: number;
        confidence: number;
        featureDeviations: Array<{ feature: string; normalizedDeviation: number }>;
        anomalyFactors: string[];
    }>;
}
interface AnswerPage { _id: string; pageNumber: number; imageUrl: string; thumbnailUrl?: string | null; }

type WorkflowState = 'IDLE' | 'UPLOADING' | 'PROCESSING' | 'ANALYZING' | 'COMPLETED' | 'REVIEW_REQUIRED' | 'FAILED';

async function readJson(response: Response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) throw new Error(body.message || `Request failed (${response.status})`);
    return body.data;
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default function HandwritingProductWorkflow() {
    const [exams, setExams] = useState<ExamOption[]>([]);
    const [examId, setExamId] = useState('');
    const [studentQuery, setStudentQuery] = useState('');
    const [examRoster, setExamRoster] = useState<ExamRosterState | null>(null);
    const [studentSearch, setStudentSearch] = useState<StudentSearchState | null>(null);
    const [selectedStudent, setSelectedStudent] = useState<StudentOption | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [pdfPageCount, setPdfPageCount] = useState<number | undefined>();
    const [fileValidationBusy, setFileValidationBusy] = useState(false);
    const [validationError, setValidationError] = useState('');
    const [error, setError] = useState('');
    const [workflowState, setWorkflowState] = useState<WorkflowState>('IDLE');
    const [statusMessage, setStatusMessage] = useState('');
    const [result, setResult] = useState<AnalysisResult | null>(null);
    const [pages, setPages] = useState<AnswerPage[]>([]);
    const validation = useMemo(() => file ? validateFiles([file], file.name.toLowerCase().endsWith('.pdf') && pdfPageCount !== undefined
        ? { [file.name]: pdfPageCount }
        : {}) : { isValid: false, errors: [], generalError: undefined }, [file, pdfPageCount]);
    const normalizedStudentQuery = studentQuery.trim();
    const matchingSearch = studentSearch?.examId === examId && studentSearch.query === normalizedStudentQuery
        ? studentSearch
        : null;
    const students = examId && normalizedStudentQuery.length >= 2 && !selectedStudent
        ? matchingSearch?.students || []
        : [];
    const hasExamStudents = examId && examRoster?.examId === examId
        ? examRoster.hasStudents
        : null;
    const studentSearchComplete = Boolean(matchingSearch?.complete);

    useEffect(() => {
        let cancelled = false;
        void fetch('/api/exams').then(readJson).then(examData => {
            if (cancelled) return;
            setExams(Array.isArray(examData) ? examData : []);
        }).catch(reason => {
            if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load exams.');
        });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!examId) return;
        const controller = new AbortController();
        const query = new URLSearchParams({ examId });
        void fetch(`/api/research/handwriting/students?${query}`, { signal: controller.signal })
            .then(readJson)
            .then(data => setExamRoster({ examId, hasStudents: Boolean(data.hasStudents) }))
            .catch(reason => {
                if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Could not load the exam roster.');
            });
        return () => controller.abort();
    }, [examId]);

    useEffect(() => {
        if (!examId || normalizedStudentQuery.length < 2 || selectedStudent) return;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            const query = new URLSearchParams({ examId, q: normalizedStudentQuery });
            void fetch(`/api/research/handwriting/students?${query}`, { signal: controller.signal })
                .then(readJson)
                .then(data => {
                    setExamRoster({ examId, hasStudents: Boolean(data.hasStudents) });
                    setStudentSearch({
                        examId,
                        query: normalizedStudentQuery,
                        students: Array.isArray(data.students) ? data.students : [],
                        complete: true
                    });
                })
                .catch(reason => {
                    if (reason?.name !== 'AbortError') {
                        setStudentSearch({ examId, query: normalizedStudentQuery, students: [], complete: true });
                        setError(reason instanceof Error ? reason.message : 'Could not search this exam roster.');
                    }
                });
        }, 250);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [examId, normalizedStudentQuery, selectedStudent]);

    const handleFileChange = async (nextFile: File | null) => {
        setFile(nextFile);
        setPdfPageCount(undefined);
        setFileValidationBusy(false);
        setValidationError('');
        setResult(null);
        setPages([]);
        if (!nextFile) return;
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.gif'];
        if (!allowed.some(extension => nextFile.name.toLowerCase().endsWith(extension))) {
            setValidationError('Choose a PDF or a supported image file.');
            return;
        }
        if (nextFile.name.toLowerCase().endsWith('.pdf')) {
            try {
                setFileValidationBusy(true);
                setPdfPageCount(await countPdfPages(nextFile));
            } catch (reason) {
                setValidationError(reason instanceof Error ? reason.message : 'The PDF could not be read.');
            } finally {
                setFileValidationBusy(false);
            }
        }
    };

    const analyzeSubmission = async () => {
        if (!examId || !selectedStudent || !file || !validation.isValid || validationError) return;
        setError('');
        setResult(null);
        setPages([]);
        try {
            setWorkflowState('UPLOADING');
            setStatusMessage('Uploading through Assignment Evaluation ingestion…');
            const form = new FormData();
            form.append('examId', examId);
            form.append('files', file);
            const uploadData = await readJson(await fetch('/api/ingest', { method: 'POST', body: form }));
            const batchId = uploadData?.batchId;
            if (!batchId) throw new Error('Ingestion did not return a batch ID.');

            setWorkflowState('PROCESSING');
            let ingestionStatus = '';
            for (let attempt = 0; attempt < 180; attempt++) {
                await sleep(2000);
                const statusData = await readJson(await fetch(`/api/ingest/${encodeURIComponent(batchId)}`));
                ingestionStatus = String(statusData.status || '').toLowerCase();
                setStatusMessage(`Processing pages: ${statusData.processedPages ?? 0}/${statusData.totalPages ?? 0}`);
                if (ingestionStatus === 'done') break;
                if (ingestionStatus === 'failed') throw new Error(statusData.failureReason || 'Answer-sheet ingestion failed.');
            }
            if (ingestionStatus !== 'done') throw new Error('Ingestion is still processing. Open the ingestion batch to check its status.');

            const scriptData = await readJson(await fetch(`/api/ingest/${encodeURIComponent(batchId)}/scripts`));
            if (!Array.isArray(scriptData) || scriptData.length !== 1) {
                throw new Error(`Ingestion produced ${Array.isArray(scriptData) ? scriptData.length : 0} AnswerScripts. This upload must resolve to exactly one script before it can be assigned to the selected student.`);
            }
            const answerScriptId = String(scriptData[0]._id);

            setStatusMessage('Assigning the ingested AnswerScript to the selected roster student…');
            await readJson(await fetch(`/api/answerscripts/${encodeURIComponent(answerScriptId)}/identify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: selectedStudent.id })
            }));

            setWorkflowState('ANALYZING');
            setStatusMessage('Analyzing stored answer-sheet pages…');
            const [analysisData, pageData] = await Promise.all([
                readJson(await fetch(`/api/research/handwriting/answerscripts/${encodeURIComponent(answerScriptId)}`, { method: 'POST' })),
                readJson(await fetch(`/api/scripts/${encodeURIComponent(answerScriptId)}/pages`))
            ]);
            setResult(analysisData as AnalysisResult);
            setPages(Array.isArray(pageData) ? pageData : []);
            setWorkflowState(analysisData.reviewRequired ? 'REVIEW_REQUIRED' : 'COMPLETED');
            setStatusMessage(analysisData.outcome === 'DISCREPANCY_DETECTED'
                ? 'Handwriting discrepancy detected. Professor review recommended.'
                : analysisData.outcome === 'INCONCLUSIVE'
                    ? 'Inconclusive: not enough usable handwriting evidence to assess this answer sheet.'
                    : 'No significant handwriting discrepancy detected.');
        } catch (reason) {
            setWorkflowState('FAILED');
            setError(reason instanceof Error ? reason.message : 'Answer-sheet analysis failed.');
        }
    };

    const analysisByPage = useMemo(() => {
        const map = new Map<number, AnalysisResult['comparisons'][number]>();
        for (const comparison of result?.comparisons || []) {
            if (comparison.pageNumber !== undefined) map.set(comparison.pageNumber, comparison);
        }
        return map;
    }, [result]);

    return (
        <div className="space-y-8">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900">Analyze student answer sheet</h2>
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                    <label className="block text-sm font-semibold text-slate-800">
                        Exam
                        <select className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal" value={examId} onChange={event => {
                            setExamId(event.target.value);
                            setSelectedStudent(null);
                            setStudentQuery('');
                            setExamRoster(null);
                            setStudentSearch(null);
                        }}>
                            <option value="">Select an authorized exam</option>
                            {exams.map(exam => <option key={exam._id} value={exam._id}>{exam.title}</option>)}
                        </select>
                    </label>
                    <div className="relative text-sm font-semibold text-slate-800">
                        <label htmlFor="handwriting-student-search">Student</label>
                        <input id="handwriting-student-search" className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal" value={selectedStudent ? `${selectedStudent.name} (${selectedStudent.email})` : studentQuery} disabled={!examId || Boolean(selectedStudent)} onChange={event => { setStudentQuery(event.target.value); setStudentSearch(null); }} placeholder="Search student by name or email" />
                        {selectedStudent && <button className="mt-1 text-xs text-indigo-700 underline" type="button" onClick={() => { setSelectedStudent(null); setStudentQuery(''); setStudentSearch(null); }}>Choose a different student</button>}
                        {!selectedStudent && students.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">{students.map(student => <li key={student.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-indigo-50" onClick={() => { setSelectedStudent(student); setStudentQuery(''); setStudentSearch(null); }}>{student.name} <span className="text-slate-500">{student.email}</span></button></li>)}</ul>}
                        {examId && hasExamStudents === false && <p className="mt-2 text-xs text-slate-500">No students are assigned to this exam.</p>}
                        {examId && studentSearchComplete && hasExamStudents && studentQuery.trim().length >= 2 && !selectedStudent && students.length === 0 && <p className="mt-2 text-xs text-slate-500">No matching students found on this exam roster.</p>}
                    </div>
                </div>

                <label className="mt-5 block text-sm font-semibold text-slate-800">
                    Answer sheet
                    <input className="mt-2 block w-full rounded-lg border border-slate-300 p-3 font-normal" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff,.gif,application/pdf,image/*" onChange={event => void handleFileChange(event.target.files?.[0] || null)} />
                </label>
                <p className="mt-1 text-xs text-slate-500">PDF or supported image. The existing ingestion pipeline validates and renders the uploaded pages.</p>
                {file && <p className="mt-2 text-sm text-slate-700">Selected file: <strong>{file.name}</strong></p>}
                {(validationError || validation.errors.length > 0 || validation.generalError) && <p role="alert" className="mt-2 text-sm text-rose-700">{validationError || validation.generalError || validation.errors[0]?.error}</p>}
                <button type="button" disabled={!examId || !selectedStudent || !file || fileValidationBusy || !validation.isValid || Boolean(validationError) || ['UPLOADING', 'PROCESSING', 'ANALYZING'].includes(workflowState)} onClick={() => void analyzeSubmission()} className="mt-5 rounded-lg bg-indigo-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400">
                    {workflowState === 'UPLOADING' ? 'Uploading…' : workflowState === 'PROCESSING' ? 'Processing…' : workflowState === 'ANALYZING' ? 'Analyzing…' : 'Analyze Answer Sheet'}
                </button>
                {statusMessage && <p role="status" className="mt-3 text-sm text-slate-700">{workflowState}: {statusMessage}</p>}
                {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
            </section>

            {result && <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div>
                    <h2 className="text-lg font-bold text-slate-900">Handwriting analysis</h2>
                    <p className="mt-1 text-sm text-slate-600">Student: {selectedStudent?.name || result.studentName} · Answer Script: {result.answerScriptId}</p>
                    <p className="text-sm text-slate-600">Pages analyzed: {result.pagesProcessed}</p>
                    <p className={`mt-3 font-bold ${result.reviewRequired ? 'text-amber-800' : result.outcome === 'INCONCLUSIVE' ? 'text-slate-700' : 'text-emerald-800'}`}>{statusMessage}</p>
                </div>
                {result.flagId && <Link className="inline-block rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900 underline" href="/professor/flags?status=OPEN">Open Flag Review Queue</Link>}
                {result.comparisons.some(comparison => comparison.status === 'REVIEW_REQUIRED') && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>These pages appear significantly different from the other usable pages in this answer sheet.</p><strong>Flagged pages:</strong> {result.comparisons.filter(comparison => comparison.status === 'REVIEW_REQUIRED').map(comparison => <a className="ml-2 underline" key={comparison.pageNumber} href={`#answer-page-${comparison.pageNumber}`}>Page {comparison.pageNumber}</a>)}</div>}
                <div className="grid gap-4 md:grid-cols-2">
                    {pages.map(page => {
                        const comparison = analysisByPage.get(page.pageNumber);
                        const flagged = comparison?.status === 'REVIEW_REQUIRED';
                        return <article id={`answer-page-${page.pageNumber}`} key={page._id} className={`overflow-hidden rounded-lg border ${flagged ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200'}`}>
                            <div className={`flex items-center justify-between px-3 py-2 text-sm font-semibold ${flagged ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-800'}`}>
                                <span>Page {page.pageNumber}</span>
                                {comparison && <span>{comparison.status} · distance {comparison.distance.toFixed(3)} · confidence {comparison.confidence.toFixed(3)}</span>}
                            </div>
                            <img className="max-h-[640px] w-full bg-slate-100 object-contain" src={page.imageUrl} alt={`Answer sheet page ${page.pageNumber}`} />
                            {comparison && comparison.featureDeviations.length > 0 && <p className="p-3 text-xs text-slate-700">Feature deviations: {comparison.featureDeviations.map(deviation => `${deviation.feature} ${deviation.normalizedDeviation.toFixed(2)}σ`).join(', ')}</p>}
                        </article>;
                    })}
                </div>
            </section>}

        </div>
    );
}
