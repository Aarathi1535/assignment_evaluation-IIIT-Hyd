'use client';

import React, { useState, useMemo, useRef } from 'react';
import { X, Search, Keyboard, Command, Sparkles } from 'lucide-react';
import {
  SHORTCUT_MAP,
  ShortcutDefinition,
  groupShortcuts,
} from '@/lib/shortcutMap';
import { useDialogFocus } from '@/hooks/useDialogFocus';

export interface ShortcutHelpOverlayProps {
  /** Whether the help overlay dialog is currently open */
  isOpen: boolean;
  /** Callback fired when the overlay dialog is requested to close */
  onClose: () => void;
  /** Optional custom shortcut map override (defaults to authoritative SHORTCUT_MAP) */
  shortcutMap?: readonly ShortcutDefinition[];
  /** Optional reference to the element that triggered opening the dialog to return focus to */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Formats a shortcut definition's keys into an array of user-facing key badge strings.
 */
export function formatShortcutKeys(shortcut: ShortcutDefinition): string[] {
  const result: string[] = [];

  // Primary key
  if (shortcut.key) {
    result.push(shortcut.key);
  }

  // Key aliases (e.g., 'S' for select, 'L' for loupe, '=' for zoom in)
  if (shortcut.keys && shortcut.keys.length > 0) {
    for (const altKey of shortcut.keys) {
      // Exclude redundant aliases if they only differ by Meta vs Cmd vs Ctrl on standard layouts
      if (!result.includes(altKey) && !result.some((r) => isEquivalentModifierAlias(r, altKey))) {
        result.push(altKey);
      }
    }
  }

  return result;
}

/**
 * Checks if two modifier combinations are platform aliases (e.g., 'Ctrl+Enter' vs 'Cmd+Enter' vs 'Meta+Enter').
 */
function isEquivalentModifierAlias(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s.replace(/^Cmd\+/i, 'Ctrl+').replace(/^Meta\+/i, 'Ctrl+');
  return normalize(a) === normalize(b);
}

/**
 * Accessible Keyboard Shortcuts Help Dialog Overlay for the grading canvas.
 * Derived dynamically from the authoritative SHORTCUT_MAP (AE-156).
 */
export function ShortcutHelpOverlay({
  isOpen,
  onClose,
  shortcutMap = SHORTCUT_MAP,
  triggerRef,
}: ShortcutHelpOverlayProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management: moves focus inside dialog on open, returns focus to trigger on close, handles Escape
  useDialogFocus({
    isOpen,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    returnFocusRef: triggerRef,
    onClose,
  });

  // Group shortcuts dynamically from the authoritative keymap
  const sections = useMemo(() => {
    return groupShortcuts(shortcutMap);
  }, [shortcutMap]);

  // Filter sections based on search query
  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sections;

    return sections
      .map((section) => {
        const matchingShortcuts = section.shortcuts.filter((s) => {
          const inLabel = s.label.toLowerCase().includes(q);
          const inDesc = s.description.toLowerCase().includes(q);
          const inKey = s.key.toLowerCase().includes(q);
          const inAltKeys = (s.keys || []).some((k) => k.toLowerCase().includes(q));
          const inGroup = s.group.toLowerCase().includes(q);
          return inLabel || inDesc || inKey || inAltKeys || inGroup;
        });

        return {
          ...section,
          shortcuts: matchingShortcuts,
        };
      })
      .filter((section) => section.shortcuts.length > 0);
  }, [sections, searchQuery]);

  const totalShortcutsCount = useMemo(() => {
    return sections.reduce((acc, sec) => acc + sec.shortcuts.length, 0);
  }, [sections]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 sm:p-6 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      data-testid="canvas-shortcut-help-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-shortcut-help-title"
        aria-describedby="canvas-shortcut-help-description"
        tabIndex={-1}
        className="relative w-full max-w-2xl max-h-[88vh] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden outline-hidden animate-in zoom-in-95 duration-200"
        data-testid="canvas-shortcut-help-dialog"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
              <Keyboard className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="canvas-shortcut-help-title"
                className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-2"
              >
                Keyboard Shortcuts
                <span className="text-xs font-semibold px-2 py-0.5 bg-slate-200/70 text-slate-600 rounded-full font-mono">
                  {totalShortcutsCount} available
                </span>
              </h2>
              <p
                id="canvas-shortcut-help-description"
                className="text-xs text-slate-500 mt-0.5"
              >
                Quick reference for all navigation, grading, tools, and canvas controls
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            aria-label="Close keyboard shortcuts"
            title="Close (Esc)"
            data-testid="canvas-shortcut-help-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-2.5 border-b border-slate-100 bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shortcuts or keys (e.g. pen, zoom, enter)..."
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg placeholder:text-slate-400 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
              aria-label="Filter keyboard shortcuts"
            />
          </div>
        </div>

        {/* Shortcuts List Content */}
        <div
          className="flex-1 overflow-y-auto px-6 py-4 space-y-6 divide-y divide-slate-100"
          data-testid="canvas-shortcut-help-list"
        >
          {filteredSections.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-2">
              <Command className="h-8 w-8 mx-auto text-slate-300" />
              <p className="text-sm font-medium text-slate-600">No matching shortcuts found</p>
              <p className="text-xs text-slate-400">Try searching for a different action, tool name, or key.</p>
            </div>
          ) : (
            filteredSections.map((section, idx) => (
              <div key={section.group} className={idx > 0 ? 'pt-5' : ''}>
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-blue-500" />
                    <span>{section.title}</span>
                  </h3>
                  <span className="text-3xs text-slate-400 font-mono">
                    {section.shortcuts.length} {section.shortcuts.length === 1 ? 'shortcut' : 'shortcuts'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {section.shortcuts.map((shortcut) => {
                    const keys = formatShortcutKeys(shortcut);
                    return (
                      <div
                        key={shortcut.id}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50/60 hover:bg-blue-50/40 border border-slate-100 transition-colors gap-3"
                        data-testid={`shortcut-item-${shortcut.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-800 truncate">
                            {shortcut.label}
                          </div>
                          {shortcut.description && (
                            <div className="text-3xs text-slate-500 truncate mt-0.5">
                              {shortcut.description}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                          {keys.map((k, keyIdx) => (
                            <React.Fragment key={k}>
                              {keyIdx > 0 && (
                                <span className="text-3xs text-slate-400 font-medium">or</span>
                              )}
                              <kbd className="inline-flex items-center justify-center px-2 py-1 text-2xs font-mono font-semibold bg-white text-slate-700 border border-slate-300 rounded shadow-2xs">
                                {k}
                              </kbd>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-3xs text-slate-500">
          <span className="flex items-center gap-1">
            <span>Tip: Press</span>
            <kbd className="px-1.5 py-0.5 font-mono bg-white border border-slate-300 rounded shadow-2xs text-slate-700 font-bold">?</kbd>
            <span>or click the keyboard icon anytime while grading.</span>
          </span>
          <span className="font-mono text-slate-400">Press Esc to close</span>
        </div>
      </div>
    </div>
  );
}

export default ShortcutHelpOverlay;
