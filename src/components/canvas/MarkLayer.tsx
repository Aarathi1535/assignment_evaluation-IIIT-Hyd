'use client';

import { useEffect, useRef, useCallback } from 'react';
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

import type { RenderedImageBounds } from '@/lib/annotations';

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
  /** Controlled selected annotation ID (AE-132) */
  selectedAnnotationId?: string | null;
  /** Callback fired when an annotation is selected or deselected (AE-132) */
  onSelectAnnotation?: (id: string | null) => void;
  /** Callback fired when an annotation is moved (AE-132) */
  onAnnotationMove?: (
    id: string,
    newPosition: { x: number; y: number },
    previousPosition: { x: number; y: number }
  ) => void;
  /** Callback fired when a new check, cross, or highlight annotation is completed */
  onAnnotationComplete?: (annotation: MarkAnnotation) => void;
  /** Callback fired when the canvas is clicked with the Text Note tool active (AE-131) */
  onTextNoteClick?: (
    imagePoint: { x: number; y: number },
    screenPoint: { x: number; y: number }
  ) => void;
  /** Whether the mark overlay layer is visible (default true, AE-133) */
  visible?: boolean;
  /** Whether the layer interactions are disabled (e.g. image loading or error) */
  disabled?: boolean;
  /** Base image bounds for rotation pivot calculation (AE-150) */
  baseBounds?: RenderedImageBounds | null;
}

