'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  AlertCircle,
  Loader2,
  RotateCcw,
  BookOpen,
  Layers,
  Target,
  Lock,
  Flag,
  User,
  Clock,
} from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { AnswerSheetCanvas } from '@/components/canvas/AnswerSheetCanvas';
import { RubricSidebar, RubricData, RubricSidebarHandle } from './RubricSidebar';
import type { AnswerSheetPage } from '@/lib/pageNavigation';

export interface ScriptData {
  _id: string;
  exam?: string;
  anonymousId?: string;
  scriptReference?: string;
  pageCount?: number;
  pages?: AnswerSheetPage[];
}

export interface FlagDetail {
  _id: string;
  answerScript: string;
  exam: string;
  question?: number;
  raisedBy?: string | { _id?: string; name?: string; email?: string };
  reason: string;
  note?: string;
  status: string;
  resolution?: {
    action?: string;
    by?: string;
    at?: string;
    notes?: string;
    previousScore?: number;
    newScore?: number;
    criterionOverrides?: Array<{ criterionName: string; score: number; feedback?: string }>;
  } | null;
  createdAt: string;
  updatedAt?: string;
}

export interface GradingWorkspaceProps {
  scriptId: string;
  allocatedQuestionNumber?: number;
  flagId?: string;
  isReviewMode?: boolean;
}

