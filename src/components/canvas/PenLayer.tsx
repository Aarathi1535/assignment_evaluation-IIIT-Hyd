'use client';

import { useEffect, useRef, useCallback } from 'react';
import Konva from 'konva';
import { useCanvasStage } from './CanvasStage';
import {
  FreehandStroke,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_WIDTH,
  screenToImageCoordinates,
  createStroke,
} from '@/lib/penTool';
import {
  DEFAULT_ERASER_RADIUS,
  findIntersectingStrokes,
} from '@/lib/eraserTool';
import {
  appendSmoothedPointToStroke,
  finalizeSmoothedStroke,
  type SmoothingOptions,
} from '@/lib/strokeSmoothing';
import type { PanZoomTransform } from '@/lib/panZoom';
import {
  isCanvasProfilingEnabled,
  measureCanvasProfileBetweenTimes,
  measureCanvasProfileFromTimestamp,
} from '@/lib/canvasProfiling';

import type { RenderedImageBounds } from '@/lib/annotations';

export interface PenLayerProps {
  /** Parent Konva stage instance */
  stage?: Konva.Stage | null;
  /** Current pan/zoom transform */
  transform: PanZoomTransform;
  /** Page key (page ID or page index) */
  pageKey: string | number;
  /** Whether pen tool is currently active */
  isPenActive: boolean;
  /** Whether eraser tool is currently active (AE-128) */
  isEraserActive?: boolean;
  /** Existing finalized strokes belonging to this page */
  strokes: FreehandStroke[];
  /** Callback fired when a new stroke is drawn and completed */
  onStrokeComplete?: (stroke: FreehandStroke) => void;
  /** Callback fired when one or more strokes are erased in a gesture (AE-128) */
  onStrokesErased?: (erasedStrokes: FreehandStroke[]) => void;
  /** Eraser radius in invariant image coordinates */
  eraserRadius?: number;
  /** Optional stroke smoothing options (AE-129) */
  smoothingOptions?: SmoothingOptions;
  /** Whether the pen overlay layer is visible (default true, AE-133) */
  visible?: boolean;
  /** Default pen stroke color */
  color?: string;
  /** Default pen stroke width */
  strokeWidth?: number;
  /** Base image bounds for rotation pivot calculation (AE-150) */
  baseBounds?: RenderedImageBounds | null;
}

