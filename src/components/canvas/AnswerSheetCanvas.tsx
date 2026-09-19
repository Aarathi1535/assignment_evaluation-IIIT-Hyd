'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type Konva from 'konva';
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
  Type,
  MousePointer,
  Trash2,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  Search,
} from 'lucide-react';
import { CanvasStage } from './CanvasStage';
import { PageImageLayer } from './PageImageLayer';
import { PenLayer } from './PenLayer';
import { MarkLayer } from './MarkLayer';
import { TextNoteEditor } from './TextNoteEditor';
import { MagnifierLoupe } from './MagnifierLoupe';
import { SaveStatusIndicator } from './SaveStatusIndicator';
import type { AnswerSheetCanvasProps, CanvasTool, SaveStatus } from './types';
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
  imageToScreenCoordinates,
} from '@/lib/penTool';
import {
  MarkAnnotation,
  filterAnnotationsByPage,
  createTextNoteAnnotation,
  moveAnnotation,
} from '@/lib/stampTool';
import {
  PageHistory,
  createInitialHistory,
  recordAddStroke,
  recordEraseStrokes,
  recordAddAnnotation,
  recordEraseAnnotations,
  recordMoveAnnotation,
  applyUndo,
  applyRedo,
  canUndo,
  canRedo,
} from '@/lib/annotationHistory';
import {
  deserializePageAnnotations,
  serializePageAnnotations,
} from '@/lib/annotationSerialization';
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
  enableSelect = true,
  selectedAnnotationId: propSelectedAnnotationId,
  onSelectAnnotation,
  onAnnotationMove,
  onAnnotationDelete,
  enablePenTool = true,
  initialPenActive = false,
  isPenActive: propIsPenActive,
  onPenActiveChange,
  enableEraserTool = true,
  enableLoupe = true,
  isLoupeActive: propIsLoupeActive,
  onLoupeActiveChange,
  loupeMagnification = 2.0,
  loupeDiameter = 180,
  brightness = 1.0,
  contrast = 1.0,
  enableStamps = true,
  enableHighlight = true,
  enableTextNote = true,
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
  enableOverlayToggle = true,
  isOverlayVisible: propIsOverlayVisible,
  initialOverlayVisible = true,
  onOverlayVisibilityChange,
  defaultStrokeColor = DEFAULT_PEN_COLOR,
  defaultStrokeWidth = DEFAULT_PEN_WIDTH,
  fallback,
  onLoad,
  onError,
  onTransformChange,
  scriptId,
  enableAnnotationLoading = true,
  loadAnnotationsUrl,
  fetchAnnotations,
  onAnnotationsLoaded,
  onAnnotationsLoadError,
  enableAutosave = true,
  debounceDelayMs = 800,
  saveAnnotationsUrl,
  saveAnnotations,
  onSaveStatusChange,
  onSaveSuccess,
  onSaveError,
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

  // Effective page identifier for loading (AE-136)
  const effectivePageIdentifier = useMemo(() => {
    if (currentPage?._id) return String(currentPage._id);
    if (currentPage?.id) return String(currentPage.id);
    if (typeof currentPage?.pageNumber === 'number') return currentPage.pageNumber;
    return activePageIndex + 1;
  }, [currentPage, activePageIndex]);

  // Active Tool state: 'none' | 'select' | 'pen' | 'check' | 'cross' | 'highlight' | 'text' | 'eraser' (AE-128 / AE-130 / AE-131 / AE-132)
  const [internalTool, setInternalTool] = useState<CanvasTool>(() =>
    initialPenActive ? 'pen' : 'none'
  );

  const activeTool = useMemo<CanvasTool>(() => {
    if (propActiveTool !== undefined) return propActiveTool;
    if (propIsLoupeActive !== undefined && propIsLoupeActive) return 'loupe';
    if (propIsPenActive !== undefined) return propIsPenActive ? 'pen' : 'none';
    return internalTool;
  }, [propActiveTool, propIsLoupeActive, propIsPenActive, internalTool]);

  // Selection state (AE-132)
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedAnnotationId =
    propSelectedAnnotationId !== undefined ? propSelectedAnnotationId : internalSelectedId;

  const activeSelectMode = activeTool === 'select';
  const activePenMode = activeTool === 'pen';
  const activeCheckMode = activeTool === 'check';
  const activeCrossMode = activeTool === 'cross';
  const activeHighlightMode = activeTool === 'highlight';
  const activeTextMode = activeTool === 'text';
  const activeEraserMode = activeTool === 'eraser';
  const activeLoupeMode = activeTool === 'loupe';
  const isDrawingToolActive =
    activeTool !== 'none' && activeTool !== 'select' && activeTool !== 'loupe';

  // Active in-place text note editor anchor state (AE-131)
  const [activeTextEditor, setActiveTextEditor] = useState<{
    imagePoint: { x: number; y: number };
  } | null>(null);

  // In-memory session cache & request sequence tracking for annotation hydration (AE-136)
  const loadedPagesCacheRef = useRef<Set<string>>(new Set());
  const activeRequestSeqRef = useRef<number>(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const [, setIsAnnotationsLoading] = useState<boolean>(false);
  const [, setAnnotationsLoadError] = useState<string | null>(null);

  const setTool = useCallback(
    (nextTool: CanvasTool) => {
      if (nextTool !== 'text') {
        setActiveTextEditor(null);
      }
      if (nextTool !== 'select') {
        setInternalSelectedId(null);
        onSelectAnnotation?.(null);
      }
      setInternalTool(nextTool);
      onToolChange?.(nextTool);
      onPenActiveChange?.(nextTool === 'pen');
      onLoupeActiveChange?.(nextTool === 'loupe');
    },
    [onToolChange, onPenActiveChange, onLoupeActiveChange, onSelectAnnotation]
  );

  const handleToggleSelect = useCallback(() => {
    setTool(activeSelectMode ? 'none' : 'select');
  }, [activeSelectMode, setTool]);

  const handleSelectAnnotation = useCallback(
    (id: string | null) => {
      setInternalSelectedId(id);
      onSelectAnnotation?.(id);
    },
    [onSelectAnnotation]
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

  const handleToggleText = useCallback(() => {
    setTool(activeTextMode ? 'none' : 'text');
  }, [activeTextMode, setTool]);

  const handleToggleEraser = useCallback(() => {
    setTool(activeEraserMode ? 'none' : 'eraser');
  }, [activeEraserMode, setTool]);

  const handleToggleLoupe = useCallback(() => {
    setTool(activeLoupeMode ? 'none' : 'loupe');
  }, [activeLoupeMode, setTool]);

  // Overlay visibility state (AE-133)
  const [internalOverlayVisible, setInternalOverlayVisible] = useState<boolean>(initialOverlayVisible);
  const isOverlayVisible = propIsOverlayVisible !== undefined ? propIsOverlayVisible : internalOverlayVisible;

  const handleToggleOverlayVisibility = useCallback(() => {
    const nextVisible = !isOverlayVisible;
    if (!nextVisible) {
      // Clear selection when hiding overlay
      setInternalSelectedId(null);
      onSelectAnnotation?.(null);
    }
    setInternalOverlayVisible(nextVisible);
    onOverlayVisibilityChange?.(nextVisible);
  }, [isOverlayVisible, onOverlayVisibilityChange, onSelectAnnotation]);

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

  // Autosave state & references (AE-137)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string>('');
  const pendingSaveRef = useRef<{
    pageKey: string;
    pageNumber: number;
    strokes: FreehandStroke[];
    annotations: MarkAnnotation[];
    imageBounds?: RenderedImageBounds | null;
  } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSeqRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  // Keep latest callback refs to prevent stale closures while preserving stable identities
  const onSaveStatusChangeRef = useRef(onSaveStatusChange);
  const onSaveSuccessRef = useRef(onSaveSuccess);
  const onSaveErrorRef = useRef(onSaveError);

  useEffect(() => {
    onSaveStatusChangeRef.current = onSaveStatusChange;
    onSaveSuccessRef.current = onSaveSuccess;
    onSaveErrorRef.current = onSaveError;
  }, [onSaveStatusChange, onSaveSuccess, onSaveError]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const executeSave = useCallback(
    async (payloadToSave: {
      pageKey: string;
      pageNumber: number;
      strokes: FreehandStroke[];
      annotations: MarkAnnotation[];
      imageBounds?: RenderedImageBounds | null;
    }) => {
      if (!scriptId) return;

      saveSeqRef.current += 1;
      const currentSaveSeq = saveSeqRef.current;

      setSaveStatus('saving');
      onSaveStatusChangeRef.current?.('saving');
      setSaveErrorMessage('');

      try {
        const serialized = serializePageAnnotations(
          payloadToSave.pageKey,
          payloadToSave.annotations,
          payloadToSave.strokes
        );

        let result: { success: boolean; error?: string } = { success: true };

        if (saveAnnotations) {
          result = await saveAnnotations({
            scriptId,
            pageNumber: payloadToSave.pageNumber,
            data: serialized,
          });
        } else {
          const url = saveAnnotationsUrl
            ? saveAnnotationsUrl(scriptId, payloadToSave.pageNumber)
            : `/api/scripts/${encodeURIComponent(scriptId)}/pages/${encodeURIComponent(String(payloadToSave.pageNumber))}/annotations`;

          const res = await fetch(url, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify(serialized),
          });

          if (!res.ok) {
            const errJson = await res.json().catch(() => null);
            const msg = errJson?.message || `Failed to save annotations (${res.status})`;
            throw new Error(msg);
          }
          result = { success: true };
        }

        if (!isMountedRef.current || saveSeqRef.current !== currentSaveSeq) {
          return;
        }

        if (result.success) {
          setSaveStatus('saved');
          onSaveStatusChangeRef.current?.('saved');
          onSaveSuccessRef.current?.(payloadToSave.pageNumber);
        } else {
          throw new Error(result.error || 'Failed to save annotations');
        }
      } catch (err: unknown) {
        if (!isMountedRef.current || saveSeqRef.current !== currentSaveSeq) {
          return;
        }
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setSaveStatus('error');
        setSaveErrorMessage(errorObj.message);
        onSaveStatusChangeRef.current?.('error');
        onSaveErrorRef.current?.(payloadToSave.pageNumber, errorObj);
      }
    },
    [scriptId, saveAnnotations, saveAnnotationsUrl]
  );

  const scheduleAutosave = useCallback(
    (targetStrokes: FreehandStroke[], targetAnnotations: MarkAnnotation[]) => {
      if (!enableAutosave || !scriptId) return;

      const targetPageNumber =
        typeof currentPage?.pageNumber === 'number'
          ? currentPage.pageNumber
          : activePageIndex + 1;
      const pageStrokes = filterStrokesByPage(targetStrokes, currentPageKey);
      const pageAnnotations = filterAnnotationsByPage(
        targetAnnotations,
        currentPageKey
      );

      const pendingData = {
        pageKey: currentPageKey,
        pageNumber: targetPageNumber,
        strokes: pageStrokes,
        annotations: pageAnnotations,
        imageBounds: baseBounds,
      };

      pendingSaveRef.current = pendingData;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (pendingSaveRef.current) {
          const toSave = pendingSaveRef.current;
          pendingSaveRef.current = null;
          executeSave(toSave);
        }
      }, debounceDelayMs);
    },
    [
      enableAutosave,
      scriptId,
      currentPage,
      activePageIndex,
      currentPageKey,
      baseBounds,
      debounceDelayMs,
      executeSave,
    ]
  );

  const flushPendingSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingSaveRef.current) {
      const toSave = pendingSaveRef.current;
      pendingSaveRef.current = null;
      executeSave(toSave);
    }
  }, [executeSave]);

  const handleRetrySave = useCallback(() => {
    const targetPageNumber =
      typeof currentPage?.pageNumber === 'number'
        ? currentPage.pageNumber
        : activePageIndex + 1;
    const pageStrokes = filterStrokesByPage(allStrokes, currentPageKey);
    const pageAnnotations = filterAnnotationsByPage(
      allAnnotations,
      currentPageKey
    );

    const retryData = {
      pageKey: currentPageKey,
      pageNumber: targetPageNumber,
      strokes: pageStrokes,
      annotations: pageAnnotations,
      imageBounds: baseBounds,
    };
    executeSave(retryData);
  }, [
    currentPage,
    activePageIndex,
    allStrokes,
    allAnnotations,
    currentPageKey,
    baseBounds,
    executeSave,
  ]);

  // Annotation Hydration Lifecycle (AE-136)
  useEffect(() => {
    // If annotation loading is disabled, no scriptId, or already loaded during this session, return
    if (!enableAnnotationLoading || !scriptId) return;

    const targetKey = currentPageKey;
    const targetIdentifier = effectivePageIdentifier;

    if (loadedPagesCacheRef.current.has(targetKey)) {
      return;
    }

    // Fetch annotations from backend
    activeRequestSeqRef.current += 1;
    const currentSeq = activeRequestSeqRef.current;

    // Abort previous in-flight request to prevent race conditions
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    setIsAnnotationsLoading(true);
    setAnnotationsLoadError(null);

    const executeFetch = async () => {
      try {
        let loadedData: { annotations: MarkAnnotation[]; strokes: FreehandStroke[] } | null = null;

        if (fetchAnnotations) {
          loadedData = await fetchAnnotations(
            scriptId,
            targetIdentifier,
            abortController.signal
          );
        } else {
          const url = loadAnnotationsUrl
            ? loadAnnotationsUrl(scriptId, targetIdentifier)
            : `/api/scripts/${encodeURIComponent(scriptId)}/pages/${encodeURIComponent(String(targetIdentifier))}/annotations`;

          const res = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: abortController.signal,
          });

          if (!res.ok) {
            const errJson = await res.json().catch(() => null);
            const msg = errJson?.message || `Failed to load annotations (${res.status})`;
            throw new Error(msg);
          }

          const json = await res.json();
          const rawPayload = json?.data || json;
          loadedData = deserializePageAnnotations(rawPayload, targetKey);
        }

        // Verify request is still current
        if (
          abortController.signal.aborted ||
          activeRequestSeqRef.current !== currentSeq
        ) {
          return;
        }

        const safeAnnotations = (loadedData?.annotations || []).map((a) => ({
          ...a,
          pageKey: targetKey,
        }));
        const safeStrokes = (loadedData?.strokes || []).map((s) => ({
          ...s,
          pageKey: targetKey,
        }));

        setInternalStrokes((prev) => {
          const others = prev.filter((s) => String(s.pageKey) !== String(targetKey));
          const next = [...others, ...safeStrokes];
          onStrokesChange?.(next);
          return next;
        });

        setInternalAnnotations((prev) => {
          const others = prev.filter((a) => String(a.pageKey) !== String(targetKey));
          const next = [...others, ...safeAnnotations];
          onAnnotationsChange?.(next);
          return next;
        });

        // Initialize clean undo/redo history (0 actions)
        setPageHistoryMap((prev) => ({
          ...prev,
          [targetKey]: createInitialHistory(),
        }));

        loadedPagesCacheRef.current.add(targetKey);
        setIsAnnotationsLoading(false);
        setAnnotationsLoadError(null);

        onAnnotationsLoaded?.({
          scriptId,
          pageId: String(currentPage?._id || currentPage?.id || ''),
          pageNumber: currentPage?.pageNumber || activePageIndex + 1,
          annotations: safeAnnotations,
          strokes: safeStrokes,
        });
      } catch (err: unknown) {
        if (abortController.signal.aborted) return;
        if (activeRequestSeqRef.current !== currentSeq) return;

        const errorObj = err instanceof Error ? err : new Error(String(err));
        setIsAnnotationsLoading(false);
        setAnnotationsLoadError(errorObj.message);
        onAnnotationsLoadError?.(errorObj, targetIdentifier);
      }
    };

    executeFetch();

    return () => {
      abortController.abort();
    };
  }, [
    enableAnnotationLoading,
    scriptId,
    currentPageKey,
    effectivePageIdentifier,
    currentPage,
    activePageIndex,
    fetchAnnotations,
    loadAnnotationsUrl,
    onAnnotationsLoaded,
    onAnnotationsLoadError,
    onStrokesChange,
    onAnnotationsChange,
  ]);

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
      scheduleAutosave(updated, allAnnotations);
    },
    [allStrokes, allAnnotations, currentPageHistory, currentPageKey, onStrokesChange, scheduleAutosave]
  );

  const handleAnnotationComplete = useCallback(
    (newAnnotation: MarkAnnotation) => {
      const updated = [...allAnnotations, newAnnotation];
      const newHistory = recordAddAnnotation(currentPageHistory, newAnnotation);

      setPageHistoryMap((prev) => ({ ...prev, [currentPageKey]: newHistory }));
      setInternalAnnotations(updated);
      onAnnotationsChange?.(updated);
      onAnnotationComplete?.(newAnnotation);
      scheduleAutosave(allStrokes, updated);
    },
    [allAnnotations, allStrokes, currentPageHistory, currentPageKey, onAnnotationsChange, onAnnotationComplete, scheduleAutosave]
  );

  const handleTextNoteClick = useCallback(
    (imagePoint: { x: number; y: number }) => {
      setActiveTextEditor({ imagePoint });
    },
    []
  );

  const handleConfirmTextNote = useCallback(
    (text: string) => {
      if (!activeTextEditor) return;
      const newNote = createTextNoteAnnotation(
        currentPageKey,
        activeTextEditor.imagePoint,
        text
      );
      handleAnnotationComplete(newNote);
      setActiveTextEditor(null);
    },
    [activeTextEditor, currentPageKey, handleAnnotationComplete]
  );

  const handleCancelTextNote = useCallback(() => {
    setActiveTextEditor(null);
  }, []);

  const handleAnnotationMove = useCallback(
    (
      id: string,
      newPosition: { x: number; y: number },
      previousPosition: { x: number; y: number }
    ) => {
      const updated = allAnnotations.map((a) =>
        a.id === id ? moveAnnotation(a, newPosition) : a
      );
      const newHistory = recordMoveAnnotation(
        currentPageHistory,
        id,
        previousPosition,
        newPosition
      );

      setPageHistoryMap((prev) => ({ ...prev, [currentPageKey]: newHistory }));
      setInternalAnnotations(updated);
      onAnnotationsChange?.(updated);
      onAnnotationMove?.(id, newPosition, previousPosition);
      scheduleAutosave(allStrokes, updated);
    },
    [
      allAnnotations,
      allStrokes,
      currentPageHistory,
      currentPageKey,
      onAnnotationsChange,
      onAnnotationMove,
      scheduleAutosave,
    ]
  );

  const handleDeleteSelected = useCallback(() => {
    if (!selectedAnnotationId) return;
    const target = allAnnotations.find((a) => a.id === selectedAnnotationId);
    if (!target) return;

    const pageAnnotationsBefore = filterAnnotationsByPage(
      allAnnotations,
      currentPageKey
    );
    const newHistory = recordEraseAnnotations(
      currentPageHistory,
      [target],
      pageAnnotationsBefore
    );
    const updated = allAnnotations.filter((a) => a.id !== selectedAnnotationId);

    setPageHistoryMap((prev) => ({ ...prev, [currentPageKey]: newHistory }));
    setInternalAnnotations(updated);
    setInternalSelectedId(null);
    onSelectAnnotation?.(null);
    onAnnotationsChange?.(updated);
    onAnnotationDelete?.(target);
    scheduleAutosave(allStrokes, updated);
  }, [
    selectedAnnotationId,
    allAnnotations,
    allStrokes,
    currentPageHistory,
    currentPageKey,
    onAnnotationsChange,
    onAnnotationDelete,
    onSelectAnnotation,
    scheduleAutosave,
  ]);

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
      scheduleAutosave(updated, allAnnotations);
    },
    [allStrokes, allAnnotations, currentPageHistory, currentPageKey, onStrokesChange, scheduleAutosave]
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
    scheduleAutosave(updatedStrokes, updatedAnnotations);
  }, [
    enableUndoRedo,
    currentPageHistory,
    allStrokes,
    allAnnotations,
    currentPageKey,
    onStrokesChange,
    onAnnotationsChange,
    onUndo,
    scheduleAutosave,
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
    scheduleAutosave(updatedStrokes, updatedAnnotations);
  }, [
    enableUndoRedo,
    currentPageHistory,
    allStrokes,
    allAnnotations,
    currentPageKey,
    onStrokesChange,
    onAnnotationsChange,
    onRedo,
    scheduleAutosave,
  ]);

  // Global / Canvas Keyboard Shortcuts: Delete/Backspace -> Delete selected annotation, Ctrl+Z -> Undo, Ctrl+Y -> Redo
  useEffect(() => {
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

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnotationId) {
          e.preventDefault();
          handleDeleteSelected();
          return;
        }
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Magnifier / Loupe toggle shortcut (M or L) when not modifying with Ctrl/Meta/Alt
      if (enableLoupe && !isCtrlOrCmd && !e.altKey && (key === 'm' || key === 'l')) {
        e.preventDefault();
        handleToggleLoupe();
        return;
      }

      if (!enableUndoRedo) return;
      if (!isCtrlOrCmd) return;

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
  }, [
    enableLoupe,
    handleToggleLoupe,
    enableUndoRedo,
    currentPageHistory,
    handleUndo,
    handleRedo,
    selectedAnnotationId,
    handleDeleteSelected,
  ]);

  // Handle page change navigation
  const navigateToPage = useCallback(
    (targetIndex: number) => {
      if (!sortedPages || totalPages <= 0) return;
      const clamped = clampPageIndex(targetIndex, totalPages);
      if (clamped === activePageIndex) return;

      // Flush any pending debounced autosave immediately before leaving current page
      flushPendingSave();

      setInternalSelectedId(null);
      onSelectAnnotation?.(null);
      setInternalPageIndex(clamped);
      setTransform({ x: 0, y: 0, zoom: 1.0 });
      setIsLoading(true);
      setHasError(false);
      setErrorMessage('');

      if (sortedPages[clamped]) {
        onPageChange?.(clamped, sortedPages[clamped]);
      }
    },
    [sortedPages, totalPages, activePageIndex, flushPendingSave, onPageChange, onSelectAnnotation]
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

  const [stageInstance, setStageInstance] = useState<Konva.Stage | null>(null);
  const handleStageReady = useCallback((stg: Konva.Stage | null) => {
    setStageInstance(stg);
  }, []);

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

      {/* Autosave Status Indicator (AE-137) */}
      {enableAutosave && Boolean(scriptId) && (
        <div className="absolute top-3 right-3 z-20" data-testid="autosave-status-wrapper">
          <SaveStatusIndicator
            status={saveStatus}
            onRetry={handleRetrySave}
            errorMessage={saveErrorMessage}
          />
        </div>
      )}

      {/* Canvas Stage */}
      <CanvasStage
        width={width}
        height={height}
        backgroundColor={backgroundColor}
        className="w-full h-full"
        onResize={handleResize}
        onStageReady={handleStageReady}
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

        {/* Freehand Pen & Eraser Drawing Layer (AE-126 / AE-127 / AE-128 / AE-129 / AE-133) */}
        <PenLayer
          transform={transform}
          pageKey={currentPageKey}
          isPenActive={activePenMode && !isLoading && !hasError && Boolean(effectiveSrc)}
          isEraserActive={activeEraserMode && !isLoading && !hasError && Boolean(effectiveSrc)}
          strokes={currentPageStrokes}
          visible={isOverlayVisible}
          onStrokeComplete={handleStrokeComplete}
          onStrokesErased={handleStrokesErased}
          smoothingOptions={smoothingOptions}
          color={effectiveStrokeColor}
          strokeWidth={effectiveStrokeWidth}
        />

        {/* Check, Cross, Highlight & Text Marks Layer (AE-130 / AE-131 / AE-132 / AE-133) */}
        <MarkLayer
          transform={transform}
          pageKey={currentPageKey}
          activeTool={activeTool}
          annotations={currentPageAnnotations}
          selectedAnnotationId={selectedAnnotationId}
          visible={isOverlayVisible}
          onSelectAnnotation={handleSelectAnnotation}
          onAnnotationMove={handleAnnotationMove}
          onAnnotationComplete={handleAnnotationComplete}
          onTextNoteClick={handleTextNoteClick}
          disabled={isLoading || hasError || !effectiveSrc}
        />
      </CanvasStage>

      {/* Magnifier / Loupe Inspection Lens (AE-152) */}
      <MagnifierLoupe
        active={activeLoupeMode && !isLoading && !hasError && Boolean(effectiveSrc)}
        stage={stageInstance}
        magnification={loupeMagnification}
        diameter={loupeDiameter}
        brightness={brightness}
        contrast={contrast}
      />

      {/* In-Place Text Note Editor Overlay (AE-131) */}
      {activeTextEditor && !isLoading && !hasError && Boolean(effectiveSrc) && (
        <TextNoteEditor
          x={imageToScreenCoordinates(activeTextEditor.imagePoint.x, activeTextEditor.imagePoint.y, transform).x}
          y={imageToScreenCoordinates(activeTextEditor.imagePoint.x, activeTextEditor.imagePoint.y, transform).y}
          onConfirm={handleConfirmTextNote}
          onCancel={handleCancelTextNote}
        />
      )}

      {/* Floating Toolbar: Zoom Controls & Select / Pen / Style / Stamps / Highlight / Text / Eraser / Delete / Undo / Redo Controls */}
      {showZoomControls && !isLoading && !hasError && effectiveSrc && (
        <div
          className="absolute bottom-3 right-3 flex items-center bg-white/90 backdrop-blur-xs border border-slate-200/80 rounded-lg shadow-md p-1 gap-1 z-20 transition-opacity"
          data-testid="canvas-zoom-controls"
          role="toolbar"
          aria-label="Canvas Zoom and Pen Controls"
        >
          {/* Select Tool Toggle (AE-132) */}
          {enableSelect && (
            <button
              type="button"
              onClick={handleToggleSelect}
              className={`p-1.5 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                activeSelectMode
                  ? 'bg-blue-600 text-white shadow-xs hover:bg-blue-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-pressed={activeSelectMode}
              aria-label="Toggle Select Tool"
              title={activeSelectMode ? 'Select Tool Active (Click to Disable)' : 'Enable Select Tool (Move / Delete)'}
              data-testid="canvas-select-toggle"
            >
              <MousePointer className="h-4 w-4" />
            </button>
          )}

          {/* Magnifier / Loupe Tool Toggle (AE-152) */}
          {enableLoupe && (
            <button
              type="button"
              onClick={handleToggleLoupe}
              className={`p-1.5 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                activeLoupeMode
                  ? 'bg-blue-600 text-white shadow-xs hover:bg-blue-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-pressed={activeLoupeMode}
              aria-label="Toggle Magnifier Loupe Tool"
              title={activeLoupeMode ? 'Magnifier Active (Click to Disable or Press M / L)' : 'Enable Magnifier Loupe (M / L)'}
              data-testid="canvas-loupe-toggle"
            >
              <Search className="h-4 w-4" />
            </button>
          )}

          {/* Delete Selected Annotation Button (AE-132) */}
          {enableSelect && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={!selectedAnnotationId}
              className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-35 disabled:hover:bg-transparent text-rose-600 transition-colors focus:outline-hidden focus:ring-2 focus:ring-rose-500"
              aria-label="Delete Selected Annotation"
              title="Delete Selected Annotation (Delete / Backspace)"
              data-testid="canvas-delete-button"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}

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

          {/* Text Note Tool Toggle (AE-131) */}
          {enableTextNote && (
            <button
              type="button"
              onClick={handleToggleText}
              className={`p-1.5 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                activeTextMode
                  ? 'bg-blue-600 text-white shadow-xs hover:bg-blue-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-pressed={activeTextMode}
              aria-label="Toggle Text Note Tool"
              title={activeTextMode ? 'Text Note Tool Active (Click to Disable)' : 'Enable Text Note Tool (T)'}
              data-testid="canvas-text-toggle"
            >
              <Type className={`h-4 w-4 ${activeTextMode ? 'text-white' : 'text-slate-700'}`} />
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

          {/* Annotation Overlay Visibility Toggle (AE-133) */}
          {enableOverlayToggle && (
            <>
              <div className="h-4 w-px bg-slate-200 mx-0.5" />
              <button
                type="button"
                onClick={handleToggleOverlayVisibility}
                className={`p-1.5 rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  !isOverlayVisible
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                aria-pressed={isOverlayVisible}
                aria-label="Toggle Annotation Overlay Visibility"
                title={
                  isOverlayVisible
                    ? 'Hide Annotation Overlay (Eye)'
                    : 'Show Annotation Overlay (EyeOff)'
                }
                data-testid="canvas-overlay-toggle"
              >
                {isOverlayVisible ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4 text-amber-700" />
                )}
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
