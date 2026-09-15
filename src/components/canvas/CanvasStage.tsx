'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import Konva from 'konva';
import type { CanvasDimensions, CanvasStageProps } from './types';

interface CanvasStageContextValue {
  stage: Konva.Stage | null;
  dimensions: CanvasDimensions;
}

const CanvasStageContext = createContext<CanvasStageContextValue>({
  stage: null,
  dimensions: { width: 0, height: 0 },
});

export const useCanvasStage = () => useContext(CanvasStageContext);

export function CanvasStage({
  width = 'auto',
  height = 'auto',
  className = '',
  backgroundColor = '#f8fafc',
  onResize,
  onStageReady,
  children,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [stage, setStage] = useState<Konva.Stage | null>(null);
  const [dimensions, setDimensions] = useState<CanvasDimensions>({ width: 0, height: 0 });

  // Resize handler
  const handleDimensionUpdate = useCallback(
    (w: number, h: number) => {
      const validW = Math.max(0, Math.floor(w));
      const validH = Math.max(0, Math.floor(h));

      setDimensions((prev) => {
        if (prev.width === validW && prev.height === validH) return prev;
        return { width: validW, height: validH };
      });

      if (stageRef.current) {
        stageRef.current.width(validW);
        stageRef.current.height(validH);
        stageRef.current.batchDraw();
      }

      onResize?.({ width: validW, height: validH });
    },
    [onResize]
  );

  // Initialize Konva Stage
  useEffect(() => {
    if (!containerRef.current) return;

    const initialW =
      typeof width === 'number'
        ? width
        : containerRef.current.clientWidth || 800;
    const initialH =
      typeof height === 'number'
        ? height
        : containerRef.current.clientHeight || 600;

    const newStage = new Konva.Stage({
      container: containerRef.current,
      width: initialW,
      height: initialH,
    });

    stageRef.current = newStage;
    setStage(newStage);
    setDimensions({ width: initialW, height: initialH });
    onStageReady?.(newStage);

    // Set up ResizeObserver if auto sizing
    let resizeObserver: ResizeObserver | null = null;
    if ((width === 'auto' || height === 'auto') && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: boxW, height: boxH } = entry.contentRect;
          const targetW = typeof width === 'number' ? width : boxW;
          const targetH = typeof height === 'number' ? height : boxH;
          if (targetW > 0 && targetH > 0) {
            handleDimensionUpdate(targetW, targetH);
          }
        }
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      onStageReady?.(null);
      setStage(null);
      newStage.destroy();
      stageRef.current = null;
    };
  }, [width, height, handleDimensionUpdate, onStageReady]);

  return (
    <CanvasStageContext.Provider
      value={{
        stage,
        dimensions,
      }}
    >
      <div
        ref={containerRef}
        className={`relative overflow-hidden select-none ${className}`}
        style={{
          width: typeof width === 'number' ? `${width}px` : '100%',
          height: typeof height === 'number' ? `${height}px` : '100%',
          backgroundColor,
        }}
        data-testid="canvas-stage-container"
      >
        {stage && children}
      </div>
    </CanvasStageContext.Provider>
  );
}
