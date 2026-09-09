'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  Loader2,
  AlertCircle,
  FileImage,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Pen,
  Eraser,
  Check,
  X,
  Highlighter,
  Undo2,
  Redo2,
} from 'lucide-react';
import { CanvasStage } from './CanvasStage';
import { PageImageLayer } from './PageImageLayer';
import { PenLayer } from './PenLayer';
import { MarkLayer } from './MarkLayer';
import type { AnswerSheetCanvasProps, CanvasTool } from './types';
import type { RenderedImageBounds } from '@/lib/annotations';
import {
  calculateStepZoom,
  calculateZoomTransform,
  MIN_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
  DEFAULT_ZOOM_STEP,
  PanZoomTransform,
} from '@/lib/panZoom';
import {
  sortScriptPages,
  clampPageIndex,
  getNextPageIndex,
  getPrevPageIndex,
  canGoNext,
  canGoPrev,
  formatPageIndicator,
  getPageImageUrl,
} from '@/lib/pageNavigation';
import {
  FreehandStroke,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_WIDTH,
  DEFAULT_PEN_COLOR_ID,
  DEFAULT_PEN_WIDTH_ID,
  PenColorId,
  PenWidthId,
  resolvePenColor,
  resolvePenWidth,
  filterStrokesByPage,
} from '@/lib/penTool';
import {
  MarkAnnotation,
  filterAnnotationsByPage,
} from '@/lib/stampTool';
import {
  PageHistory,
  createInitialHistory,
  recordAddStroke,
  recordEraseStrokes,
  recordAddAnnotation,
  applyUndo,
  applyRedo,
  canUndo,
  canRedo,
} from '@/lib/annotationHistory';
import { PenStyleSelector } from './PenStyleSelector';

/**
 * Deterministic sample SVG data-URI for canvas testing, demonstration, and empty-state fallback.
 * NOTE (AE-122/123): This is strictly a foundation fixture to verify rendering and aspect-ratio scaling.
 */
