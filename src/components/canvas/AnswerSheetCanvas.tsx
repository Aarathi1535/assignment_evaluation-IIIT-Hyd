'use client';

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  Loader2,
  AlertCircle,
  FileImage,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { CanvasStage } from './CanvasStage';
import { PageImageLayer } from './PageImageLayer';
import type { AnswerSheetCanvasProps } from './types';
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
          onImageLoad={handleImageLoad}
          onImageError={handleImageError}
          onTransformChange={handleTransformChange}
        />
      </CanvasStage>

      {/* Floating Zoom Controls Toolbar */}
      {showZoomControls && !isLoading && !hasError && effectiveSrc && (
        <div
          className="absolute bottom-3 right-3 flex items-center bg-white/90 backdrop-blur-xs border border-slate-200/80 rounded-lg shadow-md p-1 gap-1 z-20 transition-opacity"
          data-testid="canvas-zoom-controls"
          role="toolbar"
          aria-label="Canvas Zoom Controls"
        >
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
