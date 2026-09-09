'use client';

import { useEffect, useRef } from 'react';
import Konva from 'konva';
import { useCanvasStage } from './CanvasStage';
import {
  CheckAnnotation,
  CrossAnnotation,
  HighlightAnnotation,
  TextNoteAnnotation,
  MarkAnnotation,
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  normalizeHighlightRect,
  DEFAULT_CHECK_COLOR,
  DEFAULT_CROSS_COLOR,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_HIGHLIGHT_OPACITY,
  DEFAULT_STAMP_SIZE,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_BG_COLOR,
  DEFAULT_TEXT_BORDER_COLOR,
} from '@/lib/stampTool';
import { screenToImageCoordinates } from '@/lib/penTool';
import type { PanZoomTransform } from '@/lib/panZoom';
import type { CanvasTool } from './types';

export interface MarkLayerProps {
  /** Parent Konva stage instance */
  stage?: Konva.Stage | null;
  /** Current pan/zoom transform */
  transform: PanZoomTransform;
  /** Page key (page ID or page index) */
  pageKey: string | number;
  /** Active canvas tool */
  activeTool: CanvasTool;
  /** Existing finalized mark annotations belonging to this page */
  annotations: MarkAnnotation[];
  /** Callback fired when a new check, cross, or highlight annotation is completed */
  onAnnotationComplete?: (annotation: MarkAnnotation) => void;
  /** Callback fired when the canvas is clicked with the Text Note tool active (AE-131) */
  onTextNoteClick?: (
    imagePoint: { x: number; y: number },
    screenPoint: { x: number; y: number }
  ) => void;
  /** Whether the layer interactions are disabled (e.g. image loading or error) */
  disabled?: boolean;
}

