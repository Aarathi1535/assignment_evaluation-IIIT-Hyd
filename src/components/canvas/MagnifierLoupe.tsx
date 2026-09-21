'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type Konva from 'konva';
import { useCanvasStage } from './CanvasStage';
import {
  calculateLoupeSourceRect,
  calculateLoupePlacement,
  DEFAULT_LOUPE_DIAMETER,
  DEFAULT_LOUPE_MAGNIFICATION,
} from '@/lib/magnifierTool';

export interface MagnifierLoupeProps {
  /** Whether the loupe magnifier is currently active */
  active: boolean;
  /** Magnification multiplier (e.g. 2.0 = 2x magnification) */
  magnification?: number;
  /** Diameter of the circular loupe lens in pixels */
  diameter?: number;
  /** Parent Konva stage instance */
  stage?: Konva.Stage | null;
  /** Additional CSS class names */
  className?: string;
}

export function MagnifierLoupe({
  active,
  magnification = DEFAULT_LOUPE_MAGNIFICATION,
  diameter = DEFAULT_LOUPE_DIAMETER,
  stage: propStage,
  className = '',
}: MagnifierLoupeProps) {
  const { stage: contextStage, dimensions } = useCanvasStage();
  const stage = propStage || contextStage;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Render the magnified view onto the loupe canvas
  const renderLoupe = useCallback(
    (pos: { x: number; y: number }) => {
      const loupeCanvas = canvasRef.current;
      if (!loupeCanvas || !stage) return;

      const ctx = loupeCanvas.getContext('2d');
      if (!ctx) return;

      const radius = diameter / 2;
      const stageW = stage.width() || dimensions.width || 800;

      // Clear previous frame
      ctx.clearRect(0, 0, diameter, diameter);

      // Save context & apply circular clipping path
      ctx.save();
      ctx.beginPath();
      ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2);
      ctx.clip();

      // Background fill
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, diameter, diameter);

      // Sample all layer canvases from Konva stage container
      const container = stage.container();
      if (container) {
        const layerCanvases = container.querySelectorAll<HTMLCanvasElement>('canvas');
        const { sx, sy, sw, sh } = calculateLoupeSourceRect(pos.x, pos.y, diameter, magnification);

        layerCanvases.forEach((layerCanvas) => {
          if (layerCanvas === loupeCanvas) return;
          const pixelRatio = stageW > 0 ? layerCanvas.width / stageW : 1;

          ctx.drawImage(
            layerCanvas,
            sx * pixelRatio,
            sy * pixelRatio,
            sw * pixelRatio,
            sh * pixelRatio,
            0,
            0,
            diameter,
            diameter
          );
        });
      }

      ctx.restore();

      // Draw subtle center reticle / crosshair
      ctx.save();
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'; // Blue reticle
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);

      ctx.beginPath();
      ctx.moveTo(radius - 8, radius);
      ctx.lineTo(radius + 8, radius);
      ctx.moveTo(radius, radius - 8);
      ctx.lineTo(radius, radius + 8);
      ctx.stroke();

      // Center dot
      ctx.fillStyle = 'rgba(59, 130, 246, 0.7)';
      ctx.beginPath();
      ctx.arc(radius, radius, 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    },
    [stage, dimensions.width, diameter, magnification]
  );

  // Pointer event listeners on Stage container
  useEffect(() => {
    if (!stage || !active) {
      return;
    }

    const container = stage.container();
    if (!container) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const rect = container.getBoundingClientRect();
      let clientX = 0;
      let clientY = 0;

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = e.clientX;
        clientY = e.clientY;
      } else {
        return;
      }

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        setIsVisible(false);
        return;
      }

      const newPos = { x, y };
      setPointerPos(newPos);
      setIsVisible(true);

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        renderLoupe(newPos);
      });
    };

    const handlePointerLeave = () => {
      setIsVisible(false);
      setPointerPos(null);
    };

    container.addEventListener('mousemove', handlePointerMove, { passive: true });
    container.addEventListener('mouseleave', handlePointerLeave, { passive: true });
    container.addEventListener('touchmove', handlePointerMove, { passive: true });
    container.addEventListener('touchend', handlePointerLeave, { passive: true });
    container.addEventListener('touchstart', handlePointerMove, { passive: true });

    return () => {
      setIsVisible(false);
      setPointerPos(null);
      container.removeEventListener('mousemove', handlePointerMove);
      container.removeEventListener('mouseleave', handlePointerLeave);
      container.removeEventListener('touchmove', handlePointerMove);
      container.removeEventListener('touchend', handlePointerLeave);
      container.removeEventListener('touchstart', handlePointerMove);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [stage, active, renderLoupe]);

  if (!active || !stage || !isVisible || !pointerPos) {
    return null;
  }

  const placement = calculateLoupePlacement(pointerPos.x, pointerPos.y, diameter);

  return (
    <div
      className={`absolute pointer-events-none z-30 rounded-full shadow-2xl border-2 border-white/95 ring-2 ring-blue-500/40 overflow-hidden backdrop-blur-2xs transition-transform duration-75 ease-out ${className}`}
      style={{
        left: `${placement.x}px`,
        top: `${placement.y}px`,
        width: `${diameter}px`,
        height: `${diameter}px`,
      }}
      data-testid="canvas-magnifier-loupe"
      role="region"
      aria-label="Magnifier Loupe View"
    >
      <canvas
        ref={canvasRef}
        width={diameter}
        height={diameter}
        className="block w-full h-full rounded-full"
        data-testid="canvas-loupe-canvas"
      />
      {/* Magnification Badge */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-slate-900/80 text-white text-[10px] font-mono rounded-full pointer-events-none shadow-xs">
        {magnification}×
      </div>
    </div>
  );
}
