'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Tag, Loader2, AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface CommentTagData {
  _id: string;
  label: string;
  scope: 'GLOBAL' | 'EXAM';
  exam?: string;
  description?: string;
}

export interface PresetCommentChipsProps {
  examId?: string;
  initialTags?: CommentTagData[] | null;
  onSelectTag: (tagLabel: string, tagId?: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Helper to insert or append a comment tag to existing feedback string.
 * Enforces:
 * 1. If currentFeedback is empty -> returns tagLabel.
 * 2. If currentFeedback already contains tagLabel (case-insensitive) -> returns currentFeedback with isDuplicate: true.
 * 3. Appends tagLabel to currentFeedback using a consistent separator (. or space if punctuated).
 * 4. Preserves all existing user-written text.
 */
export function insertTagIntoFeedback(
  currentFeedback: string = '',
  tagLabel: string,
  separator: string = '. '
): { updatedFeedback: string; isDuplicate: boolean } {
  const trimmedLabel = tagLabel.trim();
  const trimmedFeedback = currentFeedback.trim();

  if (!trimmedLabel) {
    return {
      updatedFeedback: currentFeedback,
      isDuplicate: false,
    };
  }

  if (!trimmedFeedback) {
    return {
      updatedFeedback: trimmedLabel,
      isDuplicate: false,
    };
  }

  // Duplicate detection: check if trimmedLabel is already present
  const normalizedFeedback = trimmedFeedback.toLowerCase();
  const normalizedLabel = trimmedLabel.toLowerCase();

  // Strip trailing period for flexible duplicate match (e.g. "Good explanation" vs "Good explanation.")
  const cleanFeedback = normalizedFeedback.replace(/[.!?]+$/, '');
  const cleanLabel = normalizedLabel.replace(/[.!?]+$/, '');

  if (
    cleanFeedback === cleanLabel ||
    cleanFeedback.includes(cleanLabel) ||
    normalizedFeedback.includes(normalizedLabel)
  ) {
    return {
      updatedFeedback: currentFeedback,
      isDuplicate: true,
    };
  }

  // Consistent separator appending
  let updatedFeedback: string;
  if (
    trimmedFeedback.endsWith('.') ||
    trimmedFeedback.endsWith('!') ||
    trimmedFeedback.endsWith('?')
  ) {
    updatedFeedback = `${trimmedFeedback} ${trimmedLabel}`;
  } else {
    updatedFeedback = `${trimmedFeedback}${separator}${trimmedLabel}`;
  }

  return {
    updatedFeedback,
    isDuplicate: false,
  };
}

export function PresetCommentChips({
  examId,
  initialTags,
  onSelectTag,
  disabled = false,
  className = '',
}: PresetCommentChipsProps) {
  const [fetchedTags, setFetchedTags] = useState<CommentTagData[] | null>(null);
  const [loading, setLoading] = useState<boolean>(!initialTags && Boolean(examId));
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState<number>(0);

  const tags = initialTags !== undefined && initialTags !== null ? initialTags : fetchedTags;

  useEffect(() => {
    if (initialTags !== undefined && initialTags !== null) {
      return;
    }

    if (!examId) {
      return;
    }

    let isMounted = true;

    async function fetchTags() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tags?exam=${encodeURIComponent(examId!)}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          throw new Error(errJson?.message || `Failed to load comment tags (${res.status})`);
        }

        const json = await res.json();
        if (isMounted) {
          if (json.success && Array.isArray(json.data)) {
            setFetchedTags(json.data);
          } else {
            setFetchedTags([]);
          }
          setLoading(false);
        }
      } catch (err: unknown) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : 'Failed to load tags';
          setError(message);
          setFetchedTags([]);
          setLoading(false);
        }
      }
    }

    fetchTags();

    return () => {
      isMounted = false;
    };
  }, [examId, initialTags, retryKey]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    setRetryKey((k) => k + 1);
  }, []);

  return (
    <div data-testid="preset-comment-chips-container" className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Tag className="h-3 w-3 text-slate-400" />
          <span>Preset Comment Tags</span>
        </span>
      </div>

      {loading && (
        <div
          data-testid="preset-tags-loading"
          className="py-2 flex items-center gap-2 text-2xs text-slate-500"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-primary" />
          <span>Loading comment tags...</span>
        </div>
      )}

      {!loading && error && (
        <div
          data-testid="preset-tags-error"
          className="p-2 bg-rose-50 border border-rose-200 rounded text-2xs text-rose-700 flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
            <span className="truncate">{error}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="h-6 px-1.5 text-2xs border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            <span>Retry</span>
          </Button>
        </div>
      )}

      {!loading && !error && (!tags || tags.length === 0) && (
        <div
          data-testid="preset-tags-empty"
          className="text-2xs text-slate-400 italic py-1"
        >
          No preset comment tags available.
        </div>
      )}

      {!loading && !error && tags && tags.length > 0 && (
        <div
          data-testid="preset-tags-list"
          className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1"
        >
          {tags.map((tag) => (
            <button
              key={tag._id}
              type="button"
              data-testid={`preset-tag-${tag._id}`}
              disabled={disabled}
              onClick={() => onSelectTag(tag.label, tag._id)}
              aria-label={`Insert comment: ${tag.label}`}
              title={tag.description || tag.label}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-2xs font-semibold border transition-all text-left ${
                disabled
                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-brand-primary/5 hover:border-brand-primary/40 hover:text-brand-primary active:bg-brand-primary/10 focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary shadow-2xs'
              }`}
            >
              <span className="truncate max-w-[200px]">{tag.label}</span>
              {tag.scope === 'GLOBAL' && (
                <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 text-slate-500 border border-slate-200 uppercase font-bold">
                  Global
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default PresetCommentChips;