export function MarkLayer({
  stage: propStage,
  transform,
  pageKey,
  activeTool,
  annotations,
  selectedAnnotationId = null,
  onSelectAnnotation,
  onAnnotationMove,
  onAnnotationComplete,
  onTextNoteClick,
  visible = true,
  disabled = false,
  baseBounds = null,
}: MarkLayerProps) {
  const { stage: contextStage } = useCanvasStage();
  const stage = propStage || contextStage;

  const layerRef = useRef<Konva.Layer | null>(null);
  const groupRef = useRef<Konva.Group | null>(null);
  const nodesMapRef = useRef<Map<string, Konva.Group>>(new Map());

  // Active highlight preview refs
  const isHighlightingRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const livePreviewRectRef = useRef<Konva.Rect | null>(null);
  const isDraggingAnnotationRef = useRef(false);

  // Latest props refs to avoid stale closures in event listeners
  const transformRef = useRef(transform);
  const pageKeyRef = useRef(pageKey);
  const activeToolRef = useRef(activeTool);
  const selectedAnnotationIdRef = useRef(selectedAnnotationId);
  const onSelectAnnotationRef = useRef(onSelectAnnotation);
  const onAnnotationMoveRef = useRef(onAnnotationMove);
  const onAnnotationCompleteRef = useRef(onAnnotationComplete);
  const onTextNoteClickRef = useRef(onTextNoteClick);
  const visibleRef = useRef(visible);
  const disabledRef = useRef(disabled);
  const baseBoundsRef = useRef(baseBounds);

  useEffect(() => {
    transformRef.current = transform;
    pageKeyRef.current = pageKey;
    activeToolRef.current = activeTool;
    selectedAnnotationIdRef.current = selectedAnnotationId;
    onSelectAnnotationRef.current = onSelectAnnotation;
    onAnnotationMoveRef.current = onAnnotationMove;
    onAnnotationCompleteRef.current = onAnnotationComplete;
    onTextNoteClickRef.current = onTextNoteClick;
    visibleRef.current = visible;
    disabledRef.current = disabled;
    baseBoundsRef.current = baseBounds;
  }, [
    transform,
    pageKey,
    activeTool,
    selectedAnnotationId,
    onSelectAnnotation,
    onAnnotationMove,
    onAnnotationComplete,
    onTextNoteClick,
    visible,
    disabled,
    baseBounds,
  ]);

  // Helper to sync group transform with pan, zoom, rotation & center pivot
  const syncGroupTransform = useCallback(() => {
    if (!groupRef.current) return;
    const currentTransform = transformRef.current;
    const bounds = baseBoundsRef.current;
    const rotation = currentTransform.rotation || 0;

    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const cx = bounds.width / 2;
      const cy = bounds.height / 2;
      groupRef.current.position({
        x: currentTransform.x + cx * currentTransform.zoom,
        y: currentTransform.y + cy * currentTransform.zoom,
      });
      groupRef.current.offset({ x: cx, y: cy });
      groupRef.current.scale({ x: currentTransform.zoom, y: currentTransform.zoom });
      groupRef.current.rotation(rotation);
    } else {
      groupRef.current.position({ x: currentTransform.x, y: currentTransform.y });
      groupRef.current.offset({ x: 0, y: 0 });
      groupRef.current.scale({ x: currentTransform.zoom, y: currentTransform.zoom });
      groupRef.current.rotation(rotation);
    }
  }, []);

  // Initialize Layer and Group
  useEffect(() => {
    if (!stage) return;

    const layer = new Konva.Layer({
      name: 'mark-annotation-layer',
      listening: false,
      visible,
    });

    const group = new Konva.Group({
      name: 'mark-annotation-group',
      listening: false,
      visible,
    });

    layer.add(group);
    stage.add(layer);

    layerRef.current = layer;
    groupRef.current = group;
    syncGroupTransform();

    const nodesMap = nodesMapRef.current;

    return () => {
      nodesMap.clear();
      group.destroy();
      layer.destroy();
      layerRef.current = null;
      groupRef.current = null;
    };
  }, [stage, visible, syncGroupTransform]);

  // Synchronize visibility changes
  useEffect(() => {
    if (!layerRef.current || !groupRef.current) return;
    layerRef.current.visible(visible);
    groupRef.current.visible(visible);
    layerRef.current.batchDraw();
  }, [visible]);

  // Synchronize group transform with pan/zoom/rotation
  useEffect(() => {
    if (!groupRef.current || !layerRef.current) return;
    syncGroupTransform();
    layerRef.current.batchDraw();
  }, [transform.x, transform.y, transform.zoom, transform.rotation, baseBounds, syncGroupTransform]);

  // Re-render committed annotations when annotations list, selection, or page changes
  useEffect(() => {
    if (!groupRef.current || !layerRef.current) return;

    const group = groupRef.current;
    const currentNodes = nodesMapRef.current;
    const isSelectMode = activeTool === 'select' && !disabled && visible;

    // Enable/disable group-level listening based on select mode
    group.listening(isSelectMode);

    // Track active IDs
    const annotationIdSet = new Set(annotations.map((a) => a.id));

    // Remove nodes that are no longer present
    for (const [id, node] of currentNodes.entries()) {
      if (!annotationIdSet.has(id)) {
        node.destroy();
        currentNodes.delete(id);
      }
    }

    // Add or update annotation nodes with deterministic z-index order
    annotations.forEach((ann, index) => {
      let annGroup = currentNodes.get(ann.id);
      const isSelected = selectedAnnotationId === ann.id;

      if (!annGroup) {
        annGroup = new Konva.Group({
          id: ann.id,
          x: ann.x,
          y: ann.y,
          name: 'annotation-group',
        });
        group.add(annGroup);
        currentNodes.set(ann.id, annGroup);
      } else {
        annGroup.position({ x: ann.x, y: ann.y });
      }

      // Enforce deterministic array-order zIndex (AE-133)
      annGroup.zIndex(index);

      annGroup.draggable(isSelectMode);
      annGroup.listening(isSelectMode);

      // Attach selection & drag handlers
      annGroup.off('pointerdown.select dragstart.select dragend.select mouseenter.select mouseleave.select');
      if (isSelectMode) {
        let dragStartPos = { x: ann.x, y: ann.y };

        annGroup.on('pointerdown.select', (e) => {
          e.cancelBubble = true;
          onSelectAnnotationRef.current?.(ann.id);
        });

        annGroup.on('dragstart.select', (e) => {
          e.cancelBubble = true;
          isDraggingAnnotationRef.current = true;
          dragStartPos = { x: annGroup!.x(), y: annGroup!.y() };
          onSelectAnnotationRef.current?.(ann.id);
        });

        annGroup.on('dragend.select', (e) => {
          e.cancelBubble = true;
          isDraggingAnnotationRef.current = false;
          const newX = Math.round(annGroup!.x());
          const newY = Math.round(annGroup!.y());
          if (newX !== dragStartPos.x || newY !== dragStartPos.y) {
            onAnnotationMoveRef.current?.(ann.id, { x: newX, y: newY }, dragStartPos);
          }
        });

        annGroup.on('mouseenter.select', () => {
          if (stage?.container()) {
            stage.container().style.cursor = 'move';
          }
        });

        annGroup.on('mouseleave.select', () => {
          if (stage?.container() && activeToolRef.current === 'select') {
            stage.container().style.cursor = 'default';
          }
        });
      }

      // Render shape content inside annGroup
      if (ann.type === 'check') {
        const check = ann as CheckAnnotation;
        const S = check.size || DEFAULT_STAMP_SIZE;
        const points = [
          -S * 0.35,
          S * 0.05,
          -S * 0.05,
          S * 0.35,
          S * 0.45,
          -S * 0.35,
        ];

        let lineNode = annGroup.findOne<Konva.Line>('.check-line');
        if (!lineNode) {
          lineNode = new Konva.Line({
            name: 'check-line',
            points,
            stroke: check.color || DEFAULT_CHECK_COLOR,
            strokeWidth: 3.5,
            lineCap: 'round',
            lineJoin: 'round',
            listening: false,
          });
          annGroup.add(lineNode);
        } else {
          lineNode.points(points);
          lineNode.stroke(check.color || DEFAULT_CHECK_COLOR);
        }

        // Selection indicator
        const bounds = { x: -S * 0.5 - 2, y: -S * 0.5 - 2, width: S + 4, height: S + 4 };
        let indicator = annGroup.findOne<Konva.Rect>('.selection-indicator');
        if (isSelected) {
          if (!indicator) {
            indicator = new Konva.Rect({
              name: 'selection-indicator',
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              stroke: '#2563eb',
              strokeWidth: 1.5,
              dash: [4, 4],
              cornerRadius: 3,
              fill: 'rgba(37, 99, 235, 0.08)',
              listening: false,
            });
            annGroup.add(indicator);
          } else {
            indicator.position({ x: bounds.x, y: bounds.y });
            indicator.size({ width: bounds.width, height: bounds.height });
          }
        } else if (indicator) {
          indicator.destroy();
        }
      } else if (ann.type === 'cross') {
        const cross = ann as CrossAnnotation;
        const S = cross.size || DEFAULT_STAMP_SIZE;
        const pathData = `M ${-S * 0.35} ${-S * 0.35} L ${S * 0.35} ${S * 0.35} M ${S * 0.35} ${-S * 0.35} L ${-S * 0.35} ${S * 0.35}`;

        let pathNode = annGroup.findOne<Konva.Path>('.cross-path');
        if (!pathNode) {
          pathNode = new Konva.Path({
            name: 'cross-path',
            data: pathData,
            stroke: cross.color || DEFAULT_CROSS_COLOR,
            strokeWidth: 3.5,
            lineCap: 'round',
            lineJoin: 'round',
            listening: false,
          });
          annGroup.add(pathNode);
        } else {
          pathNode.data(pathData);
          pathNode.stroke(cross.color || DEFAULT_CROSS_COLOR);
        }

        // Selection indicator
        const bounds = { x: -S * 0.5 - 2, y: -S * 0.5 - 2, width: S + 4, height: S + 4 };
        let indicator = annGroup.findOne<Konva.Rect>('.selection-indicator');
        if (isSelected) {
          if (!indicator) {
            indicator = new Konva.Rect({
              name: 'selection-indicator',
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              stroke: '#2563eb',
              strokeWidth: 1.5,
              dash: [4, 4],
              cornerRadius: 3,
              fill: 'rgba(37, 99, 235, 0.08)',
              listening: false,
            });
            annGroup.add(indicator);
          } else {
            indicator.position({ x: bounds.x, y: bounds.y });
            indicator.size({ width: bounds.width, height: bounds.height });
          }
        } else if (indicator) {
          indicator.destroy();
        }
      } else if (ann.type === 'highlight') {
        const hl = ann as HighlightAnnotation;

        let rectNode = annGroup.findOne<Konva.Rect>('.highlight-rect');
        if (!rectNode) {
          rectNode = new Konva.Rect({
            name: 'highlight-rect',
            x: 0,
            y: 0,
            width: hl.width,
            height: hl.height,
            fill: hl.color || DEFAULT_HIGHLIGHT_COLOR,
            opacity: hl.opacity ?? DEFAULT_HIGHLIGHT_OPACITY,
            stroke: '#ca8a04',
            strokeWidth: 1,
            cornerRadius: 2,
            listening: false,
          });
          annGroup.add(rectNode);
        } else {
          rectNode.size({ width: hl.width, height: hl.height });
          rectNode.fill(hl.color || DEFAULT_HIGHLIGHT_COLOR);
          rectNode.opacity(hl.opacity ?? DEFAULT_HIGHLIGHT_OPACITY);
        }

        // Selection indicator
        const bounds = { x: -2, y: -2, width: hl.width + 4, height: hl.height + 4 };
        let indicator = annGroup.findOne<Konva.Rect>('.selection-indicator');
        if (isSelected) {
          if (!indicator) {
            indicator = new Konva.Rect({
              name: 'selection-indicator',
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              stroke: '#2563eb',
              strokeWidth: 1.5,
              dash: [4, 4],
              cornerRadius: 3,
              fill: 'rgba(37, 99, 235, 0.08)',
              listening: false,
            });
            annGroup.add(indicator);
          } else {
            indicator.position({ x: bounds.x, y: bounds.y });
            indicator.size({ width: bounds.width, height: bounds.height });
          }
        } else if (indicator) {
          indicator.destroy();
        }
      } else if (ann.type === 'text') {
        const note = ann as TextNoteAnnotation;

        let noteText = annGroup.findOne<Konva.Text>('.note-text');
        let noteBg = annGroup.findOne<Konva.Rect>('.note-bg');

        if (!noteText || !noteBg) {
          noteText = new Konva.Text({
            name: 'note-text',
            text: note.text,
            fontSize: note.fontSize || DEFAULT_TEXT_FONT_SIZE,
            fontFamily: 'sans-serif',
            fill: note.color || DEFAULT_TEXT_COLOR,
            padding: 6,
            listening: false,
          });

          noteBg = new Konva.Rect({
            name: 'note-bg',
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

          annGroup.add(noteBg);
          annGroup.add(noteText);
        } else {
          noteText.text(note.text);
          noteText.fontSize(note.fontSize || DEFAULT_TEXT_FONT_SIZE);
          noteText.fill(note.color || DEFAULT_TEXT_COLOR);
          noteBg.width(noteText.width());
          noteBg.height(noteText.height());
          noteBg.fill(note.backgroundColor || DEFAULT_TEXT_BG_COLOR);
          noteBg.stroke(note.borderColor || DEFAULT_TEXT_BORDER_COLOR);
        }

        // Selection indicator
        const textWidth = noteText.width();
        const textHeight = noteText.height();
        const bounds = { x: -2, y: -2, width: textWidth + 4, height: textHeight + 4 };
        let indicator = annGroup.findOne<Konva.Rect>('.selection-indicator');
        if (isSelected) {
          if (!indicator) {
            indicator = new Konva.Rect({
              name: 'selection-indicator',
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              stroke: '#2563eb',
              strokeWidth: 1.5,
              dash: [4, 4],
              cornerRadius: 5,
              fill: 'rgba(37, 99, 235, 0.08)',
              listening: false,
            });
            annGroup.add(indicator);
          } else {
            indicator.position({ x: bounds.x, y: bounds.y });
            indicator.size({ width: bounds.width, height: bounds.height });
          }
        } else if (indicator) {
          indicator.destroy();
        }
      }
    });

    layerRef.current.batchDraw();
  }, [annotations, selectedAnnotationId, activeTool, visible, disabled, pageKey, stage]);

  // Pointer event handlers for placing Check, Cross, Highlight, Text annotations, and Clearing Selection
  useEffect(() => {
    if (!stage) return;

    const container = stage.container();
    if (!container) return;

    const isSelectTool = activeTool === 'select' && !disabled && visible;
    const isMarkTool =
      !disabled &&
      visible &&
      (activeTool === 'check' ||
        activeTool === 'cross' ||
        activeTool === 'highlight' ||
        activeTool === 'text');

    if (!isMarkTool && !isSelectTool) return;

    if (isSelectTool) {
      container.style.cursor = 'default';
    } else {
      container.style.cursor = activeTool === 'text' ? 'text' : 'crosshair';
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (!visibleRef.current) return;
      if (e.button !== 0 && e.buttons !== 1 && e.pointerType === 'mouse') return;
      if (disabledRef.current) return;

      const currentTool = activeToolRef.current;

      // In select mode, clicking empty space clears selection
      if (currentTool === 'select') {
        if (!isDraggingAnnotationRef.current) {
          onSelectAnnotationRef.current?.(null);
        }
        return;
      }

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
      const imagePoint = screenToImageCoordinates(
        screenX,
        screenY,
        transformRef.current,
        baseBoundsRef.current || undefined
      );

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
      const currentPoint = screenToImageCoordinates(
        screenX,
        screenY,
        transformRef.current,
        baseBoundsRef.current || undefined
      );

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
      const endPoint = screenToImageCoordinates(
        screenX,
        screenY,
        transformRef.current,
        baseBoundsRef.current || undefined
      );

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
  }, [stage, activeTool, visible, disabled]);

  return null;
}
