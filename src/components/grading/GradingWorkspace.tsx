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
} from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { AnswerSheetCanvas } from '@/components/canvas/AnswerSheetCanvas';
import { RubricSidebar, RubricData } from './RubricSidebar';
import type { AnswerSheetPage } from '@/lib/pageNavigation';

export interface ScriptData {
  _id: string;
  exam?: string;
  anonymousId?: string;
  scriptReference?: string;
  pageCount?: number;
  pages?: AnswerSheetPage[];
}

export interface GradingWorkspaceProps {
  scriptId: string;
  allocatedQuestionNumber?: number;
}

export function GradingWorkspace({
  scriptId,
  allocatedQuestionNumber,
}: GradingWorkspaceProps) {
  const router = useRouter();
  const hasNavigatedRef = useRef<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [pages, setPages] = useState<AnswerSheetPage[]>([]);
  const [, setRubricData] = useState<RubricData | null>(null);

  const handleGradeSaved = useCallback(
    (savedGrade: unknown) => {
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
    [router]
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
          throw new Error('Access denied. You are not allocated to grade this answer script.');
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
      setLoading(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setLoading(false);
    }
  }, [scriptId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchScriptData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchScriptData]);

  const scriptRefLabel =
    scriptData?.scriptReference || scriptData?.anonymousId || scriptId || 'Answer Script';

  const isQuestionWise = allocatedQuestionNumber !== undefined && allocatedQuestionNumber !== null;

  return (
    <DashboardLayout
      title="Grading Portal"
      description={
        isQuestionWise
          ? `Evaluate and grade Question ${allocatedQuestionNumber} on exam submissions.`
          : 'Evaluate and grade full exam script submissions.'
      }
    >
      <div className="space-y-4">
        {/* Top Context & Navigation Bar */}
        <div className="bg-white border border-slate-200 rounded-brand-lg p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/ta">
              <Button variant="outline" size="sm" aria-label="Back to Work Queue">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                <span>Back to Work Queue</span>
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
                  <span>Question {allocatedQuestionNumber} (Allocated)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  <BookOpen className="h-3.5 w-3.5 text-blue-500" />
                  <span>Whole Script</span>
                </span>
              )}
            </div>
          </div>
        </div>

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
              <Link href="/ta">
                <Button variant="primary" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  <span>Return to Work Queue</span>
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
              <Link href="/ta">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  <span>Return to Work Queue</span>
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
              className="flex-1 w-full bg-white border border-slate-200 rounded-brand-lg shadow-sm overflow-hidden p-2 sm:p-4 min-w-0"
            >
              <AnswerSheetCanvas
                scriptId={scriptId}
                pages={pages}
                showPageNavigation={true}
                enablePanZoom={true}
                showZoomControls={true}
                enableSelect={true}
                enablePenTool={true}
                enableEraserTool={true}
                enableStamps={true}
                enableHighlight={true}
                enableTextNote={true}
                enableUndoRedo={true}
                enableOverlayToggle={true}
                enableAnnotationLoading={true}
                enableAutosave={true}
                className="w-full min-h-[700px] rounded-brand"
              />
            </div>

            {/* Rubric Sidebar Area */}
            <div className="w-full lg:w-[360px] xl:w-[380px] shrink-0">
              <RubricSidebar
                scriptId={scriptId}
                examId={scriptData?.exam}
                allocatedQuestionNumber={allocatedQuestionNumber}
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
