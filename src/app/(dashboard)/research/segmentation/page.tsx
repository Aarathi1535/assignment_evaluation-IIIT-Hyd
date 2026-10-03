/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useRef } from 'react';
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Search,
  RefreshCw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Tag,
  ShieldCheck,
  HelpCircle,
  Eye
} from 'lucide-react';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TaggedRegion {
  _id: string;
  answerScript: string;
  exam: string;
  questionNumber: number;
  subQuestion?: string | null;
  pageNumber: number;
  pageId?: string | null;
  box: BoundingBox;
  sequenceIndex: number;
  segmentType: 'START' | 'CONTINUATION' | 'ISOLATED' | 'UNCERTAIN';
  isGroundTruth: boolean;
  taggedBy: string;
  taggedAt: string;
  notes?: string | null;
}

interface AnswerSegment {
  segmentId: string;
  pageNumber: number;
  box?: BoundingBox;
  segmentType: 'START' | 'CONTINUATION' | 'ISOLATED' | 'UNCERTAIN';
  sequenceIndex: number;
  extractedText?: string;
  detectedHeader?: string;
  subQuestion?: string;
  confidence: number;
  evidence: string[];
  isGroundTruth?: boolean;
}

interface ReconstructedAnswer {
  _id?: string;
  answerScript: string;
  exam: string;
  questionNumber: number;
  subQuestion?: string;
  segments: AnswerSegment[];
  totalSegments: number;
  pagesInvolved: number[];
  isNonConsecutive: boolean;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  reconstructionConfidence: number;
  status: 'AUTO_RECONSTRUCTED' | 'NEEDS_REVIEW' | 'VERIFIED' | 'GROUND_TRUTH';
  isGroundTruth?: boolean;
  verifiedAt?: string;
  reviewNotes?: string;
}

interface PageData {
  id: string;
  pageNumber: number;
  imageUrl: string;
  thumbnailUrl?: string | null;
  width?: number;
  height?: number;
}

const DEMO_QUESTION_LABELS: Record<number, string> = {
  1: 'Artificial Intelligence',
  2: 'Machine Learning',
  3: 'Deep Learning',
  4: 'Natural Language Processing',
  5: 'Generative AI'
};

const QUESTION_COLORS = [
  { border: 'border-blue-500', bg: 'bg-blue-500/20', text: 'text-blue-400', hex: '#3b82f6' },
  { border: 'border-emerald-500', bg: 'bg-emerald-500/20', text: 'text-emerald-400', hex: '#10b981' },
  { border: 'border-purple-500', bg: 'bg-purple-500/20', text: 'text-purple-400', hex: '#a855f7' },
  { border: 'border-amber-500', bg: 'bg-amber-500/20', text: 'text-amber-400', hex: '#f59e0b' },
  { border: 'border-rose-500', bg: 'bg-rose-500/20', text: 'text-rose-400', hex: '#f43f5e' },
  { border: 'border-cyan-500', bg: 'bg-cyan-500/20', text: 'text-cyan-400', hex: '#06b6d4' }
];

function getQuestionColor(qNum: number) {
  const index = Math.max(0, qNum - 1) % QUESTION_COLORS.length;
  return QUESTION_COLORS[index];
}