export function GradingWorkspace({
  scriptId,
  allocatedQuestionNumber,
  flagId,
  isReviewMode = false,
}: GradingWorkspaceProps) {
  const router = useRouter();
  const hasNavigatedRef = useRef<boolean>(false);
  const rubricSidebarRef = useRef<RubricSidebarHandle>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [pages, setPages] = useState<AnswerSheetPage[]>([]);
  const [, setRubricData] = useState<RubricData | null>(null);
  const [activeFlag, setActiveFlag] = useState<FlagDetail | null>(null);

  // Resolution controls state (AE-164)
  const [resolutionAction, setResolutionAction] = useState<'CLEAR' | 'OVERRIDE' | 'ESCALATE'>('CLEAR');
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [overrideScore, setOverrideScore] = useState<string>('');
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolutionSuccess, setResolutionSuccess] = useState<string | null>(null);

  const handleResolveFlag = async () => {
    if (!activeFlag) return;
    setIsResolving(true);
    setResolutionError(null);
    setResolutionSuccess(null);

    try {
      const payload: {
        action: string;
        notes: string;
        newScore?: number;
      } = {
        action: resolutionAction,
        notes: resolutionNotes.trim(),
      };

      if (resolutionAction === 'OVERRIDE') {
        const scoreNum = parseFloat(overrideScore);
        if (isNaN(scoreNum)) {
          throw new Error('Please enter a valid override score.');
        }
        payload.newScore = scoreNum;
      }

      if (!payload.notes) {
        throw new Error('Resolution notes are required.');
      }

      const res = await fetch(`/api/professor/flags/${encodeURIComponent(activeFlag._id)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || `Failed to resolve flag (${res.status})`);
      }

      const json = await res.json();
      setActiveFlag(json.data);
      setResolutionSuccess(
        resolutionAction === 'ESCALATE'
          ? 'Flag has been escalated to Admin.'
          : resolutionAction === 'OVERRIDE'
          ? 'Grade override recorded and flag resolved.'
          : 'Flag cleared and marked as resolved.'
      );
    } catch (err: unknown) {
      setResolutionError(err instanceof Error ? err.message : 'Failed to resolve flag.');
    } finally {
      setIsResolving(false);
    }
  };

  const handleSaveDraft = useCallback(() => {
    if (isReviewMode) return;
    rubricSidebarRef.current?.saveDraft();
  }, [isReviewMode]);

  const handleSubmitFinal = useCallback(() => {
    if (isReviewMode) return;
    rubricSidebarRef.current?.submitFinal();
  }, [isReviewMode]);

  const handleNextQuestion = useCallback(() => {
    rubricSidebarRef.current?.nextQuestion();
  }, []);

  const handlePrevQuestion = useCallback(() => {
    rubricSidebarRef.current?.prevQuestion();
  }, []);

  const handleGradeSaved = useCallback(
    (savedGrade: unknown) => {
      if (isReviewMode) return;
      if (!savedGrade || typeof savedGrade !== 'object') return;
      const data = savedGrade as {
        allocationCompleted?: boolean;
        nextAllocation?: { targetUrl?: string } | null;
      };

      if (data.allocationCompleted && data.nextAllocation?.targetUrl) {
        if (hasNavigatedRef.current) return;
        hasNavigatedRef.current = true;
        router.push(data.nextAllocation.targetUrl);
      }
    },
    [isReviewMode, router]
  );

  const fetchScriptData = useCallback(async () => {
    if (!scriptId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/scripts/${encodeURIComponent(scriptId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Authentication required. Please log in again.');
        }
        if (res.status === 403) {
          throw new Error('Access denied. You do not have permission to view or grade this answer script.');
        }
        if (res.status === 404) {
          throw new Error('Answer script not found.');
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || `Failed to load script (${res.status})`);
      }

      const json = await res.json();
      const data: ScriptData = json?.data || json;

      setScriptData(data);
      setPages(Array.isArray(data?.pages) ? data.pages : []);

      // If review mode or flagId is active, fetch flag details
      if (isReviewMode || flagId) {
        try {
          const flagsRes = await fetch(`/api/scripts/${encodeURIComponent(scriptId)}/flags`);
          if (flagsRes.ok) {
            const flagsJson = await flagsRes.json();
            const flagsList: FlagDetail[] = flagsJson?.data || [];
            if (flagsList.length > 0) {
              const matched = flagId
                ? flagsList.find((f) => f._id === flagId) || flagsList[0]
                : flagsList[0];
              setActiveFlag(matched);
            }
          }
        } catch {
          // Non-blocking flag fetch
        }
      }

      setLoading(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setLoading(false);
    }
  }, [scriptId, isReviewMode, flagId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchScriptData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchScriptData]);

  const scriptRefLabel =
    scriptData?.scriptReference || scriptData?.anonymousId || scriptId || 'Answer Script';

  const isQuestionWise = allocatedQuestionNumber !== undefined && allocatedQuestionNumber !== null;

  const getReasonLabel = (reason?: string) => {
    switch (reason) {
      case 'CHEATING_SUSPECTED':
        return 'Cheating Suspected';
      case 'ILLEGIBLE':
        return 'Illegible Handwriting / Scan';
      case 'OTHER':
        return 'Other Concern';
      default:
        return reason || 'Flagged for Review';
    }
  };

  const getStatusBadgeStyle = (status?: string) => {
    switch (status) {
      case 'OPEN':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'RESOLVED':
        return 'bg-emerald-100 text-emerald-900 border-emerald-300';
      case 'ESCALATED':
        return 'bg-rose-100 text-rose-900 border-rose-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <DashboardLayout
      title={isReviewMode ? 'Flag Review' : 'Grading Portal'}
      description={
        isReviewMode
          ? 'Read-only review of flagged answer script and TA evaluation.'
          : isQuestionWise
            ? `Evaluate and grade Question ${allocatedQuestionNumber} on exam submissions.`
            : 'Evaluate and grade full exam script submissions.'
      }
      maxWidth="full"
    >
      <div className="space-y-4">
        {/* Top Context & Navigation Bar */}
        <div className="bg-white border border-slate-200 rounded-brand-lg p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href={isReviewMode ? '/professor/flags' : '/ta'}>
              <Button
                variant="outline"
                size="sm"
                aria-label={isReviewMode ? 'Back to Flag Review Queue' : 'Back to Work Queue'}
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                <span>{isReviewMode ? 'Back to Flag Queue' : 'Back to Work Queue'}</span>
              </Button>
            </Link>

            <div className="h-5 w-px bg-slate-200 hidden sm:block" />

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-primary/10 text-brand-primary">
                <FileText className="h-3.5 w-3.5" />
                <span className="font-mono">{scriptRefLabel}</span>
              </span>

              {pages.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                  <Layers className="h-3.5 w-3.5 text-slate-500" />
                  <span>{pages.length} {pages.length === 1 ? 'Page' : 'Pages'}</span>
                </span>
              )}

              {isQuestionWise ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                  <Target className="h-3.5 w-3.5 text-purple-600" />
                  <span>Question {allocatedQuestionNumber}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  <BookOpen className="h-3.5 w-3.5 text-blue-500" />
                  <span>Whole Script</span>
                </span>
              )}

              {isReviewMode && (
                <span
                  data-testid="badge-review-mode"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300"
                >
                  <Lock className="h-3.5 w-3.5 text-amber-600" />
                  <span>Read-Only Review Mode</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Flag Review & Resolution Banner (AE-163 & AE-164) */}
        {isReviewMode && activeFlag && (
          <div
            data-testid="flag-review-banner"
            className="bg-amber-50/90 border border-amber-200 rounded-brand-lg p-4 shadow-sm space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/70 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center font-bold shrink-0">
                  <Flag className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 leading-tight">
                      Flag: {getReasonLabel(activeFlag.reason)}
                    </h3>
                    <span
                      data-testid="flag-banner-status"
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-extrabold tracking-wide uppercase border ${getStatusBadgeStyle(
                        activeFlag.status
                      )}`}
                    >
                      {activeFlag.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {activeFlag.question ? `Concern reported for Question ${activeFlag.question}` : 'Concern reported for whole script submission'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-600">
                {typeof activeFlag.raisedBy === 'object' && activeFlag.raisedBy?.name && (
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    <span>Flagged by TA: <strong>{activeFlag.raisedBy.name}</strong></span>
                  </span>
                )}
                {activeFlag.createdAt && (
                  <span className="flex items-center gap-1 text-slate-500">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>{new Date(activeFlag.createdAt).toLocaleDateString()}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Flag Note / Rationale */}
            {activeFlag.note && (
              <div className="bg-white/80 rounded-brand p-3 border border-amber-200/60 text-xs text-slate-800">
                <span className="font-bold text-slate-700 block mb-1">TA Note:</span>
                <p className="whitespace-pre-wrap leading-relaxed">{activeFlag.note}</p>
              </div>
            )}

            {/* AE-164: Flag Resolution Controls (for OPEN flags) */}
            {activeFlag.status === 'OPEN' && (
              <div
                data-testid="flag-resolution-controls"
                className="bg-white rounded-brand-lg p-4 border border-amber-300/80 shadow-xs space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Resolve Flag (Professor / Admin Action)
                  </h4>
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-brand text-xs font-semibold">
                    <button
                      type="button"
                      data-testid="btn-action-clear"
                      onClick={() => setResolutionAction('CLEAR')}
                      className={`px-2.5 py-1 rounded text-xs transition-all ${
                        resolutionAction === 'CLEAR'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Clear Flag
                    </button>
                    <button
                      type="button"
                      data-testid="btn-action-override"
                      onClick={() => setResolutionAction('OVERRIDE')}
                      className={`px-2.5 py-1 rounded text-xs transition-all ${
                        resolutionAction === 'OVERRIDE'
                          ? 'bg-brand-primary text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Override Grade
                    </button>
                    <button
                      type="button"
                      data-testid="btn-action-escalate"
                      onClick={() => setResolutionAction('ESCALATE')}
                      className={`px-2.5 py-1 rounded text-xs transition-all ${
                        resolutionAction === 'ESCALATE'
                          ? 'bg-rose-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Escalate to Admin
                    </button>
                  </div>
                </div>

                {/* OVERRIDE Score Input */}
                {resolutionAction === 'OVERRIDE' && (
                  <div className="bg-brand-primary/5 border border-brand-primary/20 rounded p-3 space-y-2">
                    <label
                      htmlFor="override-score"
                      className="block text-xs font-bold text-slate-800"
                    >
                      New Audited Score:
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        id="override-score"
                        type="number"
                        step="0.5"
                        min="0"
                        data-testid="override-new-score-input"
                        value={overrideScore}
                        onChange={(e) => setOverrideScore(e.target.value)}
                        placeholder="Enter overridden score..."
                        className="w-48 text-xs font-mono font-bold bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                      />
                      <span className="text-2xs text-slate-500 italic">
                        The original TA score will be preserved; this override score becomes authoritative.
                      </span>
                    </div>
                  </div>
                )}

                {/* Resolution Notes Textarea */}
                <div className="space-y-1">
                  <label
                    htmlFor="resolution-notes"
                    className="block text-xs font-bold text-slate-800"
                  >
                    Resolution Notes (Required):
                  </label>
                  <textarea
                    id="resolution-notes"
                    rows={2}
                    data-testid="resolution-notes-textarea"
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    placeholder="Provide justification or instructions regarding this resolution..."
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:bg-white"
                  />
                </div>

                {resolutionError && (
                  <p
                    data-testid="resolution-error-msg"
                    className="text-xs text-rose-600 font-semibold"
                  >
                    {resolutionError}
                  </p>
                )}

                {resolutionSuccess && (
                  <p
                    data-testid="resolution-success-msg"
                    className="text-xs text-emerald-700 font-semibold"
                  >
                    {resolutionSuccess}
                  </p>
                )}

                <div className="flex justify-end pt-1">
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="submit-flag-resolution-btn"
                    disabled={isResolving || !resolutionNotes.trim()}
                    onClick={handleResolveFlag}
                    className="text-xs font-bold"
                  >
                    {isResolving ? 'Resolving...' : `Submit ${resolutionAction}`}
                  </Button>
                </div>
              </div>
            )}

            {/* Resolved/Escalated Summary Box */}
            {activeFlag.status !== 'OPEN' && activeFlag.resolution && (
              <div
                data-testid="flag-resolution-summary"
                className="bg-white rounded-brand-lg p-3.5 border border-slate-200 shadow-xs space-y-2 text-xs"
              >
                <div className="flex items-center justify-between font-bold text-slate-800">
                  <span className="uppercase tracking-wider text-2xs text-slate-500">
                    Resolution Status: <strong className="text-slate-900">{activeFlag.status}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded text-3xs font-mono font-extrabold bg-slate-100 text-slate-700 border border-slate-300">
                    Action: {activeFlag.resolution.action}
                  </span>
                </div>

                {activeFlag.resolution.action === 'OVERRIDE' && (
                  <div
                    data-testid="resolution-score-diff"
                    className="flex items-center gap-3 font-mono text-xs bg-amber-50 p-2 rounded border border-amber-200 text-amber-900 font-bold"
                  >
                    <span>Previous Score: {activeFlag.resolution.previousScore ?? 'N/A'} pts</span>
                    <span>→</span>
                    <span className="text-emerald-700">
                      New Override Score: {activeFlag.resolution.newScore ?? 'N/A'} pts
                    </span>
                  </div>
                )}

                {activeFlag.resolution.notes && (
                  <div className="text-slate-700">
                    <span className="font-bold text-slate-800">Resolution Notes: </span>
                    <span className="italic">{activeFlag.resolution.notes}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Main Content Workspace */}
        {loading && (
          <div
            data-testid="grading-loading-state"
            className="bg-white border border-slate-200 rounded-brand-lg p-16 text-center shadow-sm flex flex-col items-center justify-center min-h-[460px] space-y-3"
          >
            <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
            <h3 className="text-base font-semibold text-slate-800">Loading Answer Script...</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              Fetching script pages, scan images, and existing annotations.
            </p>
          </div>
        )}

        {!loading && error && (
          <div
            data-testid="grading-error-state"
            className="bg-white border border-rose-200 rounded-brand-lg p-10 text-center shadow-sm flex flex-col items-center justify-center max-w-xl mx-auto space-y-4 my-8"
          >
            <div className="h-12 w-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">Unable to Load Answer Script</h3>
              <p className="text-sm text-slate-650">{error}</p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={fetchScriptData}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                <span>Retry</span>
              </Button>
              <Link href={isReviewMode ? '/professor/flags' : '/ta'}>
                <Button variant="primary" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  <span>{isReviewMode ? 'Return to Flag Queue' : 'Return to Work Queue'}</span>
                </Button>
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && pages.length === 0 && (
          <div
            data-testid="grading-empty-state"
            className="bg-white border border-amber-200 rounded-brand-lg p-10 text-center shadow-sm flex flex-col items-center justify-center max-w-xl mx-auto space-y-4 my-8"
          >
            <div className="h-12 w-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
              <FileText className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">No Pages Available</h3>
              <p className="text-sm text-slate-650">
                This answer script does not have any processed pages associated with it yet.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <Link href={isReviewMode ? '/professor/flags' : '/ta'}>
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  <span>{isReviewMode ? 'Return to Flag Queue' : 'Return to Work Queue'}</span>
                </Button>
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && pages.length > 0 && (
          <div className="flex flex-col lg:flex-row items-start gap-4">
            {/* Canvas Viewport Area */}
            <div
              data-testid="grading-canvas-container"
              className="flex-1 w-full bg-white border border-slate-200 rounded-brand-lg shadow-sm overflow-hidden p-2 sm:p-4 min-w-0 h-[calc(100vh-210px)] min-h-[700px] flex flex-col"
            >
              <AnswerSheetCanvas
                scriptId={scriptId}
                pages={pages}
                showPageNavigation={true}
                enablePanZoom={true}
                showZoomControls={true}
                enableSelect={!isReviewMode}
                enablePenTool={!isReviewMode}
                enableEraserTool={!isReviewMode}
                enableStamps={!isReviewMode}
                enableHighlight={!isReviewMode}
                enableTextNote={!isReviewMode}
                enableUndoRedo={!isReviewMode}
                enableOverlayToggle={true}
                enableAnnotationLoading={true}
                enableAutosave={!isReviewMode}
                onSaveDraft={handleSaveDraft}
                onSubmitFinal={handleSubmitFinal}
                onNextQuestion={handleNextQuestion}
                onPrevQuestion={handlePrevQuestion}
                className="w-full h-full min-h-[660px] rounded-brand flex-1"
              />
            </div>

            {/* Rubric Sidebar Area */}
            <div className="w-full lg:w-[360px] xl:w-[380px] shrink-0 lg:h-[calc(100vh-210px)] min-h-[660px] flex flex-col">
              <RubricSidebar
                ref={rubricSidebarRef}
                scriptId={scriptId}
                examId={scriptData?.exam}
                allocatedQuestionNumber={allocatedQuestionNumber}
                readOnly={isReviewMode}
                onRubricLoaded={setRubricData}
                onGradeSaved={handleGradeSaved}
              />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

export default GradingWorkspace;
