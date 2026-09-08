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
  appendPointToStroke,
} from '@/lib/penTool';
import type { PanZoomTransform } from '@/lib/panZoom';

export interface PenLayerProps {
  /** Parent Konva stage instance */
  stage?: Konva.Stage | null;
  /** Current pan/zoom transform */
  transform: PanZoomTransform;
  /** Page key (page ID or page index) */
  pageKey: string | number;
  /** Whether pen tool is currently active */
  isPenActive: boolean;
  /** Existing finalized strokes belonging to this page */
  strokes: FreehandStroke[];
  /** Callback fired when a new stroke is drawn and completed */
  onStrokeComplete?: (stroke: FreehandStroke) => void;
  /** Default pen stroke color */
  color?: string;
  /** Default pen stroke width */
  strokeWidth?: number;
}

export function PenLayer({
  stage: propStage,
  transform,
  pageKey,
  isPenActive,
  strokes,
  onStrokeComplete,
  color = DEFAULT_PEN_COLOR,
  strokeWidth = DEFAULT_PEN_WIDTH,
}: PenLayerProps) {
  const { stage: contextStage } = useCanvasStage();
  const stage = propStage || contextStage;

  const layerRef = useRef<Konva.Layer | null>(null);
  const groupRef = useRef<Konva.Group | null>(null);
  const linesMapRef = useRef<Map<string, Konva.Line>>(new Map());

  // Active stroke tracking refs (for real-time hardware drawing without React lag)
  const isDrawingRef = useRef(false);
  const activeStrokeRef = useRef<FreehandStroke | null>(null);
  const activeLineNodeRef = useRef<Konva.Line | null>(null);

  // Latest props refs to avoid stale closures in native listeners
  const transformRef = useRef(transform);
  const pageKeyRef = useRef(pageKey);
  const isPenActiveRef = useRef(isPenActive);
  const onStrokeCompleteRef = useRef(onStrokeComplete);
  const colorRef = useRef(color);
  const strokeWidthRef = useRef(strokeWidth);

  useEffect(() => {
    transformRef.current = transform;
    pageKeyRef.current = pageKey;
    isPenActiveRef.current = isPenActive;
    onStrokeCompleteRef.current = onStrokeComplete;
    colorRef.current = color;
    strokeWidthRef.current = strokeWidth;
  }, [transform, pageKey, isPenActive, onStrokeComplete, color, strokeWidth]);

  // Initialize Layer and Group
  useEffect(() => {
    if (!stage) return;

    const layer = new Konva.Layer({
      name: 'pen-stroke-layer',
      listening: false,
    });

    const group = new Konva.Group({
      name: 'pen-stroke-group',
      x: transform.x,
      y: transform.y,
      scaleX: transform.zoom,
      scaleY: transform.zoom,
      listening: false,
    });

    layer.add(group);
    stage.add(layer);

    const linesMap = linesMapRef.current;

    return () => {
      linesMap.clear();
      group.destroy();
      layer.destroy();
      layerRef.current = null;
      groupRef.current = null;
    };
  }, [stage, transform.x, transform.y, transform.zoom]);

  // Synchronize group transform with pan/zoom
  useEffect(() => {
    if (!groupRef.current || !layerRef.current) return;

    groupRef.current.position({ x: transform.x, y: transform.y });
    groupRef.current.scale({ x: transform.zoom, y: transform.zoom });
    layerRef.current.batchDraw();
  }, [transform.x, transform.y, transform.zoom]);

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
      onStrokeCompleteRef.current?.(completed);
    }

    activeStrokeRef.current = null;
    activeLineNodeRef.current = null;
  }, []);

  // Pointer event handlers for drawing
  useEffect(() => {
    if (!stage) return;

    const container = stage.container();
    if (!container) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (!isPenActiveRef.current) return;
      // Only draw on primary pointer button (left click or stylus tip or touch)
      if (e.button !== 0 && e.buttons !== 1 && e.pointerType === 'mouse') return;

      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const currentTransform = transformRef.current;
      const imagePoint = screenToImageCoordinates(screenX, screenY, currentTransform);

      const newStroke = createStroke(pageKeyRef.current, imagePoint, {
        color: colorRef.current,
        strokeWidth: strokeWidthRef.current,
        pressure: e.pressure,
      });

      isDrawingRef.current = true;
      activeStrokeRef.current = newStroke;

      // Add a live Konva.Line for instant rendering during drawing
      if (groupRef.current && layerRef.current) {
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
        groupRef.current.add(liveLine);
        activeLineNodeRef.current = liveLine;
        linesMapRef.current.set(newStroke.id, liveLine);
        layerRef.current.batchDraw();
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isPenActiveRef.current || !isDrawingRef.current || !activeStrokeRef.current) return;

      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const currentTransform = transformRef.current;
      const nextPoint = screenToImageCoordinates(screenX, screenY, currentTransform);

      // Append point to active stroke state
      const updated = appendPointToStroke(activeStrokeRef.current, nextPoint);
      activeStrokeRef.current = updated;

      // Update live Konva Line node
      if (activeLineNodeRef.current && layerRef.current) {
        activeLineNodeRef.current.points(updated.points);
        layerRef.current.batchDraw();
      }
    };

    const handlePointerUp = () => {
      if (isDrawingRef.current) {
        finalizeActiveStroke();
      }
    };

    const handlePointerCancel = () => {
      if (isDrawingRef.current) {
        finalizeActiveStroke();
      }
    };

    // Update container cursor when pen is active
    if (isPenActive) {
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
  }, [stage, isPenActive, finalizeActiveStroke]);

  return null;
}
