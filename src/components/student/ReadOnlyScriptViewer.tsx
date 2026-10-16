'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { CanvasStage } from '@/components/canvas/CanvasStage';
import { PageImageLayer } from '@/components/canvas/PageImageLayer';
import { MarkLayer } from '@/components/canvas/MarkLayer';
import { PenLayer } from '@/components/canvas/PenLayer';
import type { MarkAnnotation } from '@/lib/stampTool';
import type { FreehandStroke } from '@/lib/penTool';
import type { RenderedImageBounds } from '@/lib/annotations';
import type { PanZoomTransform } from '@/lib/panZoom';

export interface ScriptPageInfo {
  pageId: string;
  pageNumber: number;
  width: number;
  height: number;
}

export interface ReadOnlyScriptViewerProps {
  scriptId: string;
  examTitle?: string;
  className?: string;
}

export function ReadOnlyScriptViewer({
  scriptId,
  examTitle,
  className = '',
}: ReadOnlyScriptViewerProps) {
  const [pages, setPages] = useState<ScriptPageInfo[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [annotations, setAnnotations] = useState<MarkAnnotation[]>([]);
  const [strokes, setStrokes] = useState<FreehandStroke[]>([]);
  const [baseBounds, setBaseBounds] = useState<RenderedImageBounds | null>(null);
  const [transform, setTransform] = useState<PanZoomTransform>({
    x: 0,
    y: 0,
    zoom: 1.0,
    rotation: 0,
  });
  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);
  const [isLoadingPages, setIsLoadingPages] = useState<boolean>(true);
  const [isLoadingPageData, setIsLoadingPageData] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Load pages list for the script
  useEffect(() => {
    let isCancelled = false;

    async function loadPages() {
      setIsLoadingPages(true);
      setError(null);
      try {
        const res = await fetch(`/api/student/results/${encodeURIComponent(scriptId)}/pages`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
          throw new Error('Not found');
        }

        const data = await res.json();
        const pageList: ScriptPageInfo[] = Array.isArray(data) ? data : data.data || [];

        if (!isCancelled) {
          setPages(pageList);
          setCurrentPageIndex(0);
        }
      } catch {
        if (!isCancelled) {
          setError('Unable to load answer sheet. The result may not be available yet.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingPages(false);
        }
      }
    }

    if (scriptId) {
      loadPages();
    }

    return () => {
      isCancelled = true;
    };
  }, [scriptId]);

  const currentPage = pages[currentPageIndex] || null;

  // 2. Load annotations for current page
  useEffect(() => {
    let isCancelled = false;

    async function loadAnnotations(pageId: string) {
      setIsLoadingPageData(true);
      try {
        const res = await fetch(
          `/api/student/results/${encodeURIComponent(scriptId)}/pages/${encodeURIComponent(pageId)}/annotations`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
          }
        );

        if (!res.ok) {
          throw new Error('Not found');
        }

        const data = await res.json();
        const annotCollection = data.annotations || data.data?.annotations || [];
        const strokeCollection = data.strokes || data.data?.strokes || [];

        if (!isCancelled) {
          setAnnotations(annotCollection);
          setStrokes(strokeCollection);
        }
      } catch {
        if (!isCancelled) {
          setAnnotations([]);
          setStrokes([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingPageData(false);
        }
      }
    }

    if (currentPage?.pageId) {
      loadAnnotations(currentPage.pageId);
    }

    return () => {
      isCancelled = true;
    };
  }, [scriptId, currentPage?.pageId]);

  // Handle base bounds emitted by PageImageLayer on load
  const handleImageLoad = useCallback((_img: HTMLImageElement, bounds: RenderedImageBounds) => {
    setBaseBounds(bounds);
    setTransform({
      x: bounds.x,
      y: bounds.y,
      zoom: 1.0,
      rotation: 0,
    });
  }, []);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setTransform((prev) => ({
      ...prev,
      zoom: Math.min(prev.zoom * 1.25, 4.0),
    }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform((prev) => ({
      ...prev,
      zoom: Math.max(prev.zoom / 1.25, 0.25),
    }));
  }, []);

  const handleResetZoom = useCallback(() => {
    if (baseBounds) {
      setTransform({
        x: baseBounds.x,
        y: baseBounds.y,
        zoom: 1.0,
        rotation: 0,
      });
    } else {
      setTransform((prev) => ({ ...prev, zoom: 1.0, x: 0, y: 0 }));
    }
  }, [baseBounds]);

  const handlePrevPage = useCallback(() => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex((prev) => prev - 1);
    }
  }, [currentPageIndex]);

  const handleNextPage = useCallback(() => {
    if (currentPageIndex < pages.length - 1) {
      setCurrentPageIndex((prev) => prev + 1);
    }
  }, [currentPageIndex, pages.length]);

  if (isLoadingPages) {
    return (
      <div className={`flex flex-col items-center justify-center min-h-[500px] bg-slate-900/5 rounded-xl border border-slate-200/80 p-8 ${className}`}>
        <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
        <p className="text-sm font-medium text-slate-600">Loading answer sheet...</p>
      </div>
    );
  }

  if (error || pages.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center min-h-[500px] bg-slate-50 rounded-xl border border-slate-200/80 p-8 text-center ${className}`}>
        <AlertCircle className="h-10 w-10 text-amber-500 mb-3" />
        <h3 className="text-base font-semibold text-slate-800">Answer Sheet Unavailable</h3>
        <p className="mt-1 text-sm text-slate-500 max-w-md">
          {error || 'No pages are available for this answer sheet.'}
        </p>
      </div>
    );
  }

  const imageUrl = currentPage
    ? `/api/student/results/${encodeURIComponent(scriptId)}/pages/${encodeURIComponent(currentPage.pageId)}/image`
    : '';

  return (
    <div className={`flex flex-col bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-slate-800 ${className}`}>
      {/* Read-Only Top Navigation & Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-950/90 border-b border-slate-800 text-slate-200 text-xs select-none">
        {/* Left: Exam title & Read-Only Badge */}
        <div className="flex items-center gap-2">
          {examTitle && (
            <span className="font-semibold text-slate-100 truncate max-w-[200px] sm:max-w-[320px]">
              {examTitle}
            </span>
          )}
          <span className="inline-flex items-center rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300 border border-slate-700">
            Read-Only
          </span>
        </div>

        {/* Center: Page Navigation */}
        <div className="flex items-center gap-1.5 bg-slate-900 rounded-lg p-1 border border-slate-800">
          <button
            type="button"
            onClick={handlePrevPage}
            disabled={currentPageIndex === 0}
            className="p-1 rounded hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition text-slate-300"
            title="Previous Page"
            aria-label="Previous Page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="px-2 font-mono text-[11px] text-slate-300">
            Page {currentPageIndex + 1} of {pages.length}
          </span>

          <button
            type="button"
            onClick={handleNextPage}
            disabled={currentPageIndex >= pages.length - 1}
            className="p-1 rounded hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition text-slate-300"
            title="Next Page"
            aria-label="Next Page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Right: Zoom & Visibility Controls */}
        <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1.5 rounded hover:bg-slate-800 transition text-slate-300"
            title="Zoom In"
            aria-label="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1.5 rounded hover:bg-slate-800 transition text-slate-300"
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetZoom}
            className="p-1.5 rounded hover:bg-slate-800 transition text-slate-300"
            title="Reset Fit"
            aria-label="Reset Fit"
          >
            <Maximize2 className="h-4 w-4" />
          </button>

          <div className="h-4 w-px bg-slate-800 mx-1" />

          <button
            type="button"
            onClick={() => setShowAnnotations((prev) => !prev)}
            className={`p-1.5 rounded transition ${
              showAnnotations
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'hover:bg-slate-800 text-slate-400'
            }`}
            title={showAnnotations ? 'Hide Annotations' : 'Show Annotations'}
            aria-label={showAnnotations ? 'Hide Annotations' : 'Show Annotations'}
          >
            {showAnnotations ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="relative w-full h-[700px] bg-slate-950 overflow-hidden">
        {isLoadingPageData && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900/80 backdrop-blur-sm text-slate-300 text-xs border border-slate-700/60 shadow">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            <span>Loading notes...</span>
          </div>
        )}

        <CanvasStage
          width="auto"
          height="auto"
          backgroundColor="#090d16"
          className="w-full h-full"
        >
          {/* Base Page Image Layer */}
          <PageImageLayer
            src={imageUrl}
            alt={`Answer sheet page ${currentPage?.pageNumber || 1}`}
            transform={transform}
            onTransformChange={setTransform}
            onImageLoad={handleImageLoad}
            enablePanZoom={true}
            fitMode="contain"
          />

          {/* Grader Pen Ink Strokes (Read-Only) */}
          <PenLayer
            transform={transform}
            pageKey={currentPage?.pageId || 'current'}
            isPenActive={false}
            isEraserActive={false}
            strokes={strokes}
            visible={showAnnotations}
            baseBounds={baseBounds}
          />

          {/* Grader Stamps, Highlights & Text Notes (Read-Only) */}
          <MarkLayer
            transform={transform}
            pageKey={currentPage?.pageId || 'current'}
            activeTool="none"
            annotations={annotations}
            visible={showAnnotations}
            disabled={true}
            baseBounds={baseBounds}
          />
        </CanvasStage>
      </div>
    </div>
  );
}

export default ReadOnlyScriptViewer;