export default function AnswerSegmentationWorkspace() {
  const [scriptId, setScriptId] = useState('');
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDemoScript, setIsDemoScript] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Script Data
  const [pages, setPages] = useState<PageData[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [taggedRegions, setTaggedRegions] = useState<TaggedRegion[]>([]);
  const [reconstructedAnswers, setReconstructedAnswers] = useState<ReconstructedAnswer[]>([]);

  // Tagger tool controls
  const [selectedQuestion, setSelectedQuestion] = useState<number>(1);
  const [selectedSegmentType, setSelectedSegmentType] = useState<'START' | 'CONTINUATION' | 'ISOLATED'>('START');
  const [regionNotes, setRegionNotes] = useState('');

  // Interactive Bounding Box drawing state
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<BoundingBox | null>(null);

  const currentPage = pages[currentPageIndex] || null;

  // Load Script Details & Workspace
  const loadScriptWorkspace = async (id: string, demoMode = false, demoPages?: PageData[]) => {
    const trimmedId = id.trim();
    if (!trimmedId) return;

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    setCurrentBox(null);

    try {
      // The demo returns its pages directly because the generic pages API requires a TA grading allocation.
      let scriptPages = demoMode && demoPages ? demoPages : [];
      if (!demoMode || !demoPages) {
        const pagesRes = await fetch(`/api/scripts/${encodeURIComponent(trimmedId)}/pages`);
        const pagesData = await pagesRes.json();
        if (!pagesRes.ok) {
          throw new Error(pagesData.message || 'Failed to load script pages');
        }
        scriptPages = pagesData.data || [];
      }
      if (scriptPages.length === 0) {
        // Fallback placeholder pages for research demonstration if none ingested
        setPages([
          { id: 'p1', pageNumber: 1, imageUrl: '', width: 800, height: 1100 },
          { id: 'p2', pageNumber: 2, imageUrl: '', width: 800, height: 1100 },
          { id: 'p3', pageNumber: 3, imageUrl: '', width: 800, height: 1100 },
          { id: 'p4', pageNumber: 4, imageUrl: '', width: 800, height: 1100 },
          { id: 'p5', pageNumber: 5, imageUrl: '', width: 800, height: 1100 }
        ]);
      } else {
        setPages(scriptPages);
      }
      setCurrentPageIndex(0);

      // 2. Fetch tagged regions
      const regionsRes = await fetch(`/api/research/segmentation/${encodeURIComponent(trimmedId)}/regions`);
      const regionsData = await regionsRes.json();
      if (regionsRes.ok && regionsData.success) {
        setTaggedRegions(regionsData.data || []);
      }

      // 3. Fetch reconstructed answers
      const answersRes = await fetch(`/api/research/segmentation/${encodeURIComponent(trimmedId)}`);
      const answersData = await answersRes.json();
      if (answersRes.ok && answersData.success) {
        setReconstructedAnswers(answersData.data || []);
        if (answersData.data?.length > 0) {
          setSelectedQuestion(answersData.data[0].questionNumber);
        }
      }

      setActiveScriptId(trimmedId);
      setIsDemoScript(demoMode);
      setSuccessMessage('Answer script loaded successfully.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to initialize segmentation workspace');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadDemoScript = async () => {
    setIsLoadingDemo(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/research/segmentation/demo', { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success || !result.data?.scriptId) {
        throw new Error(result.message || 'Failed to load the demo script');
      }
      setScriptId(result.data.scriptId);
      await loadScriptWorkspace(result.data.scriptId, true, result.data.pages);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load the demo script');
    } finally {
      setIsLoadingDemo(false);
    }
  };

  const reloadData = async () => {
    if (!activeScriptId) return;
    try {
      const [regionsRes, answersRes] = await Promise.all([
        fetch(`/api/research/segmentation/${encodeURIComponent(activeScriptId)}/regions`),
        fetch(`/api/research/segmentation/${encodeURIComponent(activeScriptId)}`)
      ]);
      const regionsData = await regionsRes.json();
      const answersData = await answersRes.json();

      if (regionsRes.ok && regionsData.success) {
        setTaggedRegions(regionsData.data || []);
      }
      if (answersRes.ok && answersData.success) {
        setReconstructedAnswers(answersData.data || []);
      }
    } catch {
      // quiet refresh
    }
  };

  // Mouse Handlers for Bounding Box Drawing on Page Canvas
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setIsDrawing(true);
    setDrawStart({ x, y });
    setCurrentBox({ x, y, width: 0.01, height: 0.01 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart || !imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const currentY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const left = Math.min(drawStart.x, currentX);
    const top = Math.min(drawStart.y, currentY);
    const width = Math.abs(currentX - drawStart.x);
    const height = Math.abs(currentY - drawStart.y);

    setCurrentBox({
      x: Number(left.toFixed(4)),
      y: Number(top.toFixed(4)),
      width: Number(Math.max(0.01, width).toFixed(4)),
      height: Number(Math.max(0.01, height).toFixed(4))
    });
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    setDrawStart(null);
  };

  // Save the currently drawn region
  const handleSaveCurrentRegion = async () => {
    if (!activeScriptId || !currentBox || !currentPage) return;
    if (currentBox.width < 0.02 || currentBox.height < 0.02) {
      alert('Drawn region is too small. Please drag to select a visible box.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/segmentation/${encodeURIComponent(activeScriptId)}/regions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionNumber: selectedQuestion,
          pageNumber: currentPage.pageNumber,
          pageId: currentPage.id.startsWith('p') ? null : currentPage.id,
          box: currentBox,
          segmentType: selectedSegmentType,
          notes: regionNotes.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to save tagged region');
      }

      setCurrentBox(null);
      setRegionNotes('');
      setSuccessMessage(`Region tagged on Page ${currentPage.pageNumber} for Q${selectedQuestion} (Ground Truth).`);
      await reloadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error tagging region');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete a tagged region
  const handleDeleteRegion = async (regionId: string) => {
    if (!activeScriptId) return;
    if (!confirm('Are you sure you want to remove this ground-truth region?')) return;

    try {
      const res = await fetch(
        `/api/research/segmentation/${encodeURIComponent(activeScriptId)}/regions/${encodeURIComponent(regionId)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to delete region');
      }
      setSuccessMessage('Tagged region removed and answer re-reconstructed.');
      await reloadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error deleting region');
    }
  };

  // Verify / Confirm ground truth for a question
  const handleVerifyQuestion = async (qNum: number) => {
    if (!activeScriptId) return;
    try {
      const res = await fetch(
        `/api/research/segmentation/${encodeURIComponent(activeScriptId)}/question/${qNum}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: 'Confirmed and verified by Teaching Assistant' })
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to verify question');
      }
      setSuccessMessage(`Question ${qNum} marked as Verified Ground Truth.`);
      await reloadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error verifying question');
    }
  };

  // Regions on the currently viewed page
  const currentPageRegions = taggedRegions.filter(
    (r) => currentPage && r.pageNumber === currentPage.pageNumber
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 flex flex-col gap-6">
      {/* Top Header & Script Selector */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 p-6 rounded-2xl shadow-xl backdrop-blur-md">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Layers className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              TA-Assisted Question-Region Tagging & Reconstruction
            </h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Tag ground-truth question bounding boxes across pages, link continuations, and reconstruct unified answer sequences.
          </p>
        </div>

        {/* Script Selection Input */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={handleLoadDemoScript}
            disabled={isLoadingDemo || isLoading}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition"
          >
            {isLoadingDemo ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Load Demo Script'}
          </button>
          <div className="relative flex-1 md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Script ID..."
              value={scriptId}
              onChange={(e) => setScriptId(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => loadScriptWorkspace(scriptId)}
            disabled={isLoading || !scriptId.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Open Existing Script'}
          </button>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-blue-950/30 border border-blue-900/60 text-sm text-slate-300">
        Research prototype for question–answer segmentation and reconstruction. TAs can tag question regions across pages,
        link continuations, and reconstruct complete question-wise answers for downstream evaluation. The demo uses digital
        sample content and deterministic ground-truth tags; it does not perform automatic handwritten OCR.
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:underline text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* Workspace Area */}
      {activeScriptId && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT 7 COLS: Page Viewer & Interactive Region Tagger */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            {/* Tagging Control Bar */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Question Picker */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Question:</span>
                  <select
                    value={selectedQuestion}
                    onChange={(e) => setSelectedQuestion(Number(e.target.value))}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-sm font-bold text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((q) => (
                      <option key={q} value={q}>
                        Q{q}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Segment Type Picker */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Type:</span>
                  <select
                    value={selectedSegmentType}
                    onChange={(e) => setSelectedSegmentType(e.target.value as 'START' | 'CONTINUATION' | 'ISOLATED')}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="START">Start</option>
                    <option value="CONTINUATION">Continuation</option>
                    <option value="ISOLATED">Isolated</option>
                  </select>
                </div>

                {/* Notes Input */}
                <input
                  type="text"
                  placeholder="Optional notes / header..."
                  value={regionNotes}
                  onChange={(e) => setRegionNotes(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1 text-xs text-slate-200 placeholder-slate-500 w-44 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Tag Action Button */}
              <div className="flex items-center gap-2">
                {currentBox && (
                  <button
                    onClick={() => setCurrentBox(null)}
                    className="px-3 py-1 text-xs text-slate-400 hover:text-white transition"
                  >
                    Clear Box
                  </button>
                )}
                <button
                  onClick={handleSaveCurrentRegion}
                  disabled={!currentBox || isSaving}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-lg shadow-emerald-900/30"
                >
                  <Tag className="w-3.5 h-3.5" />
                  {isSaving ? 'Saving...' : `Tag for Q${selectedQuestion}`}
                </button>
              </div>
            </div>

            {/* Page Navigation Header */}
            <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 px-4 py-2.5 rounded-xl">
              <button
                onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentPageIndex === 0}
                className="p-1 rounded-lg hover:bg-slate-800 disabled:opacity-30 text-slate-300 transition"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <span className="text-sm font-medium text-slate-200">
                Page <span className="font-bold text-white">{currentPage?.pageNumber || 1}</span> of{' '}
                <span className="text-slate-400">{pages.length || 1}</span>
              </span>

              <button
                onClick={() => setCurrentPageIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                disabled={currentPageIndex >= pages.length - 1}
                className="p-1 rounded-lg hover:bg-slate-800 disabled:opacity-30 text-slate-300 transition"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Interactive Canvas Viewport */}
            <div className="relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center p-4">
              <div
                ref={imageContainerRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                className="relative w-full max-w-2xl aspect-[3/4] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden cursor-crosshair select-none shadow-inner flex items-center justify-center"
              >
                {/* Background Page Image or Document Placeholder */}
                {currentPage?.imageUrl ? (
                  <img
                    src={currentPage.imageUrl}
                    alt={`Page ${currentPage.pageNumber}`}
                    className="w-full h-full object-contain pointer-events-none"
                  />
                ) : (
                  <div className="text-center p-8 pointer-events-none">
                    <FileText className="w-16 h-16 text-slate-700 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-400">Page {currentPage?.pageNumber || 1}</p>
                    <p className="text-xs text-slate-600 mt-1">Click and drag cursor to tag a question bounding box region</p>
                  </div>
                )}

                {/* SVG Overlay: Render Existing Tagged Regions on this Page */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  {currentPageRegions.map((reg) => {
                    const color = getQuestionColor(reg.questionNumber);
                    const xPct = `${(reg.box.x * 100).toFixed(2)}%`;
                    const yPct = `${(reg.box.y * 100).toFixed(2)}%`;
                    const wPct = `${(reg.box.width * 100).toFixed(2)}%`;
                    const hPct = `${(reg.box.height * 100).toFixed(2)}%`;

                    return (
                      <g key={reg._id}>
                        <rect
                          x={xPct}
                          y={yPct}
                          width={wPct}
                          height={hPct}
                          fill={color.hex}
                          fillOpacity="0.18"
                          stroke={color.hex}
                          strokeWidth="2.5"
                          rx="4"
                        />
                      </g>
                    );
                  })}
                </svg>

                {/* HTML Badges for Tagged Regions on this Page */}
                {currentPageRegions.map((reg) => {
                  const color = getQuestionColor(reg.questionNumber);
                  return (
                    <div
                      key={reg._id}
                      style={{
                        left: `${(reg.box.x * 100).toFixed(2)}%`,
                        top: `${(reg.box.y * 100).toFixed(2)}%`
                      }}
                      className="absolute -translate-y-full mb-1 z-20 flex items-center gap-1.5 bg-slate-900/90 border border-slate-700 text-xs px-2 py-0.5 rounded shadow-lg"
                    >
                      <span className={`font-bold ${color.text}`}>Q{reg.questionNumber}</span>
                      <span className="text-[10px] text-slate-400">
                        ({reg.segmentType.toLowerCase()} #{reg.sequenceIndex})
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRegion(reg._id);
                        }}
                        title="Remove region"
                        className="text-red-400 hover:text-red-300 ml-1 p-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}

                {/* Currently Drawing Box */}
                {currentBox && (
                  <div
                    style={{
                      left: `${(currentBox.x * 100).toFixed(2)}%`,
                      top: `${(currentBox.y * 100).toFixed(2)}%`,
                      width: `${(currentBox.width * 100).toFixed(2)}%`,
                      height: `${(currentBox.height * 100).toFixed(2)}%`
                    }}
                    className="absolute border-2 border-dashed border-blue-400 bg-blue-500/25 pointer-events-none rounded z-30"
                  >
                    <span className="absolute -top-6 left-0 bg-blue-600 text-white font-bold text-[10px] px-1.5 py-0.5 rounded">
                      Q{selectedQuestion} Selection: {(currentBox.width * 100).toFixed(0)}% x {(currentBox.height * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>

              {/* Page Thumbnails Selector */}
              <div className="flex items-center gap-2 mt-4 overflow-x-auto w-full py-2 px-1">
                {pages.map((p, idx) => {
                  const hasTags = taggedRegions.some((r) => r.pageNumber === p.pageNumber);
                  const isCurrent = idx === currentPageIndex;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setCurrentPageIndex(idx)}
                      className={`flex-shrink-0 w-16 h-20 rounded-lg border text-xs flex flex-col items-center justify-center transition relative ${
                        isCurrent
                          ? 'border-blue-500 bg-blue-500/10 text-white ring-2 ring-blue-500/40'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <FileText className="w-5 h-5 mb-1" />
                      <span className="font-semibold">P. {p.pageNumber}</span>
                      {hasTags && (
                        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT 5 COLS: Question-Wise Reconstructed Answers */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h2 className="font-bold text-white text-base">RECONSTRUCTED ANSWERS</h2>
                </div>
                <button
                  onClick={reloadData}
                  title="Refresh reconstruction"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400">Ground-Truth Confirmed:</span>
                  <div className="text-lg font-bold text-emerald-400 mt-0.5">
                    {reconstructedAnswers.filter((a) => a.isGroundTruth || a.status === 'GROUND_TRUTH' || a.status === 'VERIFIED').length} / {reconstructedAnswers.length}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400">Pending Review:</span>
                  <div className="text-lg font-bold text-amber-400 mt-0.5">
                    {reconstructedAnswers.filter((a) => a.isAmbiguous || a.status === 'NEEDS_REVIEW').length}
                  </div>
                </div>
              </div>

              {/* Reconstructed Questions List */}
              <div className="flex flex-col gap-3 max-h-[620px] overflow-y-auto pr-1">
                {reconstructedAnswers.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm">
                    No questions reconstructed yet. Tag a region on the canvas to begin.
                  </div>
                ) : (
                  reconstructedAnswers.map((ans) => {
                    const isConfirmed = ans.status === 'GROUND_TRUTH' || ans.status === 'VERIFIED' || ans.isGroundTruth;
                    const color = getQuestionColor(ans.questionNumber);

                    return (
                      <div
                        key={ans.questionNumber}
                        className={`p-4 rounded-xl border transition flex flex-col gap-3 ${
                          selectedQuestion === ans.questionNumber
                            ? 'bg-slate-900 border-blue-500/60 ring-1 ring-blue-500/30'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {/* Header: Question Number & Status */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-extrabold ${color.bg} ${color.text} border ${color.border}`}>
                              Q{ans.questionNumber}{isDemoScript && DEMO_QUESTION_LABELS[ans.questionNumber]
                                ? ` — ${DEMO_QUESTION_LABELS[ans.questionNumber]}`
                                : ''}
                            </span>
                            {ans.isNonConsecutive && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                Non-Consecutive
                              </span>
                            )}
                          </div>

                          {/* Status Badge */}
                          {isConfirmed ? (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" /> Ground Truth
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-950/60 border border-amber-800 px-2 py-0.5 rounded-full">
                              <HelpCircle className="w-3 h-3" /> Needs Tagging
                            </span>
                          )}
                        </div>

                        {/* Involved Pages */}
                        <div className="text-xs text-slate-400 flex items-center justify-between">
                          <span>
                            Pages:{' '}
                            <span className="text-white font-medium">
                              {ans.pagesInvolved.length > 0 ? ans.pagesInvolved.join(', ') : 'None'}
                            </span>
                          </span>
                          <span className="text-slate-500 text-[11px]">
                            {ans.totalSegments} {ans.totalSegments === 1 ? 'region' : 'regions'}
                          </span>
                        </div>

                        {isDemoScript && ans.questionNumber === 3 && (
                          <div className="text-xs font-semibold text-blue-300">
                            Pages: 1 → 2 · 2 segments · Reconstructed
                          </div>
                        )}

                        {ans.segments.some((segment) => segment.extractedText?.trim()) && (
                          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                            <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-1">
                              Complete reconstructed answer
                            </div>
                            <p className="text-xs leading-relaxed text-slate-200">
                              {ans.segments
                                .slice()
                                .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
                                .map((segment) => segment.extractedText?.trim())
                                .filter((text): text is string => Boolean(text))
                                .join(' ')}
                            </p>
                          </div>
                        )}

                        {/* Ambiguity Reason if any */}
                        {ans.isAmbiguous && ans.ambiguityReason && (
                          <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-900/50 text-amber-300 text-[11px]">
                            {ans.ambiguityReason}
                          </div>
                        )}

                        {/* Segments List */}
                        {ans.segments.length > 0 && (
                          <div className="flex flex-col gap-1.5 mt-1 border-t border-slate-800/80 pt-2">
                            {ans.segments.map((seg, idx) => (
                              <div
                                key={seg.segmentId || idx}
                                className="flex items-center justify-between text-xs bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-300">#{seg.sequenceIndex}</span>
                                  <span className="text-slate-400">Page {seg.pageNumber}</span>
                                  <span className="text-[10px] uppercase font-semibold text-blue-400">
                                    {seg.segmentType}
                                  </span>
                                </div>

                                <button
                                  onClick={() => {
                                    const pageIdx = pages.findIndex((p) => p.pageNumber === seg.pageNumber);
                                    if (pageIdx !== -1) setCurrentPageIndex(pageIdx);
                                  }}
                                  className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                >
                                  <Eye className="w-3 h-3" /> View
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            onClick={() => {
                              setSelectedQuestion(ans.questionNumber);
                              const targetPage = ans.pagesInvolved[0] || currentPage?.pageNumber || 1;
                              const pIdx = pages.findIndex((p) => p.pageNumber === targetPage);
                              if (pIdx !== -1) setCurrentPageIndex(pIdx);
                            }}
                            className="px-3 py-1 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
                          >
                            Tag More Regions
                          </button>
                          {!isConfirmed && ans.segments.length > 0 && (
                            <button
                              onClick={() => handleVerifyQuestion(ans.questionNumber)}
                              className="px-3 py-1 text-xs font-semibold text-emerald-300 bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-800 rounded-lg transition"
                            >
                              Confirm Ground Truth
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
