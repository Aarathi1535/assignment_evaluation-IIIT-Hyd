'use client';

import React from 'react';
import {
  PenColorId,
  PenWidthId,
  PEN_COLORS,
  PEN_WIDTHS,
} from '@/lib/penTool';

export interface PenStyleSelectorProps {
  /** Currently selected color ID ('red' | 'blue' | 'green') */
  selectedColor: PenColorId;
  /** Callback fired when user selects a color */
  onColorChange: (color: PenColorId) => void;
  /** Currently selected width ID ('thin' | 'thick') */
  selectedWidth: PenWidthId;
  /** Callback fired when user selects a stroke width */
  onWidthChange: (width: PenWidthId) => void;
  /** Additional CSS class names */
  className?: string;
}

export function PenStyleSelector({
  selectedColor,
  onColorChange,
  selectedWidth,
  onWidthChange,
  className = '',
}: PenStyleSelectorProps) {
  const colorOptions = Object.values(PEN_COLORS);
  const widthOptions = Object.values(PEN_WIDTHS);

  return (
    <div
      className={`flex items-center gap-1.5 ${className}`}
      data-testid="pen-style-selector"
      role="group"
      aria-label="Pen Style Controls"
    >
      {/* Color Selector */}
      <div
        className="flex items-center gap-1 bg-slate-100/90 rounded-md p-0.5 border border-slate-200/80"
        role="radiogroup"
        aria-label="Pen Color Selector"
        data-testid="pen-color-selector"
      >
        {colorOptions.map((option) => {
          const isSelected = selectedColor === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${option.label} Pen Color`}
              title={`${option.label} Pen`}
              onClick={() => onColorChange(option.id)}
              className={`relative flex items-center justify-center w-6 h-6 rounded-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                isSelected
                  ? 'bg-white shadow-xs ring-1 ring-slate-300 font-semibold'
                  : 'hover:bg-slate-200/60 opacity-80 hover:opacity-100'
              }`}
              data-testid={`pen-color-${option.id}`}
            >
              <span
                className={`w-3.5 h-3.5 rounded-full border ${
                  isSelected ? 'scale-110 border-slate-600 ring-1 ring-slate-400' : 'border-black/20'
                }`}
                style={{ backgroundColor: option.value }}
              />
            </button>
          );
        })}
      </div>

      <div className="h-4 w-px bg-slate-200" />

      {/* Stroke Width Selector */}
      <div
        className="flex items-center gap-1 bg-slate-100/90 rounded-md p-0.5 border border-slate-200/80"
        role="radiogroup"
        aria-label="Pen Stroke Width Selector"
        data-testid="pen-width-selector"
      >
        {widthOptions.map((option) => {
          const isSelected = selectedWidth === option.id;
          const isThin = option.id === 'thin';
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${option.label} Stroke Width (${option.value}px)`}
              title={`${option.label} (${option.value}px)`}
              onClick={() => onWidthChange(option.id)}
              className={`flex items-center justify-center w-6 h-6 rounded-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                isSelected
                  ? 'bg-white shadow-xs ring-1 ring-slate-300 text-slate-900 font-semibold'
                  : 'hover:bg-slate-200/60 text-slate-500 hover:text-slate-800'
              }`}
              data-testid={`pen-width-${option.id}`}
            >
              <span
                className="rounded-full bg-current transition-all"
                style={{
                  width: isThin ? '10px' : '12px',
                  height: isThin ? '2px' : '4.5px',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
