'use client';

import React, { useState, useCallback } from 'react';
import { Loader2, AlertCircle, FileImage } from 'lucide-react';
import { CanvasStage } from './CanvasStage';
import { PageImageLayer } from './PageImageLayer';
import type { AnswerSheetCanvasProps } from './types';
import type { RenderedImageBounds } from '@/lib/annotations';

/**
 * Deterministic sample SVG data-URI for canvas testing, demonstration, and empty-state fallback.
 * NOTE (AE-122): This is strictly a foundation fixture to verify rendering and aspect-ratio scaling.
 * Live answersheet page fetching, multi-page routing, and grading viewers belong to AE-123+.
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
  pageLabel,
  fitMode = 'contain',
  width = 'auto',
  height = 'auto',
  className = '',
  backgroundColor = '#f8fafc',
  fallback,
  onLoad,
  onError,
}: AnswerSheetCanvasProps) {
  const [prevSrc, setPrevSrc] = useState<string | null | undefined>(src);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(src !== null));
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [renderedBounds, setRenderedBounds] = useState<RenderedImageBounds | null>(null);

  // Synchronize loading/error state when src prop changes
  if (prevSrc !== src) {
    setPrevSrc(src);
    if (src === null) {
      setIsLoading(false);
      setHasError(false);
      setErrorMessage('');
      setRenderedBounds(null);
    } else {
      setIsLoading(true);
      setHasError(false);
      setErrorMessage('');
    }
  }

  const handleImageLoad = useCallback(
    (_img: HTMLImageElement, bounds: RenderedImageBounds) => {
      setIsLoading(false);
      setHasError(false);
      setRenderedBounds(bounds);
      onLoad?.(bounds);
    },
    [onLoad]
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

  const effectiveSrc = src !== undefined ? src : SAMPLE_ANSWER_SHEET_DATA_URI;

  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-lg border border-slate-200 shadow-sm overflow-hidden bg-slate-50 ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : '100%',
        height: typeof height === 'number' ? `${height}px` : '100%',
      }}
      data-testid="answer-sheet-canvas-wrapper"
    >
      {/* Canvas Stage */}
      <CanvasStage
        width={width}
        height={height}
        backgroundColor={backgroundColor}
        className="w-full h-full"
      >
        <PageImageLayer
          src={effectiveSrc}
          alt={pageLabel || 'Answer sheet page'}
          fitMode={fitMode}
          onImageLoad={handleImageLoad}
          onImageError={handleImageError}
        />
      </CanvasStage>

      {/* Loading Overlay */}
      {isLoading && (
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

      {/* Empty State when no source provided */}
      {!effectiveSrc && !isLoading && !hasError && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 p-6 text-center z-10"
          data-testid="canvas-empty-overlay"
        >
          <FileImage className="h-10 w-10 text-slate-300 mb-2 shrink-0" />
          <h4 className="text-sm font-semibold text-slate-700">No page image selected</h4>
          <p className="text-xs text-slate-400">Select an answer-sheet page to view.</p>
        </div>
      )}

      {/* Optional Debug/Info Badge if pageLabel is present */}
      {pageLabel && !isLoading && !hasError && renderedBounds && (
        <div className="absolute bottom-2 left-2 px-2 py-1 bg-slate-900/70 backdrop-blur-xs text-white text-3xs font-mono rounded shadow pointer-events-none z-10">
          {pageLabel} ({Math.round(renderedBounds.width)} × {Math.round(renderedBounds.height)}px)
        </div>
      )}
    </div>
  );
}