export const SAMPLE_ANSWER_SHEET_DATA_URI =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1130" viewBox="0 0 800 1130">
      <rect width="800" height="1130" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
      <rect x="40" y="40" width="720" height="80" rx="8" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
      <text x="60" y="85" font-family="sans-serif" font-size="20" font-weight="bold" fill="#1e293b">IIIT Hyderabad — Examination Answer Sheet</text>
      <text x="60" y="105" font-family="sans-serif" font-size="12" fill="#64748b">Course: Data Structures and Algorithms | Course Code: CS2.201</text>
      <line x1="40" y1="140" x2="760" y2="140" stroke="#e2e8f0" stroke-width="2"/>
      <rect x="40" y="160" width="720" height="920" fill="none" stroke="#f1f5f9" stroke-width="1"/>
      <!-- Grid lines -->
      <line x1="40" y1="200" x2="760" y2="200" stroke="#f1f5f9" stroke-width="1"/>
      <line x1="40" y1="240" x2="760" y2="240" stroke="#f1f5f9" stroke-width="1"/>
      <line x1="40" y1="280" x2="760" y2="280" stroke="#f1f5f9" stroke-width="1"/>
      <line x1="40" y1="320" x2="760" y2="320" stroke="#f1f5f9" stroke-width="1"/>
      <text x="60" y="230" font-family="sans-serif" font-size="14" fill="#334155">Q1. Explain the time complexity of QuickSort in best, average, and worst cases.</text>
      <text x="60" y="270" font-family="sans-serif" font-size="13" fill="#475569">Answer: Best: O(n log n), Average: O(n log n), Worst: O(n^2) when pivot is unbalanced.</text>
    </svg>`
  );

export function AnswerSheetCanvas({
  src,
  pages,
  currentPageIndex,
  initialPageIndex = 0,
  onPageChange,
  showPageNavigation = true,
  pageLabel,
  fitMode = 'contain',
  width = 'auto',
  height = 'auto',
  className = '',
  backgroundColor = '#f8fafc',
  minZoom = MIN_ZOOM_LEVEL,
  maxZoom = MAX_ZOOM_LEVEL,
  enablePanZoom = true,
  showZoomControls = true,
  enablePenTool = true,
  initialPenActive = false,
  isPenActive: propIsPenActive,
  onPenActiveChange,
  enableEraserTool = true,
  enableStamps = true,
  enableHighlight = true,
  enableUndoRedo = true,
  activeTool: propActiveTool,
  onToolChange,
  selectedPenColor: propSelectedPenColor,
  initialPenColor = DEFAULT_PEN_COLOR_ID,
  onPenColorChange,
  selectedPenWidth: propSelectedPenWidth,
  initialPenWidth = DEFAULT_PEN_WIDTH_ID,
  onPenWidthChange,
  smoothingOptions,
  strokes: propStrokes,
  onStrokesChange,
  annotations: propAnnotations,
  onAnnotationsChange,
  onAnnotationComplete,
  onUndo,
  onRedo,
  defaultStrokeColor = DEFAULT_PEN_COLOR,
  defaultStrokeWidth = DEFAULT_PEN_WIDTH,
  fallback,
  onLoad,
  onError,
  onTransformChange,
}: AnswerSheetCanvasProps) {
  // Deterministically sort pages if a multi-page list is supplied
  const sortedPages = useMemo(() => {
    return pages ? sortScriptPages(pages) : null;
  }, [pages]);

  const totalPages = sortedPages ? sortedPages.length : 0;
  const isMultiPageMode = sortedPages !== null;
  const isPagesEmpty = isMultiPageMode && totalPages === 0;

  // Uncontrolled page index state
  const [internalPageIndex, setInternalPageIndex] = useState<number>(() =>
    sortedPages && totalPages > 0 ? clampPageIndex(initialPageIndex, totalPages) : 0
  );

  // Active page index (controlled vs uncontrolled)
  const activePageIndex = useMemo(() => {
    if (!isMultiPageMode || totalPages === 0) return 0;
    const target = currentPageIndex !== undefined ? currentPageIndex : internalPageIndex;
    return clampPageIndex(target, totalPages);
  }, [isMultiPageMode, totalPages, currentPageIndex, internalPageIndex]);

  const currentPage = useMemo(() => {
    if (!isMultiPageMode || totalPages === 0) return null;
    return sortedPages[activePageIndex] || null;
  }, [isMultiPageMode, sortedPages, totalPages, activePageIndex]);

  // Key used to strictly isolate strokes and annotations per page
  const currentPageKey = useMemo(() => {
    if (currentPage?._id) return String(currentPage._id);
    if (currentPage?.id) return String(currentPage.id);
    return String(activePageIndex);
  }, [currentPage, activePageIndex]);

  // Active Tool state: 'none' | 'pen' | 'check' | 'cross' | 'highlight' | 'eraser' (AE-128 / AE-130)
  const [internalTool, setInternalTool] = useState<CanvasTool>(() =>
    initialPenActive ? 'pen' : 'none'
  );

  const activeTool = useMemo<CanvasTool>(() => {
    if (propActiveTool !== undefined) return propActiveTool;
    if (propIsPenActive !== undefined) return propIsPenActive ? 'pen' : 'none';
    return internalTool;
  }, [propActiveTool, propIsPenActive, internalTool]);

  const activePenMode = activeTool === 'pen';
  const activeCheckMode = activeTool === 'check';
  const activeCrossMode = activeTool === 'cross';
  const activeHighlightMode = activeTool === 'highlight';
  const activeEraserMode = activeTool === 'eraser';
  const isDrawingToolActive = activeTool !== 'none';

  const setTool = useCallback(
    (nextTool: CanvasTool) => {
      setInternalTool(nextTool);
      onToolChange?.(nextTool);
      onPenActiveChange?.(nextTool === 'pen');
    },
    [onToolChange, onPenActiveChange]
  );

  const handleTogglePen = useCallback(() => {
    setTool(activePenMode ? 'none' : 'pen');
  }, [activePenMode, setTool]);

  const handleToggleCheck = useCallback(() => {
    setTool(activeCheckMode ? 'none' : 'check');
  }, [activeCheckMode, setTool]);

  const handleToggleCross = useCallback(() => {
    setTool(activeCrossMode ? 'none' : 'cross');
  }, [activeCrossMode, setTool]);

  const handleToggleHighlight = useCallback(() => {
    setTool(activeHighlightMode ? 'none' : 'highlight');
  }, [activeHighlightMode, setTool]);

  const handleToggleEraser = useCallback(() => {
    setTool(activeEraserMode ? 'none' : 'eraser');
  }, [activeEraserMode, setTool]);

  // Pen style state: color & stroke width (controlled vs uncontrolled, AE-127)
  const [internalPenColor, setInternalPenColor] = useState<PenColorId>(initialPenColor);
  const activePenColor = propSelectedPenColor !== undefined ? propSelectedPenColor : internalPenColor;

  const [internalPenWidth, setInternalPenWidth] = useState<PenWidthId>(initialPenWidth);
  const activePenWidth = propSelectedPenWidth !== undefined ? propSelectedPenWidth : internalPenWidth;

  const handleColorChange = useCallback(
    (color: PenColorId) => {
      setInternalPenColor(color);
      onPenColorChange?.(color);
    },
    [onPenColorChange]
  );

  const handleWidthChange = useCallback(
    (width: PenWidthId) => {
      setInternalPenWidth(width);
      onPenWidthChange?.(width);
    },
    [onPenWidthChange]
  );

  // In-memory freehand strokes state (session level)
  const [internalStrokes, setInternalStrokes] = useState<FreehandStroke[]>([]);
  const allStrokes = propStrokes !== undefined ? propStrokes : internalStrokes;

  // Filter strokes strictly belonging to the currently displayed page
  const currentPageStrokes = useMemo(() => {
    return filterStrokesByPage(allStrokes, currentPageKey);
  }, [allStrokes, currentPageKey]);

  // In-memory check, cross, and highlight annotations state (session level, AE-130)
  const [internalAnnotations, setInternalAnnotations] = useState<MarkAnnotation[]>([]);
  const allAnnotations = propAnnotations !== undefined ? propAnnotations : internalAnnotations;

  // Filter annotations strictly belonging to the currently displayed page
  const currentPageAnnotations = useMemo(() => {
    return filterAnnotationsByPage(allAnnotations, currentPageKey);
  }, [allAnnotations, currentPageKey]);

  // Per-page undo/redo history state (AE-128 / AE-130)
  const [pageHistoryMap, setPageHistoryMap] = useState<Record<string, PageHistory>>({});
  const currentPageHistory = useMemo(() => {
    return pageHistoryMap[currentPageKey] || createInitialHistory();
  }, [pageHistoryMap, currentPageKey]);

  const canUndoActive = useMemo(() => {
    return enableUndoRedo && canUndo(currentPageHistory);
  }, [enableUndoRedo, currentPageHistory]);

  const canRedoActive = useMemo(() => {
    return enableUndoRedo && canRedo(currentPageHistory);
  }, [enableUndoRedo, currentPageHistory]);

  const handleStrokeComplete = useCallback(
    (newStroke: FreehandStroke) => {
      const updated = [...allStrokes, newStroke];
      const newHistory = recordAddStroke(currentPageHistory, newStroke);

      setPageHistoryMap((prev) => ({ ...prev, [currentPageKey]: newHistory }));
      setInternalStrokes(updated);
      onStrokesChange?.(updated);
    },
    [allStrokes, currentPageHistory, currentPageKey, onStrokesChange]
  );

  const handleAnnotationComplete = useCallback(
    (newAnnotation: MarkAnnotation) => {
      const updated = [...allAnnotations, newAnnotation];
      const newHistory = recordAddAnnotation(currentPageHistory, newAnnotation);

      setPageHistoryMap((prev) => ({ ...prev, [currentPageKey]: newHistory }));
      setInternalAnnotations(updated);
      onAnnotationsChange?.(updated);
      onAnnotationComplete?.(newAnnotation);
    },
    [allAnnotations, currentPageHistory, currentPageKey, onAnnotationsChange, onAnnotationComplete]
  );

  const handleStrokesErased = useCallback(
    (erasedStrokes: FreehandStroke[]) => {
      if (!erasedStrokes || erasedStrokes.length === 0) return;
      const erasedIds = new Set(erasedStrokes.map((s) => s.id));
      const pageStrokesBefore = filterStrokesByPage(allStrokes, currentPageKey);
      const newHistory = recordEraseStrokes(currentPageHistory, erasedStrokes, pageStrokesBefore);
      const updated = allStrokes.filter((s) => !erasedIds.has(s.id));

      setPageHistoryMap((prev) => ({ ...prev, [currentPageKey]: newHistory }));
      setInternalStrokes(updated);
      onStrokesChange?.(updated);
    },
    [allStrokes, currentPageHistory, currentPageKey, onStrokesChange]
  );

  const handleUndo = useCallback(() => {
    if (!enableUndoRedo || !canUndo(currentPageHistory)) return;
    const pageStrokesBefore = filterStrokesByPage(allStrokes, currentPageKey);
    const pageAnnotationsBefore = filterAnnotationsByPage(allAnnotations, currentPageKey);

    const {
      history: newHistory,
      strokes: newPageStrokes,
      annotations: newPageAnnotations,
    } = applyUndo(currentPageHistory, pageStrokesBefore, pageAnnotationsBefore);

    const otherPagesStrokes = allStrokes.filter(
      (s) => String(s.pageKey) !== String(currentPageKey)
    );
    const updatedStrokes = [...otherPagesStrokes, ...newPageStrokes];

    const otherPagesAnnotations = allAnnotations.filter(
      (a) => String(a.pageKey) !== String(currentPageKey)
    );
    const updatedAnnotations = [...otherPagesAnnotations, ...newPageAnnotations];

    setPageHistoryMap((prev) => ({ ...prev, [currentPageKey]: newHistory }));
    setInternalStrokes(updatedStrokes);
    setInternalAnnotations(updatedAnnotations);
    onStrokesChange?.(updatedStrokes);
    onAnnotationsChange?.(updatedAnnotations);
    onUndo?.();
  }, [
    enableUndoRedo,
    currentPageHistory,
    allStrokes,
    allAnnotations,
    currentPageKey,
    onStrokesChange,
    onAnnotationsChange,
    onUndo,
  ]);

  const handleRedo = useCallback(() => {
    if (!enableUndoRedo || !canRedo(currentPageHistory)) return;
    const pageStrokesBefore = filterStrokesByPage(allStrokes, currentPageKey);
    const pageAnnotationsBefore = filterAnnotationsByPage(allAnnotations, currentPageKey);

    const {
      history: newHistory,
      strokes: newPageStrokes,
      annotations: newPageAnnotations,
    } = applyRedo(currentPageHistory, pageStrokesBefore, pageAnnotationsBefore);

    const otherPagesStrokes = allStrokes.filter(
      (s) => String(s.pageKey) !== String(currentPageKey)
    );
    const updatedStrokes = [...otherPagesStrokes, ...newPageStrokes];

    const otherPagesAnnotations = allAnnotations.filter(
      (a) => String(a.pageKey) !== String(currentPageKey)
    );
    const updatedAnnotations = [...otherPagesAnnotations, ...newPageAnnotations];

    setPageHistoryMap((prev) => ({ ...prev, [currentPageKey]: newHistory }));
    setInternalStrokes(updatedStrokes);
    setInternalAnnotations(updatedAnnotations);
    onStrokesChange?.(updatedStrokes);
    onAnnotationsChange?.(updatedAnnotations);
    onRedo?.();
  }, [
    enableUndoRedo,
    currentPageHistory,
    allStrokes,
    allAnnotations,
    currentPageKey,
    onStrokesChange,
    onAnnotationsChange,
    onRedo,
  ]);

  // Global / Canvas Keyboard Shortcuts: Ctrl+Z / Cmd+Z -> Undo, Ctrl+Y / Cmd+Shift+Z -> Redo
  useEffect(() => {
    if (!enableUndoRedo) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (!isCtrlOrCmd) return;

      const key = e.key.toLowerCase();
      if (key === 'z') {
        if (e.shiftKey) {
          if (canRedo(currentPageHistory)) {
            e.preventDefault();
            handleRedo();
          }
        } else {
          if (canUndo(currentPageHistory)) {
            e.preventDefault();
            handleUndo();
          }
        }
      } else if (key === 'y') {
        if (canRedo(currentPageHistory)) {
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enableUndoRedo, currentPageHistory, handleUndo, handleRedo]);

  // Concrete color & width passed into PenLayer for new strokes
  const effectiveStrokeColor = useMemo(() => {
    return resolvePenColor(activePenColor) || defaultStrokeColor;
  }, [activePenColor, defaultStrokeColor]);

  const effectiveStrokeWidth = useMemo(() => {
    return resolvePenWidth(activePenWidth) || defaultStrokeWidth;
  }, [activePenWidth, defaultStrokeWidth]);

  // Determine effective image source
  const effectiveSrc = useMemo(() => {
    if (isMultiPageMode) {
      if (totalPages === 0) return null;
      return getPageImageUrl(currentPage);
    }
    return src !== undefined ? src : SAMPLE_ANSWER_SHEET_DATA_URI;
  }, [isMultiPageMode, totalPages, currentPage, src]);

  const [prevEffectiveSrc, setPrevEffectiveSrc] = useState<string | null | undefined>(effectiveSrc);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(effectiveSrc !== null));
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [baseBounds, setBaseBounds] = useState<RenderedImageBounds | null>(null);

  // Controlled/tracked transform (pan and zoom)
  const [transform, setTransform] = useState<PanZoomTransform>({
    x: 0,
    y: 0,
    zoom: 1.0,
  });

  const stageDimensionsRef = useRef({ width: 800, height: 600 });

  // Synchronize loading/error state when effectiveSrc changes
  if (prevEffectiveSrc !== effectiveSrc) {
    setPrevEffectiveSrc(effectiveSrc);
    if (effectiveSrc === null) {
      setIsLoading(false);
      setHasError(false);
      setErrorMessage('');
      setBaseBounds(null);
      setTransform({ x: 0, y: 0, zoom: 1.0 });
    } else {
      setIsLoading(true);
      setHasError(false);
      setErrorMessage('');
      setBaseBounds(null);
      setTransform({ x: 0, y: 0, zoom: 1.0 });
    }
  }

  // Handle page change navigation
  const navigateToPage = useCallback(
    (targetIndex: number) => {
      if (!sortedPages || totalPages <= 0) return;
      const clamped = clampPageIndex(targetIndex, totalPages);
      if (clamped === activePageIndex) return;

      setInternalPageIndex(clamped);
      setTransform({ x: 0, y: 0, zoom: 1.0 });
      setIsLoading(true);
      setHasError(false);
      setErrorMessage('');

      if (sortedPages[clamped]) {
        onPageChange?.(clamped, sortedPages[clamped]);
      }
    },
    [sortedPages, totalPages, activePageIndex, onPageChange]
  );

  const handlePrevPage = useCallback(() => {
    if (!sortedPages || totalPages <= 0) return;
    const prevIdx = getPrevPageIndex(activePageIndex, totalPages);
    navigateToPage(prevIdx);
  }, [sortedPages, totalPages, activePageIndex, navigateToPage]);

  const handleNextPage = useCallback(() => {
    if (!sortedPages || totalPages <= 0) return;
    const nextIdx = getNextPageIndex(activePageIndex, totalPages);
    navigateToPage(nextIdx);
  }, [sortedPages, totalPages, activePageIndex, navigateToPage]);

  const handleImageLoad = useCallback(
    (_img: HTMLImageElement, bounds: RenderedImageBounds) => {
      setIsLoading(false);
      setHasError(false);
      setBaseBounds(bounds);
      const initialTransform = { x: bounds.x, y: bounds.y, zoom: 1.0 };
      setTransform(initialTransform);
      onLoad?.(bounds);
      onTransformChange?.(initialTransform);
    },
    [onLoad, onTransformChange]
  );

  const handleImageError = useCallback(
    (err: Error) => {
      setIsLoading(false);
      setHasError(true);
      setErrorMessage(err.message);
      onError?.(err);
    },
    [onError]
  );

  const handleTransformChange = useCallback(
    (newTransform: PanZoomTransform) => {
      setTransform(newTransform);
      onTransformChange?.(newTransform);
    },
    [onTransformChange]
  );

  const handleResize = useCallback((dims: { width: number; height: number }) => {
    stageDimensionsRef.current = dims;
  }, []);

  // Zoom Button Handlers
  const handleZoomIn = useCallback(() => {
    if (!baseBounds) return;
    const targetZoom = calculateStepZoom(transform.zoom, DEFAULT_ZOOM_STEP, minZoom, maxZoom);
    const centerX = stageDimensionsRef.current.width / 2;
    const centerY = stageDimensionsRef.current.height / 2;

    const nextTransform = calculateZoomTransform(
      transform.x,
      transform.y,
      transform.zoom,
      targetZoom,
      centerX,
      centerY,
      baseBounds,
      stageDimensionsRef.current.width,
      stageDimensionsRef.current.height,
      minZoom,
      maxZoom
    );

    setTransform(nextTransform);
    onTransformChange?.(nextTransform);
  }, [baseBounds, transform, minZoom, maxZoom, onTransformChange]);

  const handleZoomOut = useCallback(() => {
    if (!baseBounds) return;
    const targetZoom = calculateStepZoom(transform.zoom, -DEFAULT_ZOOM_STEP, minZoom, maxZoom);
    const centerX = stageDimensionsRef.current.width / 2;
    const centerY = stageDimensionsRef.current.height / 2;

    const nextTransform = calculateZoomTransform(
      transform.x,
      transform.y,
      transform.zoom,
      targetZoom,
      centerX,
      centerY,
      baseBounds,
      stageDimensionsRef.current.width,
      stageDimensionsRef.current.height,
      minZoom,
      maxZoom
    );

    setTransform(nextTransform);
    onTransformChange?.(nextTransform);
  }, [baseBounds, transform, minZoom, maxZoom, onTransformChange]);

  const handleResetZoom = useCallback(() => {
    if (!baseBounds) return;
    const resetTransform: PanZoomTransform = {
      x: baseBounds.x,
      y: baseBounds.y,
      zoom: 1.0,
    };
    setTransform(resetTransform);
    onTransformChange?.(resetTransform);
  }, [baseBounds, onTransformChange]);

  const zoomPercent = Math.round(transform.zoom * 100);

  // Accessible active page label
  const effectivePageLabel = useMemo(() => {
    if (pageLabel) return pageLabel;
    if (isMultiPageMode && totalPages > 0) {
      return formatPageIndicator(activePageIndex, totalPages);
    }
    return 'Answer sheet page';
  }, [pageLabel, isMultiPageMode, totalPages, activePageIndex]);

  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-lg border border-slate-200 shadow-sm overflow-hidden bg-slate-50 select-none ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : '100%',
        height: typeof height === 'number' ? `${height}px` : '100%',
      }}
      data-testid="answer-sheet-canvas-wrapper"
    >
      {/* Top Multi-Page Navigation Bar */}
      {isMultiPageMode && showPageNavigation && totalPages > 0 && (
        <nav
          className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center bg-white/95 backdrop-blur-xs border border-slate-200/90 rounded-lg shadow-md px-2 py-1 gap-2 z-20 transition-all select-none"
          data-testid="page-navigation-controls"
          role="navigation"
          aria-label="Answer Sheet Page Navigation"
        >
          <button
            type="button"
            onClick={handlePrevPage}
            disabled={!canGoPrev(activePageIndex, totalPages)}
            className="p-1 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent text-slate-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            aria-label="Previous Page"
            title="Previous Page"
            data-testid="prev-page-button"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div
            className="text-xs font-semibold font-mono text-slate-700 px-2 min-w-[5.5rem] text-center"
            data-testid="page-indicator"
            aria-live="polite"
            aria-atomic="true"
          >
            {formatPageIndicator(activePageIndex, totalPages)}
          </div>

          <button
            type="button"
            onClick={handleNextPage}
            disabled={!canGoNext(activePageIndex, totalPages)}
            className="p-1 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent text-slate-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            aria-label="Next Page"
            title="Next Page"
            data-testid="next-page-button"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}

      {/* Canvas Stage */}
      <CanvasStage
        width={width}
        height={height}
        backgroundColor={backgroundColor}
        className="w-full h-full"
        onResize={handleResize}
      >
        <PageImageLayer
          src={effectiveSrc}
          alt={effectivePageLabel}
          fitMode={fitMode}
          transform={transform}
          minZoom={minZoom}
          maxZoom={maxZoom}
          enablePanZoom={enablePanZoom}
          isPenActive={isDrawingToolActive}
          onImageLoad={handleImageLoad}
          onImageError={handleImageError}
          onTransformChange={handleTransformChange}
        />

        {/* Freehand Pen & Eraser Drawing Layer (AE-126 / AE-127 / AE-128 / AE-129) */}
        <PenLayer
          transform={transform}
          pageKey={currentPageKey}
          isPenActive={activePenMode && !isLoading && !hasError && Boolean(effectiveSrc)}
          isEraserActive={activeEraserMode && !isLoading && !hasError && Boolean(effectiveSrc)}
          strokes={currentPageStrokes}
          onStrokeComplete={handleStrokeComplete}
          onStrokesErased={handleStrokesErased}
          smoothingOptions={smoothingOptions}
          color={effectiveStrokeColor}
          strokeWidth={effectiveStrokeWidth}
        />

        {/* Check, Cross & Highlight Marks Layer (AE-130) */}
        <MarkLayer
          transform={transform}
          pageKey={currentPageKey}
          activeTool={activeTool}
          annotations={currentPageAnnotations}
          onAnnotationComplete={handleAnnotationComplete}
          disabled={isLoading || hasError || !effectiveSrc}
        />
      </CanvasStage>

      {/* Floating Toolbar: Zoom Controls & Pen / Style / Stamps / Highlight / Eraser / Undo / Redo Controls */}
      {showZoomControls && !isLoading && !hasError && effectiveSrc && (
        <div
          className="absolute bottom-3 right-3 flex items-center bg-white/90 backdrop-blur-xs border border-slate-200/80 rounded-lg shadow-md p-1 gap-1 z-20 transition-opacity"
          data-testid="canvas-zoom-controls"
          role="toolbar"
          aria-label="Canvas Zoom and Pen Controls"
        >
          {/* Pen Tool Toggle & Style Selector (AE-126 / AE-127) */}
          {enablePenTool && (
            <>
              <button
                type="button"
                onClick={handleTogglePen}
                className={`p-1.5 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  activePenMode
                    ? 'bg-blue-600 text-white shadow-xs hover:bg-blue-700'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                aria-pressed={activePenMode}
                aria-label="Toggle Freehand Pen Tool"
                title={activePenMode ? 'Pen Tool Active (Click to Disable)' : 'Enable Freehand Pen Tool'}
                data-testid="canvas-pen-toggle"
              >
                <Pen className="h-4 w-4" />
              </button>

              {/* Color & Stroke-Width Selector (AE-127) */}
              {activePenMode && (
                <>
                  <div className="h-4 w-px bg-slate-200 mx-0.5" />
                  <PenStyleSelector
                    selectedColor={activePenColor}
                    onColorChange={handleColorChange}
                    selectedWidth={activePenWidth}
                    onWidthChange={handleWidthChange}
                  />
                </>
              )}
            </>
          )}

          {/* Check Stamp Tool Toggle (AE-130) */}
          {enableStamps && (
            <button
              type="button"
              onClick={handleToggleCheck}
              className={`p-1.5 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                activeCheckMode
                  ? 'bg-blue-600 text-white shadow-xs hover:bg-blue-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-pressed={activeCheckMode}
              aria-label="Toggle Check Stamp Tool"
              title={activeCheckMode ? 'Check Tool Active (Click to Disable)' : 'Enable Check Stamp Tool (✓)'}
              data-testid="canvas-check-toggle"
            >
              <Check className={`h-4 w-4 ${activeCheckMode ? 'text-white' : 'text-emerald-600'}`} />
            </button>
          )}

          {/* Cross Stamp Tool Toggle (AE-130) */}
          {enableStamps && (
            <button
              type="button"
              onClick={handleToggleCross}
              className={`p-1.5 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                activeCrossMode
                  ? 'bg-blue-600 text-white shadow-xs hover:bg-blue-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-pressed={activeCrossMode}
              aria-label="Toggle Cross Stamp Tool"
              title={activeCrossMode ? 'Cross Tool Active (Click to Disable)' : 'Enable Cross Stamp Tool (✗)'}
              data-testid="canvas-cross-toggle"
            >
              <X className={`h-4 w-4 ${activeCrossMode ? 'text-white' : 'text-rose-600'}`} />
            </button>
          )}

          {/* Highlight Tool Toggle (AE-130) */}
          {enableHighlight && (
            <button
              type="button"
              onClick={handleToggleHighlight}
              className={`p-1.5 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                activeHighlightMode
                  ? 'bg-blue-600 text-white shadow-xs hover:bg-blue-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-pressed={activeHighlightMode}
              aria-label="Toggle Highlight Tool"
              title={activeHighlightMode ? 'Highlight Tool Active (Click to Disable)' : 'Enable Highlight Tool'}
              data-testid="canvas-highlight-toggle"
            >
              <Highlighter className={`h-4 w-4 ${activeHighlightMode ? 'text-white' : 'text-amber-500'}`} />
            </button>
          )}

          {/* Eraser Tool Toggle (AE-128) */}
          {enableEraserTool && (
            <button
              type="button"
              onClick={handleToggleEraser}
              className={`p-1.5 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                activeEraserMode
                  ? 'bg-blue-600 text-white shadow-xs hover:bg-blue-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-pressed={activeEraserMode}
              aria-label="Toggle Eraser Tool"
              title={activeEraserMode ? 'Eraser Tool Active (Click to Disable)' : 'Enable Eraser Tool'}
              data-testid="canvas-eraser-toggle"
            >
              <Eraser className="h-4 w-4" />
            </button>
          )}

          {/* Undo / Redo Controls (AE-128) */}
          {enableUndoRedo && (
            <>
              <div className="h-4 w-px bg-slate-200 mx-0.5" />
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndoActive}
                className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-35 disabled:hover:bg-transparent text-slate-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                aria-label="Undo Annotation"
                title="Undo (Ctrl+Z)"
                data-testid="canvas-undo-button"
              >
                <Undo2 className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedoActive}
                className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-35 disabled:hover:bg-transparent text-slate-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                aria-label="Redo Annotation"
                title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
                data-testid="canvas-redo-button"
              >
                <Redo2 className="h-4 w-4" />
              </button>
            </>
          )}

          <div className="h-4 w-px bg-slate-200 mx-0.5" />

          <button
            type="button"
            onClick={handleZoomOut}
            disabled={transform.zoom <= minZoom}
            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent text-slate-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            aria-label="Zoom Out"
            title="Zoom Out (-25%)"
          >
            <ZoomOut className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleResetZoom}
            className="px-2 py-1 text-xs font-semibold font-mono text-slate-700 hover:bg-slate-100 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            aria-label={`Reset Zoom (Current: ${zoomPercent}%)`}
            title="Reset Zoom to Fit (100%)"
          >
            {zoomPercent}%
          </button>

          <button
            type="button"
            onClick={handleZoomIn}
            disabled={transform.zoom >= maxZoom}
            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent text-slate-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            aria-label="Zoom In"
            title="Zoom In (+25%)"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          {transform.zoom > 1.05 && (
            <button
              type="button"
              onClick={handleResetZoom}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              aria-label="Reset to Fit"
              title="Reset to Fit"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && !isPagesEmpty && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-xs z-10 transition-opacity"
          data-testid="canvas-loading-overlay"
        >
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-2" />
          <span className="text-xs font-medium text-slate-600">Loading page image...</span>
        </div>
      )}

      {/* Error Fallback */}
      {hasError && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 p-6 text-center z-10"
          data-testid="canvas-error-overlay"
        >
          {fallback || (
            <>
              <AlertCircle className="h-10 w-10 text-rose-500 mb-2 shrink-0" />
              <h4 className="text-sm font-semibold text-slate-800 mb-1">Failed to load answer sheet</h4>
              <p className="text-xs text-slate-500 max-w-sm">{errorMessage || 'The requested page image could not be loaded.'}</p>
            </>
          )}
        </div>
      )}

      {/* Empty State when no source provided or pages list is empty */}
      {(!effectiveSrc || isPagesEmpty) && !isLoading && !hasError && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 p-6 text-center z-10"
          data-testid="canvas-empty-overlay"
        >
          <FileImage className="h-10 w-10 text-slate-300 mb-2 shrink-0" />
          <h4 className="text-sm font-semibold text-slate-700">
            {isPagesEmpty ? 'No pages in answer script' : 'No page image selected'}
          </h4>
          <p className="text-xs text-slate-400">
            {isPagesEmpty
              ? 'This answer script contains no pages to display.'
              : 'Select an answer-sheet page to view.'}
          </p>
        </div>
      )}

      {/* Optional Debug/Info Badge if pageLabel or effectivePageLabel is present */}
      {effectivePageLabel && !isLoading && !hasError && baseBounds && (
        <div className="absolute bottom-3 left-3 px-2 py-1 bg-slate-900/70 backdrop-blur-xs text-white text-3xs font-mono rounded shadow pointer-events-none z-10">
          {effectivePageLabel} ({Math.round(baseBounds.width * transform.zoom)} × {Math.round(baseBounds.height * transform.zoom)}px · {zoomPercent}%)
        </div>
      )}
    </div>
  );
}
