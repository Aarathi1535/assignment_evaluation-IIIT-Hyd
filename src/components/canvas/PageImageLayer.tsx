'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useCanvasStage } from './CanvasStage';
import { calculateImageFitBounds, RenderedImageBounds } from '@/lib/annotations';
import {
  calculatePanBounds,
  clampPanPosition,
  calculateZoomTransform,
  calculatePinchMetrics,
  MIN_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
  PanZoomTransform,
  TouchPoint,
} from '@/lib/panZoom';
import type { PageImageLayerProps } from './types';

export function PageImageLayer({
  src,
  alt = 'Answer sheet page',
  fitMode = 'contain',
  transform: propTransform,
  brightness = 0,
  contrast = 0,
  onImageLoad,
  onImageError,
  onTransformChange,
  minZoom = MIN_ZOOM_LEVEL,
  maxZoom = MAX_ZOOM_LEVEL,
  enablePanZoom = true,
  isPenActive = false,
  stage: propStage,
}: PageImageLayerProps) {
  const { stage: contextStage, dimensions } = useCanvasStage();
  const stage = propStage || contextStage;

  const layerRef = useRef<Konva.Layer | null>(null);
  const groupRef = useRef<Konva.Group | null>(null);
  const imageNodeRef = useRef<Konva.Image | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const baseBoundsRef = useRef<RenderedImageBounds | null>(null);

  // Internal transform state (used if propTransform is not controlled)
  const [internalTransform, setInternalTransform] = useState<PanZoomTransform>({
    x: 0,
    y: 0,
    zoom: 1.0,
    rotation: 0,
  });

  const activeTransform = propTransform || internalTransform;
  const activeTransformRef = useRef<PanZoomTransform>(activeTransform);
  const brightnessRef = useRef<number>(brightness);
  const contrastRef = useRef<number>(contrast);

  useEffect(() => {
    activeTransformRef.current = activeTransform;
  }, [activeTransform]);

  useEffect(() => {
    brightnessRef.current = brightness;
    contrastRef.current = contrast;
  }, [brightness, contrast]);

  // Apply filters helper (brightness / contrast on IMAGE NODE only)
  const applyImageFilters = useCallback((imgNode: Konva.Image, b: number, c: number) => {
    try {
      type KonvaFilter = NonNullable<Parameters<Konva.Image['filters']>[0]>[number];
      const filters: KonvaFilter[] = [];
      if (b !== 0) {
        if (Konva.Filters?.Brighten) {
          filters.push(Konva.Filters.Brighten);
          imgNode.brightness(Math.max(-1, Math.min(1, b / 100)));
        }
      }
      if (c !== 0) {
        if (Konva.Filters?.Contrast) {
          filters.push(Konva.Filters.Contrast);
          imgNode.contrast(Math.max(-100, Math.min(100, c)));
        }
      }

      if (filters.length > 0) {
        imgNode.filters(filters);
        if (typeof imgNode.cache === 'function') {
          imgNode.cache();
        }
      } else {
        imgNode.filters([]);
        if (typeof imgNode.clearCache === 'function') {
          imgNode.clearCache();
        }
      }
    } catch {
      // Graceful fallback for non-canvas or mock environments
    }
  }, []);

  // Drag tracking refs (avoids React re-renders during active continuous dragging)
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragStartTransformRef = useRef({ x: 0, y: 0 });
  const lastTouchDistanceRef = useRef<number | null>(null);

  // Helper to sync group transform with pan, zoom, rotation & center pivot (matching PenLayer & MarkLayer)
  const syncGroupTransform = useCallback(() => {
    if (!groupRef.current) return;
    const currentTransform = activeTransformRef.current;
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

  // Helper to layout the image node within the current stage dimensions & transform
  const updateImageLayout = useCallback(
    (
      img: HTMLImageElement,
      stageW: number,
      stageH: number,
      _transform: PanZoomTransform
    ): RenderedImageBounds | null => {
      if (!layerRef.current || stageW <= 0 || stageH <= 0) return null;

      const baseBounds = calculateImageFitBounds(
        stageW,
        stageH,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        fitMode
      );
      baseBoundsRef.current = baseBounds;

      if (!groupRef.current) {
        const group = new Konva.Group({
          name: 'page-image-group',
          listening: false,
        });
        groupRef.current = group;
        layerRef.current.add(group);
      }

      if (!imageNodeRef.current) {
        const konvaImage = new Konva.Image({
          image: img,
          x: 0,
          y: 0,
          width: baseBounds.width,
          height: baseBounds.height,
          listening: false, // Layer/stage handles pointer interactions
        });
        imageNodeRef.current = konvaImage;
        applyImageFilters(konvaImage, brightnessRef.current, contrastRef.current);
        groupRef.current.add(konvaImage);
      } else {
        imageNodeRef.current.image(img);
        imageNodeRef.current.position({ x: 0, y: 0 });
        imageNodeRef.current.size({ width: baseBounds.width, height: baseBounds.height });
        applyImageFilters(imageNodeRef.current, brightnessRef.current, contrastRef.current);
      }

      syncGroupTransform();
      layerRef.current.batchDraw();
      return baseBounds;
    },
    [fitMode, applyImageFilters, syncGroupTransform]
  );

  // Initialize Konva Layer
  useEffect(() => {
    if (!stage) return;

    const layer = new Konva.Layer({
      name: 'page-image-layer',
      listening: false, // Performance optimization: events handled at Stage level
    });
    stage.add(layer);
    layerRef.current = layer;

    return () => {
      if (imageNodeRef.current) {
        imageNodeRef.current.destroy();
        imageNodeRef.current = null;
      }
      if (groupRef.current) {
        groupRef.current.destroy();
        groupRef.current = null;
      }
      layer.destroy();
      layerRef.current = null;
    };
  }, [stage]);

  // Load Image when src changes
  useEffect(() => {
    if (!src || typeof window === 'undefined') {
      if (imageNodeRef.current) {
        imageNodeRef.current.image(undefined as unknown as CanvasImageSource);
        layerRef.current?.batchDraw();
      }
      loadedImageRef.current = null;
      baseBoundsRef.current = null;
      return;
    }

    let isCancelled = false;
    const img = new window.Image();
    if (src.startsWith('http://') || src.startsWith('https://')) {
      try {
        const url = new URL(src, window.location.href);
        if (url.origin !== window.location.origin) {
          img.crossOrigin = 'anonymous';
        }
      } catch {
        img.crossOrigin = 'anonymous';
      }
    }
    img.alt = alt;

    img.onload = () => {
      if (isCancelled) return;
      loadedImageRef.current = img;

      const stageW = stage?.width() || dimensions.width;
      const stageH = stage?.height() || dimensions.height;

      const baseBounds = calculateImageFitBounds(
        stageW,
        stageH,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        fitMode
      );
      baseBoundsRef.current = baseBounds;

      // Initialize transform to base fit coordinates
      const initialTransform: PanZoomTransform = {
        x: baseBounds.x,
        y: baseBounds.y,
        zoom: 1.0,
        rotation: activeTransformRef.current.rotation || 0,
      };

      setInternalTransform(initialTransform);
      onTransformChange?.(initialTransform);

      updateImageLayout(img, stageW, stageH, initialTransform);
      onImageLoad?.(img, baseBounds);
    };

    img.onerror = () => {
      if (isCancelled) return;
      const error = new Error(`Failed to load answer-sheet page image from: ${src}`);
      onImageError?.(error);
    };

    img.src = src;

    return () => {
      isCancelled = true;
    };
  }, [src, alt, stage, dimensions.width, dimensions.height, fitMode, updateImageLayout, onImageLoad, onImageError, onTransformChange]);

  // Update layout when stage dimensions change
  useEffect(() => {
    if (loadedImageRef.current && dimensions.width > 0 && dimensions.height > 0) {
      const baseBounds = calculateImageFitBounds(
        dimensions.width,
        dimensions.height,
        loadedImageRef.current.naturalWidth || loadedImageRef.current.width,
        loadedImageRef.current.naturalHeight || loadedImageRef.current.height,
        fitMode
      );
      baseBoundsRef.current = baseBounds;

      const current = activeTransformRef.current;
      const renderW = baseBounds.width * current.zoom;
      const renderH = baseBounds.height * current.zoom;
      const bounds = calculatePanBounds(dimensions.width, dimensions.height, renderW, renderH);
      const clamped = clampPanPosition(current.x, current.y, bounds);

      const adjustedTransform: PanZoomTransform = {
        x: clamped.x,
        y: clamped.y,
        zoom: current.zoom,
        rotation: current.rotation || 0,
      };

      setInternalTransform(adjustedTransform);
      onTransformChange?.(adjustedTransform);
      updateImageLayout(loadedImageRef.current, dimensions.width, dimensions.height, adjustedTransform);
    }
  }, [dimensions.width, dimensions.height, fitMode, updateImageLayout, onTransformChange]);

  // Synchronize brightness/contrast filter updates on image node
  useEffect(() => {
    if (imageNodeRef.current && layerRef.current) {
      applyImageFilters(imageNodeRef.current, brightness, contrast);
      layerRef.current.batchDraw();
    }
  }, [brightness, contrast, applyImageFilters]);

  // Synchronize group transform with pan, zoom, rotation props & state
  useEffect(() => {
    if (!groupRef.current || !layerRef.current) return;
    syncGroupTransform();
    layerRef.current.batchDraw();
  }, [
    activeTransform.x,
    activeTransform.y,
    activeTransform.zoom,
    activeTransform.rotation,
    syncGroupTransform,
  ]);

  // Pointer & Gesture Event Handlers for Pan/Zoom
  useEffect(() => {
    if (!stage || !enablePanZoom) return;

    const container = stage.container();
    if (!container) return;

    // Helper to update transform directly on Konva canvas (bypasses React re-renders)
    const applyDirectTransform = (newTransform: PanZoomTransform) => {
      activeTransformRef.current = newTransform;

      if (loadedImageRef.current && imageNodeRef.current && baseBoundsRef.current && layerRef.current) {
        const cx = baseBoundsRef.current.width / 2;
        const cy = baseBoundsRef.current.height / 2;
        const rotation = newTransform.rotation || 0;

        if (groupRef.current) {
          groupRef.current.position({
            x: newTransform.x + cx * newTransform.zoom,
            y: newTransform.y + cy * newTransform.zoom,
          });
          groupRef.current.offset({ x: cx, y: cy });
          groupRef.current.scale({ x: newTransform.zoom, y: newTransform.zoom });
          groupRef.current.rotation(rotation);
        } else {
          const renderW = baseBoundsRef.current.width * newTransform.zoom;
          const renderH = baseBoundsRef.current.height * newTransform.zoom;
          imageNodeRef.current.position({ x: newTransform.x, y: newTransform.y });
          imageNodeRef.current.size({ width: renderW, height: renderH });
        }
        layerRef.current.batchDraw();
      }
    };

    // Helper to commit transform to React state & callbacks (on gesture end or stepped zoom)
    const commitTransform = (newTransform: PanZoomTransform) => {
      setInternalTransform(newTransform);
      onTransformChange?.(newTransform);
    };

    const applyAndCommitTransform = (newTransform: PanZoomTransform) => {
      applyDirectTransform(newTransform);
      commitTransform(newTransform);
    };

    // Wheel Zoom handler
    const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      if (!baseBoundsRef.current) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const current = activeTransformRef.current;
      const scaleBy = 1.15;
      const direction = e.evt.deltaY < 0 ? 1 : -1;
      const targetZoom = direction > 0 ? current.zoom * scaleBy : current.zoom / scaleBy;

      const newTransform = calculateZoomTransform(
        current.x,
        current.y,
        current.zoom,
        targetZoom,
        pointer.x,
        pointer.y,
        baseBoundsRef.current,
        stage.width(),
        stage.height(),
        minZoom,
        maxZoom
      );

      applyAndCommitTransform({
        ...newTransform,
        rotation: current.rotation,
      });
    };

    // Drag / Pan handlers
    const handleMouseDown = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Ignore if pen is active or not primary button on mouse
      if (isPenActive) return;
      if ('button' in e.evt && e.evt.button !== 0) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      isDraggingRef.current = true;
      dragStartPosRef.current = { x: pointer.x, y: pointer.y };
      dragStartTransformRef.current = {
        x: activeTransformRef.current.x,
        y: activeTransformRef.current.y,
      };

      if (activeTransformRef.current.zoom > 1.0) {
        container.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = () => {
      if (isPenActive) return;
      const current = activeTransformRef.current;

      // Update hover cursor
      if (!isDraggingRef.current) {
        if (current.zoom > 1.0) {
          container.style.cursor = 'grab';
        } else {
          container.style.cursor = 'default';
        }
      }

      if (!isDraggingRef.current || !baseBoundsRef.current) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const dx = pointer.x - dragStartPosRef.current.x;
      const dy = pointer.y - dragStartPosRef.current.y;

      const proposedX = dragStartTransformRef.current.x + dx;
      const proposedY = dragStartTransformRef.current.y + dy;

      const isRotated90 = ((current.rotation || 0) % 180) !== 0;
      const renderW = (isRotated90 ? baseBoundsRef.current.height : baseBoundsRef.current.width) * current.zoom;
      const renderH = (isRotated90 ? baseBoundsRef.current.width : baseBoundsRef.current.height) * current.zoom;
      const bounds = calculatePanBounds(stage.width(), stage.height(), renderW, renderH);
      const clamped = clampPanPosition(proposedX, proposedY, bounds);

      applyDirectTransform({
        x: clamped.x,
        y: clamped.y,
        zoom: current.zoom,
        rotation: current.rotation,
      });
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        container.style.cursor = activeTransformRef.current.zoom > 1.0 ? 'grab' : 'default';
        commitTransform(activeTransformRef.current);
      }
      lastTouchDistanceRef.current = null;
    };

    // Multi-touch Pinch Zoom handler
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && baseBoundsRef.current) {
        e.preventDefault();
        const touch1: TouchPoint = { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
        const touch2: TouchPoint = { clientX: e.touches[1].clientX, clientY: e.touches[1].clientY };

        const { distance, centerX, centerY } = calculatePinchMetrics(touch1, touch2);

        // Convert client center to stage relative position
        const rect = container.getBoundingClientRect();
        const pointerX = centerX - rect.left;
        const pointerY = centerY - rect.top;

        if (lastTouchDistanceRef.current !== null && lastTouchDistanceRef.current > 0) {
          const pinchScale = distance / lastTouchDistanceRef.current;
          const current = activeTransformRef.current;
          const targetZoom = current.zoom * pinchScale;

          const newTransform = calculateZoomTransform(
            current.x,
            current.y,
            current.zoom,
            targetZoom,
            pointerX,
            pointerY,
            baseBoundsRef.current,
            stage.width(),
            stage.height(),
            minZoom,
            maxZoom
          );

          applyDirectTransform(newTransform);
        }

        lastTouchDistanceRef.current = distance;
      }
    };

    const handleTouchEnd = () => {
      lastTouchDistanceRef.current = null;
      commitTransform(activeTransformRef.current);
    };

    stage.on('wheel', handleWheel);
    stage.on('mousedown touchstart', handleMouseDown);
    stage.on('mousemove touchmove', handleMouseMove);
    stage.on('mouseup touchend mouseleave', handleMouseUp);

    const domContainer = container;
    domContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    domContainer.addEventListener('touchend', handleTouchEnd);

    return () => {
      stage.off('wheel', handleWheel);
      stage.off('mousedown touchstart', handleMouseDown);
      stage.off('mousemove touchmove', handleMouseMove);
      stage.off('mouseup touchend mouseleave', handleMouseUp);

      domContainer.removeEventListener('touchmove', handleTouchMove);
      domContainer.removeEventListener('touchend', handleTouchEnd);
    };
  }, [stage, enablePanZoom, isPenActive, minZoom, maxZoom, onTransformChange]);

  return null;
}
