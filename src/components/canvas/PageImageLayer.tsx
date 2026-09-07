'use client';

import { useEffect, useRef, useCallback } from 'react';
import Konva from 'konva';
import { useCanvasStage } from './CanvasStage';
import { calculateImageFitBounds, RenderedImageBounds } from '@/lib/annotations';
import type { PageImageLayerProps } from './types';

export function PageImageLayer({
  src,
  alt = 'Answer sheet page',
  fitMode = 'contain',
  onImageLoad,
  onImageError,
  stage: propStage,
}: PageImageLayerProps) {
  const { stage: contextStage, dimensions } = useCanvasStage();
  const stage = propStage || contextStage;

  const layerRef = useRef<Konva.Layer | null>(null);
  const imageNodeRef = useRef<Konva.Image | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);

  // Helper to layout the image node within the current stage dimensions
  const updateImageLayout = useCallback(
    (img: HTMLImageElement, stageW: number, stageH: number): RenderedImageBounds | null => {
      if (!layerRef.current || stageW <= 0 || stageH <= 0) return null;

      const bounds = calculateImageFitBounds(
        stageW,
        stageH,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        fitMode
      );

      if (!imageNodeRef.current) {
        const konvaImage = new Konva.Image({
          image: img,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          listening: false, // Page image layer does not capture events by default
        });
        imageNodeRef.current = konvaImage;
        layerRef.current.add(konvaImage);
      } else {
        imageNodeRef.current.image(img);
        imageNodeRef.current.position({ x: bounds.x, y: bounds.y });
        imageNodeRef.current.size({ width: bounds.width, height: bounds.height });
      }

      layerRef.current.batchDraw();
      return bounds;
    },
    [fitMode]
  );

  // Initialize Konva Layer
  useEffect(() => {
    if (!stage) return;

    const layer = new Konva.Layer({
      name: 'page-image-layer',
      listening: false, // Performance optimization for background raster image
    });
    stage.add(layer);
    layerRef.current = layer;

    return () => {
      if (imageNodeRef.current) {
        imageNodeRef.current.destroy();
        imageNodeRef.current = null;
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
      return;
    }

    let isCancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.alt = alt;

    img.onload = () => {
      if (isCancelled) return;
      loadedImageRef.current = img;

      const stageW = stage?.width() || dimensions.width;
      const stageH = stage?.height() || dimensions.height;

      const bounds = updateImageLayout(img, stageW, stageH);
      if (bounds) {
        onImageLoad?.(img, bounds);
      }
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
  }, [src, alt, stage, dimensions.width, dimensions.height, updateImageLayout, onImageLoad, onImageError]);

  // Update layout when stage dimensions change
  useEffect(() => {
    if (loadedImageRef.current && dimensions.width > 0 && dimensions.height > 0) {
      updateImageLayout(loadedImageRef.current, dimensions.width, dimensions.height);
    }
  }, [dimensions.width, dimensions.height, updateImageLayout]);

  return null;
}