export function PenLayer({
  stage: propStage,
  transform,
  pageKey,
  isPenActive,
  isEraserActive = false,
  strokes,
  onStrokeComplete,
  onStrokesErased,
  eraserRadius = DEFAULT_ERASER_RADIUS,
  smoothingOptions,
  visible = true,
  color = DEFAULT_PEN_COLOR,
  strokeWidth = DEFAULT_PEN_WIDTH,
  baseBounds = null,
}: PenLayerProps) {
  const { stage: contextStage } = useCanvasStage();
  const stage = propStage || contextStage;

  const layerRef = useRef<Konva.Layer | null>(null);
  const groupRef = useRef<Konva.Group | null>(null);
  const activeLayerRef = useRef<Konva.Layer | null>(null);
  const activeGroupRef = useRef<Konva.Group | null>(null);
  const linesMapRef = useRef<Map<string, Konva.Line>>(new Map());

  // Active stroke tracking refs (for real-time hardware drawing without React lag)
  const isDrawingRef = useRef(false);
  const activeStrokeRef = useRef<FreehandStroke | null>(null);
  const activeLineNodeRef = useRef<Konva.Line | null>(null);

  // Active erasing tracking refs (AE-128)
  const isErasingRef = useRef(false);
  const erasedInGestureRef = useRef<Map<string, FreehandStroke>>(new Map());

  // Latest props refs to avoid stale closures in native listeners
  const transformRef = useRef(transform);
  const pageKeyRef = useRef(pageKey);
  const isPenActiveRef = useRef(isPenActive);
  const isEraserActiveRef = useRef(isEraserActive);
  const strokesRef = useRef(strokes);
  const onStrokeCompleteRef = useRef(onStrokeComplete);
  const onStrokesErasedRef = useRef(onStrokesErased);
  const eraserRadiusRef = useRef(eraserRadius);
  const smoothingOptionsRef = useRef(smoothingOptions);
  const visibleRef = useRef(visible);
  const colorRef = useRef(color);
  const strokeWidthRef = useRef(strokeWidth);
  const baseBoundsRef = useRef(baseBounds);

  useEffect(() => {
    transformRef.current = transform;
    pageKeyRef.current = pageKey;
    isPenActiveRef.current = isPenActive;
    isEraserActiveRef.current = isEraserActive;
    strokesRef.current = strokes;
    onStrokeCompleteRef.current = onStrokeComplete;
    onStrokesErasedRef.current = onStrokesErased;
    eraserRadiusRef.current = eraserRadius;
    smoothingOptionsRef.current = smoothingOptions;
    visibleRef.current = visible;
    colorRef.current = color;
    strokeWidthRef.current = strokeWidth;
    baseBoundsRef.current = baseBounds;
  }, [
    transform,
    pageKey,
    isPenActive,
    isEraserActive,
    strokes,
    onStrokeComplete,
    onStrokesErased,
    eraserRadius,
    smoothingOptions,
    visible,
    color,
    strokeWidth,
    baseBounds,
  ]);

  // Helper to sync group transform with pan, zoom, rotation & center pivot
  const syncGroupTransform = useCallback(() => {
    if (!groupRef.current) return;
    const currentTransform = transformRef.current;
    const bounds = baseBoundsRef.current;
    const rotation = currentTransform.rotation || 0;

    const groups = [groupRef.current];
    if (activeGroupRef.current) {
      groups.push(activeGroupRef.current);
    }

    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const cx = bounds.width / 2;
      const cy = bounds.height / 2;
      groups.forEach(g => {
        g.position({
          x: currentTransform.x + cx * currentTransform.zoom,
          y: currentTransform.y + cy * currentTransform.zoom,
        });
        g.offset({ x: cx, y: cy });
        g.scale({ x: currentTransform.zoom, y: currentTransform.zoom });
        g.rotation(rotation);
      });
    } else {
      groups.forEach(g => {
        g.position({ x: currentTransform.x, y: currentTransform.y });
        g.offset({ x: 0, y: 0 });
        g.scale({ x: currentTransform.zoom, y: currentTransform.zoom });
        g.rotation(rotation);
      });
    }
  }, []);

  // Initialize Layer and Group
  useEffect(() => {
    if (!stage) return;

    const layer = new Konva.Layer({
      name: 'pen-stroke-layer',
      listening: false,
      visible,
    });

    const group = new Konva.Group({
      name: 'pen-stroke-group',
      listening: false,
      visible,
    });

    const activeLayer = new Konva.Layer({
      name: 'active-pen-stroke-layer',
      listening: false,
      visible,
    });

    const activeGroup = new Konva.Group({
      name: 'active-pen-stroke-group',
      listening: false,
      visible,
    });

    layer.add(group);
    activeLayer.add(activeGroup);
    stage.add(layer);
    stage.add(activeLayer);

    layerRef.current = layer;
    groupRef.current = group;
    activeLayerRef.current = activeLayer;
    activeGroupRef.current = activeGroup;
    syncGroupTransform();

    const linesMap = linesMapRef.current;

    return () => {
      linesMap.clear();
      group.destroy();
      layer.destroy();
      activeGroup.destroy();
      activeLayer.destroy();
      layerRef.current = null;
      groupRef.current = null;
      activeLayerRef.current = null;
      activeGroupRef.current = null;
    };
  }, [stage, visible, syncGroupTransform]);

  // Synchronize visibility changes
  useEffect(() => {
    if (!layerRef.current || !groupRef.current) return;
    layerRef.current.visible(visible);
    groupRef.current.visible(visible);
    layerRef.current.batchDraw();
    if (activeLayerRef.current && activeGroupRef.current) {
      activeLayerRef.current.visible(visible);
      activeGroupRef.current.visible(visible);
      activeLayerRef.current.batchDraw();
    }
  }, [visible]);

  // Synchronize group transform with pan/zoom/rotation
  useEffect(() => {
    if (!groupRef.current || !layerRef.current) return;
    syncGroupTransform();
    layerRef.current.batchDraw();
    if (activeLayerRef.current) {
      activeLayerRef.current.batchDraw();
    }
  }, [transform.x, transform.y, transform.zoom, transform.rotation, baseBounds, syncGroupTransform]);

  // Re-render committed strokes when strokes list or page changes
  useEffect(() => {
    if (!groupRef.current || !layerRef.current) return;

    const group = groupRef.current;
    const currentLines = linesMapRef.current;

    // Track active IDs
    const strokeIdSet = new Set(strokes.map((s) => s.id));

    // Remove nodes that are no longer present
    for (const [id, lineNode] of currentLines.entries()) {
      if (!strokeIdSet.has(id)) {
        lineNode.destroy();
        currentLines.delete(id);
      }
    }

    // Add or update line nodes
    for (const stroke of strokes) {
      let lineNode = currentLines.get(stroke.id);
      if (!lineNode) {
        lineNode = new Konva.Line({
          id: stroke.id,
          points: stroke.points,
          stroke: stroke.color,
          strokeWidth: stroke.strokeWidth,
          tension: 0.2,
          lineCap: 'round',
          lineJoin: 'round',
          listening: false,
        });
        group.add(lineNode);
        currentLines.set(stroke.id, lineNode);
      } else {
        lineNode.points(stroke.points);
        lineNode.stroke(stroke.color);
        lineNode.strokeWidth(stroke.strokeWidth);
      }
    }

    layerRef.current.batchDraw();
  }, [strokes, pageKey]);

  // Finalize active stroke helper
  const finalizeActiveStroke = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const completed = activeStrokeRef.current;
    if (completed && completed.points.length >= 2) {
      const smoothed = finalizeSmoothedStroke(completed, smoothingOptionsRef.current);
      if (activeLineNodeRef.current && activeLayerRef.current && groupRef.current && layerRef.current) {
        // Move live line to the committed group to prevent 1-frame flicker
        const node = activeLineNodeRef.current;
        node.moveTo(groupRef.current);
        node.points(smoothed.points);
        linesMapRef.current.set(completed.id, node);

        activeLayerRef.current.batchDraw();
        layerRef.current.batchDraw();
      }
      onStrokeCompleteRef.current?.(smoothed);
    } else if (activeLineNodeRef.current && activeLayerRef.current) {
      activeLineNodeRef.current.destroy();
      activeLayerRef.current.batchDraw();
    }

    activeStrokeRef.current = null;
    activeLineNodeRef.current = null;
  }, []);

  // Pointer event handlers for drawing
  useEffect(() => {
    if (!stage) return;

    const container = stage.container();
    if (!container) return;

    const finalizeErasingGesture = () => {
      if (!isErasingRef.current) return;
      isErasingRef.current = false;

      if (erasedInGestureRef.current.size > 0) {
        const erasedList = Array.from(erasedInGestureRef.current.values());
        erasedInGestureRef.current.clear();
        onStrokesErasedRef.current?.(erasedList);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      // If overlay is hidden, ignore all pen/eraser pointer interactions
      if (!visibleRef.current) return;

      // Only draw/erase on primary pointer button (left click or stylus tip or touch)
      if (e.button !== 0 && e.buttons !== 1 && e.pointerType === 'mouse') return;

      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const currentTransform = transformRef.current;
      const imagePoint = screenToImageCoordinates(
        screenX,
        screenY,
        currentTransform,
        baseBoundsRef.current || undefined
      );

      if (isEraserActiveRef.current) {
        isErasingRef.current = true;
        erasedInGestureRef.current.clear();

        const hitStrokes = findIntersectingStrokes(
          strokesRef.current,
          imagePoint,
          eraserRadiusRef.current
        );

        if (hitStrokes.length > 0) {
          for (const hit of hitStrokes) {
            erasedInGestureRef.current.set(hit.id, hit);
            const node = linesMapRef.current.get(hit.id);
            if (node) {
              node.visible(false);
            }
          }
          layerRef.current?.batchDraw();
        }
        return;
      }

      if (!isPenActiveRef.current) return;

      const newStroke = createStroke(pageKeyRef.current, imagePoint, {
        color: colorRef.current,
        strokeWidth: strokeWidthRef.current,
        pressure: e.pressure,
      });

      isDrawingRef.current = true;
      activeStrokeRef.current = newStroke;

      // Add a live Konva.Line for instant rendering during drawing
      if (activeGroupRef.current && activeLayerRef.current) {
        const liveLine = new Konva.Line({
          id: newStroke.id,
          points: newStroke.points,
          stroke: newStroke.color,
          strokeWidth: newStroke.strokeWidth,
          tension: 0.2,
          lineCap: 'round',
          lineJoin: 'round',
          listening: false,
        });
        activeGroupRef.current.add(liveLine);
        activeLineNodeRef.current = liveLine;
        activeLayerRef.current.batchDraw();
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const pointerEventTime = e.timeStamp;
      const isDevProfiling = isCanvasProfilingEnabled();

      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const currentTransform = transformRef.current;
      const nextPoint = screenToImageCoordinates(
        screenX,
        screenY,
        currentTransform,
        baseBoundsRef.current || undefined
      );

      if (isEraserActiveRef.current && isErasingRef.current) {
        const remaining = strokesRef.current.filter(
          (s) => !erasedInGestureRef.current.has(s.id)
        );
        const hitStrokes = findIntersectingStrokes(
          remaining,
          nextPoint,
          eraserRadiusRef.current
        );

        if (hitStrokes.length > 0) {
          for (const hit of hitStrokes) {
            erasedInGestureRef.current.set(hit.id, hit);
            const node = linesMapRef.current.get(hit.id);
            if (node) {
              node.visible(false);
            }
          }
          layerRef.current?.batchDraw();
        }
        return;
      }

      if (!isPenActiveRef.current || !isDrawingRef.current || !activeStrokeRef.current) return;

      // Append smoothed point to active stroke state
      const updated = appendSmoothedPointToStroke(
        activeStrokeRef.current,
        nextPoint,
        smoothingOptionsRef.current
      );

      if (updated !== activeStrokeRef.current) {
        activeStrokeRef.current = updated;

        // Update live Konva Line node
        if (activeLineNodeRef.current && activeLayerRef.current) {
          const batchDrawStartedAt = isDevProfiling ? performance.now() : 0;
          activeLineNodeRef.current.points(updated.points);
          activeLayerRef.current.batchDraw();

          if (isDevProfiling) {
            measureCanvasProfileBetweenTimes('konva-batchDraw-call', batchDrawStartedAt, performance.now());
            requestAnimationFrame(() => {
              measureCanvasProfileFromTimestamp('pointermove->next-raf', pointerEventTime);
            });
          }
        }
      }
    };

    const handlePointerUp = () => {
      if (isErasingRef.current) {
        finalizeErasingGesture();
      }
      if (isDrawingRef.current) {
        finalizeActiveStroke();
      }
    };

    const handlePointerCancel = () => {
      if (isErasingRef.current) {
        finalizeErasingGesture();
      }
      if (isDrawingRef.current) {
        finalizeActiveStroke();
      }
    };

    // Update container cursor
    if (!visible) {
      container.style.cursor = 'default';
    } else if (isEraserActive) {
      container.style.cursor = 'cell';
    } else if (isPenActive) {
      container.style.cursor = 'crosshair';
    }

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [stage, isPenActive, isEraserActive, visible, finalizeActiveStroke]);

  return null;
}
