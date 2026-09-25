import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveStatusIndicator } from '../components/canvas/SaveStatusIndicator';
import {
  saveLocalAnnotationDraft,
  getLocalAnnotationDraft,
  markLocalAnnotationDraftSynced,
  markLocalAnnotationDraftConflict,
  restoreLocalAnnotationDraft,
  discardLocalAnnotationDraft,
  hasRecoverableDraft,
  detectAnnotationConflict,
  isServerDataNewer,
  clearAllMemoryDrafts,
} from '../lib/offlineDrafts';
import type { SerializedPageAnnotations } from '../lib/annotationSerialization';
import { createCheckAnnotation } from '../lib/stampTool';

// In-memory mock for localStorage in node test environment
class MockLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }
}

describe('AE-172: Recover Unsaved Work After Crash / Reload', () => {
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
    (globalThis as unknown as { window: { localStorage: MockLocalStorage } }).window = {
      localStorage: mockStorage,
    };
    clearAllMemoryDrafts();
  });

  afterEach(() => {
    mockStorage.clear();
    clearAllMemoryDrafts();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  describe('1. Unsynced Local Draft Detection on Reload / Mount', () => {
    const sampleAnnotations: SerializedPageAnnotations = {
      annotations: [
        {
          id: 'mark-rec-1',
          type: 'check',
          pageKey: 'page-1',
          x: 120,
          y: 200,
          size: 24,
          color: '#16a34a',
          createdAt: 1000,
        },
      ],
      strokes: [
        {
          id: 'stroke-rec-1',
          pageKey: 'page-1',
          points: [10, 10, 30, 30],
          color: '#e11d48',
          strokeWidth: 2,
          createdAt: 1000,
        },
      ],
    };

    it('detects an unsynced local draft when page is loaded again', () => {
      saveLocalAnnotationDraft('script-crash-1', 1, 'page-1', sampleAnnotations, {
        synced: false,
        baseServerUpdatedAt: '2026-09-24T10:00:00.000Z',
      });

      const hasDraft = hasRecoverableDraft('script-crash-1', 1);
      expect(hasDraft).toBe(true);

      const draft = getLocalAnnotationDraft('script-crash-1', 1);
      expect(draft).not.toBeNull();
      expect(draft?.synced).toBe(false);
      expect(draft?.data.annotations).toHaveLength(1);
      expect(draft?.data.strokes).toHaveLength(1);
    });

    it('returns false for hasRecoverableDraft if draft was already synced', () => {
      saveLocalAnnotationDraft('script-crash-1', 1, 'page-1', sampleAnnotations, {
        synced: true,
        baseServerUpdatedAt: '2026-09-24T10:00:00.000Z',
      });

      expect(hasRecoverableDraft('script-crash-1', 1)).toBe(false);
    });

    it('returns false for hasRecoverableDraft if draft is conflicted', () => {
      saveLocalAnnotationDraft('script-crash-1', 1, 'page-1', sampleAnnotations, {
        synced: false,
        hasConflict: true,
      });

      expect(hasRecoverableDraft('script-crash-1', 1)).toBe(false);
    });
  });

  describe('2. Restore Recovered Local Draft Workflow', () => {
    const sampleAnnotations: SerializedPageAnnotations = {
      annotations: [
        {
          id: 'mark-rest-1',
          type: 'check',
          pageKey: 'page-1',
          x: 100,
          y: 100,
          size: 24,
          color: '#16a34a',
          createdAt: 1000,
        },
      ],
      strokes: [],
    };

    it('activates recovered draft and prepares it for synchronization', () => {
      saveLocalAnnotationDraft('script-rest-1', 1, 'page-1', sampleAnnotations, {
        synced: false,
        baseServerUpdatedAt: '2026-09-24T10:00:00.000Z',
        isRecoveredDraft: true,
      });

      const restored = restoreLocalAnnotationDraft('script-rest-1', 1);
      expect(restored).not.toBeNull();
      expect(restored?.isRecoveredDraft).toBe(false);
      expect(restored?.synced).toBe(false);
      expect(restored?.data.annotations).toHaveLength(1);

      const retrieved = getLocalAnnotationDraft('script-rest-1', 1);
      expect(retrieved?.isRecoveredDraft).toBe(false);
    });

    it('completes full restore -> save -> synced cycle', async () => {
      saveLocalAnnotationDraft('script-rest-2', 1, 'page-1', sampleAnnotations, {
        synced: false,
        baseServerUpdatedAt: '2026-09-24T10:00:00.000Z',
      });

      let status = 'recovery_available';

      // User triggers Restore
      const restored = restoreLocalAnnotationDraft('script-rest-2', 1);
      expect(restored).not.toBeNull();
      status = 'pending_sync';

      // Mock save API execution
      const saveApi = vi.fn().mockResolvedValue({
        success: true,
        serverUpdatedAt: '2026-09-24T10:05:00.000Z',
      });

      status = 'saving';
      const result = await saveApi({
        scriptId: 'script-rest-2',
        pageNumber: 1,
        data: restored?.data,
      });

      if (result.success) {
        markLocalAnnotationDraftSynced('script-rest-2', 1, result.serverUpdatedAt);
        status = 'saved';
      }

      expect(status).toBe('saved');
      const finalDraft = getLocalAnnotationDraft('script-rest-2', 1);
      expect(finalDraft?.synced).toBe(true);
      expect(hasRecoverableDraft('script-rest-2', 1)).toBe(false);
    });
  });

  describe('3. Discard Recovered Local Draft Workflow', () => {
    const localAnnotations: SerializedPageAnnotations = {
      annotations: [
        {
          id: 'mark-local-1',
          type: 'cross',
          pageKey: 'page-1',
          x: 50,
          y: 50,
          size: 24,
          color: '#ef4444',
          createdAt: 1000,
        },
      ],
      strokes: [],
    };

    const serverAnnotations: SerializedPageAnnotations = {
      annotations: [
        {
          id: 'mark-srv-1',
          type: 'check',
          pageKey: 'page-1',
          x: 200,
          y: 200,
          size: 24,
          color: '#16a34a',
          createdAt: 500,
        },
      ],
      strokes: [],
    };

    it('discards recovered draft and replaces local storage with server version', () => {
      saveLocalAnnotationDraft('script-disc-1', 1, 'page-1', localAnnotations, {
        synced: false,
        baseServerUpdatedAt: '2026-09-24T10:00:00.000Z',
      });

      discardLocalAnnotationDraft(
        'script-disc-1',
        1,
        serverAnnotations,
        '2026-09-24T10:00:00.000Z'
      );

      const afterDiscard = getLocalAnnotationDraft('script-disc-1', 1);
      expect(afterDiscard).not.toBeNull();
      expect(afterDiscard?.synced).toBe(true);
      expect(afterDiscard?.data.annotations).toHaveLength(1);
      expect(afterDiscard?.data.annotations[0].id).toBe('mark-srv-1');
      expect(hasRecoverableDraft('script-disc-1', 1)).toBe(false);
    });

    it('clears draft completely if serverData is omitted upon discard', () => {
      saveLocalAnnotationDraft('script-disc-2', 1, 'page-1', localAnnotations, {
        synced: false,
      });

      discardLocalAnnotationDraft('script-disc-2', 1);
      const afterDiscard = getLocalAnnotationDraft('script-disc-2', 1);
      expect(afterDiscard).toBeNull();
      expect(hasRecoverableDraft('script-disc-2', 1)).toBe(false);
    });

    it('prevents repeated recovery prompts on subsequent reloads after discard', () => {
      saveLocalAnnotationDraft('script-disc-3', 1, 'page-1', localAnnotations, {
        synced: false,
      });
      expect(hasRecoverableDraft('script-disc-3', 1)).toBe(true);

      discardLocalAnnotationDraft('script-disc-3', 1, serverAnnotations);
      expect(hasRecoverableDraft('script-disc-3', 1)).toBe(false);

      // Subsequent page hydration check
      const currentDraft = getLocalAnnotationDraft('script-disc-3', 1);
      expect(currentDraft?.synced).toBe(true);
    });
  });

  describe('4. Conflict Handling vs Crash Recovery Interaction (AE-171 Preservation)', () => {
    const baseTime = '2026-09-24T10:00:00.000Z';
    const newerServerTime = '2026-09-24T10:05:00.000Z';

    const localAnnotations: SerializedPageAnnotations = {
      annotations: [createCheckAnnotation('page-1', { x: 50, y: 50 })],
      strokes: [],
    };

    it('detects conflict if server changed while local draft existed and overrides simple recovery', () => {
      const localDraft = saveLocalAnnotationDraft(
        'script-conf-rec-1',
        1,
        'page-1',
        localAnnotations,
        {
          synced: false,
          baseServerUpdatedAt: baseTime,
        }
      );

      // Server changed after baseTime
      const isConflict = detectAnnotationConflict(localDraft, newerServerTime);
      expect(isConflict).toBe(true);

      // Conflict must take precedence over normal recovery
      markLocalAnnotationDraftConflict('script-conf-rec-1', 1);
      expect(hasRecoverableDraft('script-conf-rec-1', 1)).toBe(false);
    });

    it('does not silently overwrite newer server data', () => {
      const now = Date.now();
      const localDraft = {
        scriptId: 'script-conf-rec-2',
        pageNumber: 1,
        pageKey: 'page-1',
        data: localAnnotations,
        savedAt: now - 300000, // 5 min ago
        synced: false,
      };

      const serverTimestamp = new Date(now - 60000).toISOString(); // 1 min ago (newer)
      expect(isServerDataNewer(localDraft, serverTimestamp)).toBe(true);
    });
  });

  describe('5. SaveStatusIndicator recovery_available UI & Accessibility', () => {
    it('renders recovery_available indicator with Restore and Discard buttons', () => {
      const onRestore = vi.fn();
      const onDiscard = vi.fn();

      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, {
          status: 'recovery_available',
          onRestoreDraft: onRestore,
          onDiscardDraft: onDiscard,
        })
      );

      expect(html).toContain('Unsaved work recovered');
      expect(html).toContain('data-status="recovery_available"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('Restore');
      expect(html).toContain('Discard');
      expect(html).toContain('aria-label="Restore recovered local draft"');
      expect(html).toContain('aria-label="Discard recovered local draft"');
    });

    it('renders without action buttons if callbacks are not provided', () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, {
          status: 'recovery_available',
        })
      );

      expect(html).toContain('Unsaved work recovered');
      expect(html).not.toContain('Restore');
      expect(html).not.toContain('Discard');
    });
  });
});
