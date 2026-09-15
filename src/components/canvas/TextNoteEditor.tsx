'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X } from 'lucide-react';

export interface TextNoteEditorProps {
  /** Screen X pixel position inside the canvas container */
  x: number;
  /** Screen Y pixel position inside the canvas container */
  y: number;
  /** Initial text content if editing */
  initialText?: string;
  /** Callback fired when user confirms the note with valid non-empty text */
  onConfirm: (text: string) => void;
  /** Callback fired when user cancels note creation or enters empty text */
  onCancel: () => void;
}

export function TextNoteEditor({
  x,
  y,
  initialText = '',
  onConfirm,
  onCancel,
}: TextNoteEditorProps) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Focus textarea on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);

  const handleConfirm = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  }, [text, onConfirm, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Prevent canvas keyboard shortcuts (like Ctrl+Z) from firing while typing
      e.stopPropagation();

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [handleConfirm, onCancel]
  );

  return (
    <div
      ref={containerRef}
      className="absolute z-30 flex flex-col gap-2 p-2.5 bg-white border border-slate-300 rounded-lg shadow-xl w-64 text-left select-text"
      style={{
        left: `${Math.max(8, x)}px`,
        top: `${Math.max(8, y)}px`,
      }}
      data-testid="text-note-editor"
      role="dialog"
      aria-label="Add Text Note"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between pb-1 border-b border-slate-100">
        <span className="text-xs font-semibold text-slate-700">Add Text Note</span>
        <span className="text-3xs text-slate-400">Enter to save · Esc to cancel</span>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a comment..."
        rows={3}
        className="w-full text-xs text-slate-800 bg-amber-50/50 border border-amber-200 rounded p-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white resize-none"
        aria-label="Text note comment"
        data-testid="text-note-input"
      />

      <div className="flex items-center justify-end gap-1.5 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors focus:outline-hidden focus:ring-2 focus:ring-slate-400"
          aria-label="Cancel note"
          title="Cancel (Esc)"
          data-testid="text-note-cancel-button"
        >
          <X className="h-3.5 w-3.5 inline mr-1" />
          Cancel
        </button>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={text.trim().length === 0}
          className="px-2.5 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 rounded transition-colors shadow-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          aria-label="Confirm note"
          title="Confirm (Enter)"
          data-testid="text-note-confirm-button"
        >
          <Check className="h-3.5 w-3.5 inline mr-1" />
          Save Note
        </button>
      </div>
    </div>
  );
}