export function MarkLayer({
  stage: propStage,
  transform,
  pageKey,
  activeTool,
  annotations,
  onAnnotationComplete,
  onTextNoteClick,
  disabled = false,
}: MarkLayerProps) {
  const { stage: contextStage } = useCanvasStage();
  const stage = propStage || contextStage;

  const layerRef = useRef<Konva.Layer | null>(null);
  const groupRef = useRef<Konva.Group | null>(null);
  const nodesMapRef = useRef<Map<string, Konva.Node>>(new Map());

  // Active highlight preview refs
  const isHighlightingRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const livePreviewRectRef = useRef<Konva.Rect | null>(null);

  // Latest props refs to avoid stale closures in event listeners
  const transformRef = useRef(transform);
  const pageKeyRef = useRef(pageKey);
  const activeToolRef = useRef(activeTool);
  const onAnnotationCompleteRef = useRef(onAnnotationComplete);
  const onTextNoteClickRef = useRef(onTextNoteClick);
  const disabledRef = useRef(disabled);

  useEffect(() => {
    transformRef.current = transform;
    pageKeyRef.current = pageKey;
    activeToolRef.current = activeTool;
    onAnnotationCompleteRef.current = onAnnotationComplete;
    onTextNoteClickRef.current = onTextNoteClick;
    disabledRef.current = disabled;
  }, [transform, pageKey, activeTool, onAnnotationComplete, onTextNoteClick, disabled]);

  // Initialize Layer and Group
  useEffect(() => {
    if (!stage) return;

    const layer = new Konva.Layer({
      name: 'mark-annotation-layer',
      listening: false,
    });

    const group = new Konva.Group({
      name: 'mark-annotation-group',
      x: transform.x,
      y: transform.y,
      scaleX: transform.zoom,
      scaleY: transform.zoom,
      listening: false,
    });

    layer.add(group);
    stage.add(layer);

    layerRef.current = layer;
    groupRef.current = group;
    const nodesMap = nodesMapRef.current;

    return () => {
      nodesMap.clear();
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

  // Re-render committed annotations when annotations list or page changes
  useEffect(() => {
    if (!groupRef.current || !layerRef.current) return;

    const group = groupRef.current;
    const currentNodes = nodesMapRef.current;

    // Track active IDs
    const annotationIdSet = new Set(annotations.map((a) => a.id));

    // Remove nodes that are no longer present
    for (const [id, node] of currentNodes.entries()) {
      if (!annotationIdSet.has(id)) {
        node.destroy();
        currentNodes.delete(id);
      }
    }

    // Add or update annotation nodes
    for (const ann of annotations) {
      const existingNode = currentNodes.get(ann.id);

      if (ann.type === 'check') {
        const check = ann as CheckAnnotation;
        const S = check.size || DEFAULT_STAMP_SIZE;
        const points = [
          check.x - S * 0.35,
          check.y + S * 0.05,
          check.x - S * 0.05,
          check.y + S * 0.35,
          check.x + S * 0.45,
          check.y - S * 0.35,
        ];

        if (!existingNode) {
          const lineNode = new Konva.Line({
            id: check.id,
            points,
            stroke: check.color || DEFAULT_CHECK_COLOR,
            strokeWidth: 3.5,
            lineCap: 'round',
            lineJoin: 'round',
            listening: false,
          });
          group.add(lineNode);
          currentNodes.set(check.id, lineNode);
        } else if (existingNode instanceof Konva.Line) {
          existingNode.points(points);
          existingNode.stroke(check.color || DEFAULT_CHECK_COLOR);
        }
      } else if (ann.type === 'cross') {
        const cross = ann as CrossAnnotation;
        const S = cross.size || DEFAULT_STAMP_SIZE;
        const pathData = `M ${cross.x - S * 0.35} ${cross.y - S * 0.35} L ${cross.x + S * 0.35} ${cross.y + S * 0.35} M ${cross.x + S * 0.35} ${cross.y - S * 0.35} L ${cross.x - S * 0.35} ${cross.y + S * 0.35}`;

        if (!existingNode) {
          const pathNode = new Konva.Path({
            id: cross.id,
            data: pathData,
            stroke: cross.color || DEFAULT_CROSS_COLOR,
            strokeWidth: 3.5,
            lineCap: 'round',
            lineJoin: 'round',
            listening: false,
          });
          group.add(pathNode);
          currentNodes.set(cross.id, pathNode);
        } else if (existingNode instanceof Konva.Path) {
          existingNode.data(pathData);
          existingNode.stroke(cross.color || DEFAULT_CROSS_COLOR);
        }
      } else if (ann.type === 'highlight') {
        const hl = ann as HighlightAnnotation;

        if (!existingNode) {
          const rectNode = new Konva.Rect({
            id: hl.id,
            x: hl.x,
            y: hl.y,
            width: hl.width,
            height: hl.height,
            fill: hl.color || DEFAULT_HIGHLIGHT_COLOR,
            opacity: hl.opacity ?? DEFAULT_HIGHLIGHT_OPACITY,
            stroke: '#ca8a04',
            strokeWidth: 1,
            cornerRadius: 2,
            listening: false,
          });
          group.add(rectNode);
          currentNodes.set(hl.id, rectNode);
        } else if (existingNode instanceof Konva.Rect) {
          existingNode.position({ x: hl.x, y: hl.y });
          existingNode.size({ width: hl.width, height: hl.height });
          existingNode.fill(hl.color || DEFAULT_HIGHLIGHT_COLOR);
          existingNode.opacity(hl.opacity ?? DEFAULT_HIGHLIGHT_OPACITY);
        }
      } else if (ann.type === 'text') {
        const note = ann as TextNoteAnnotation;

        if (!existingNode) {
          const noteGroup = new Konva.Group({
            id: note.id,
            x: note.x,
            y: note.y,
            listening: false,
          });

          const noteText = new Konva.Text({
            text: note.text,
            fontSize: note.fontSize || DEFAULT_TEXT_FONT_SIZE,
            fontFamily: 'sans-serif',
            fill: note.color || DEFAULT_TEXT_COLOR,
            padding: 6,
            listening: false,
          });

          const noteBg = new Konva.Rect({
            width: noteText.width(),
            height: noteText.height(),
            fill: note.backgroundColor || DEFAULT_TEXT_BG_COLOR,
            stroke: note.borderColor || DEFAULT_TEXT_BORDER_COLOR,
            strokeWidth: 1,
            cornerRadius: 4,
            shadowColor: 'rgba(0, 0, 0, 0.15)',
            shadowBlur: 3,
            shadowOffset: { x: 1, y: 1 },
            shadowOpacity: 0.8,
            listening: false,
          });

          noteGroup.add(noteBg);
          noteGroup.add(noteText);
          group.add(noteGroup);
          currentNodes.set(note.id, noteGroup);
        } else if (existingNode instanceof Konva.Group) {
          existingNode.position({ x: note.x, y: note.y });
          const textNode = existingNode.findOne<Konva.Text>('Text');
          const rectNode = existingNode.findOne<Konva.Rect>('Rect');
          if (textNode) {
            textNode.text(note.text);
            textNode.fontSize(note.fontSize || DEFAULT_TEXT_FONT_SIZE);
            textNode.fill(note.color || DEFAULT_TEXT_COLOR);
            if (rectNode) {
              rectNode.width(textNode.width());
              rectNode.height(textNode.height());
              rectNode.fill(note.backgroundColor || DEFAULT_TEXT_BG_COLOR);
              rectNode.stroke(note.borderColor || DEFAULT_TEXT_BORDER_COLOR);
            }
          }
        }
      }
    }

    layerRef.current.batchDraw();
  }, [annotations, pageKey]);

  // Pointer event handlers for placing Check, Cross, Highlight, and Text annotations
  useEffect(() => {
    if (!stage) return;

    const container = stage.container();
    if (!container) return;

    const isMarkTool =
      !disabled &&
      (activeTool === 'check' ||
        activeTool === 'cross' ||
        activeTool === 'highlight' ||
        activeTool === 'text');

    if (!isMarkTool) return;

    container.style.cursor = activeTool === 'text' ? 'text' : 'crosshair';

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.buttons !== 1 && e.pointerType === 'mouse') return;
      if (disabledRef.current) return;

      const currentTool = activeToolRef.current;
      if (
        currentTool !== 'check' &&
        currentTool !== 'cross' &&
        currentTool !== 'highlight' &&
        currentTool !== 'text'
      ) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const imagePoint = screenToImageCoordinates(screenX, screenY, transformRef.current);

      if (currentTool === 'text') {
        onTextNoteClickRef.current?.(imagePoint, { x: screenX, y: screenY });
        return;
      }

      if (currentTool === 'check') {
        const check = createCheckAnnotation(pageKeyRef.current, imagePoint);
        onAnnotationCompleteRef.current?.(check);
        return;
      }

      if (currentTool === 'cross') {
        const cross = createCrossAnnotation(pageKeyRef.current, imagePoint);
        onAnnotationCompleteRef.current?.(cross);
        return;
      }

      if (currentTool === 'highlight') {
        isHighlightingRef.current = true;
        startPointRef.current = imagePoint;

        // Create live preview rectangle
        if (groupRef.current && layerRef.current) {
          const previewRect = new Konva.Rect({
            x: imagePoint.x,
            y: imagePoint.y,
            width: 0,
            height: 0,
            fill: DEFAULT_HIGHLIGHT_COLOR,
            opacity: DEFAULT_HIGHLIGHT_OPACITY,
            stroke: '#ca8a04',
            strokeWidth: 1,
            dash: [4, 4],
            cornerRadius: 2,
            listening: false,
          });
          groupRef.current.add(previewRect);
          livePreviewRectRef.current = previewRect;
          layerRef.current.batchDraw();
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isHighlightingRef.current || !startPointRef.current) return;

      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const currentPoint = screenToImageCoordinates(screenX, screenY, transformRef.current);

      const normalized = normalizeHighlightRect(startPointRef.current, currentPoint);

      if (livePreviewRectRef.current && layerRef.current) {
        livePreviewRectRef.current.position({ x: normalized.x, y: normalized.y });
        livePreviewRectRef.current.size({ width: normalized.width, height: normalized.height });
        layerRef.current.batchDraw();
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isHighlightingRef.current || !startPointRef.current) return;
      isHighlightingRef.current = false;

      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const endPoint = screenToImageCoordinates(screenX, screenY, transformRef.current);

      const normalized = normalizeHighlightRect(startPointRef.current, endPoint);
      startPointRef.current = null;

      // Clean up live preview
      if (livePreviewRectRef.current) {
        livePreviewRectRef.current.destroy();
        livePreviewRectRef.current = null;
        layerRef.current?.batchDraw();
      }

      // Minimum dimension threshold to prevent accidental clicks
      if (normalized.width >= 3 && normalized.height >= 3) {
        const highlight = createHighlightAnnotation(pageKeyRef.current, normalized);
        onAnnotationCompleteRef.current?.(highlight);
      }
    };

    const handlePointerCancel = () => {
      if (isHighlightingRef.current) {
        isHighlightingRef.current = false;
        startPointRef.current = null;
        if (livePreviewRectRef.current) {
          livePreviewRectRef.current.destroy();
          livePreviewRectRef.current = null;
          layerRef.current?.batchDraw();
        }
      }
    };

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
  }, [stage, activeTool, disabled]);

  return null;
}
