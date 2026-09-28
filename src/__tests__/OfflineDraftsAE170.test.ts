import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveStatusIndicator } from '../components/canvas/SaveStatusIndicator';
import {
  saveLocalAnnotationDraft,
  getLocalAnnotationDraft,
  markLocalAnnotationDraftSynced,
  clearLocalAnnotationDraft,
  getPendingAnnotationDrafts,
  hasPendingSync,
  isServerDataNewer,
  clearAllMemoryDrafts,
} from '../lib/offlineDrafts';
import {
  serializePageAnnotations,
  type SerializedPageAnnotations,
} from '../lib/annotationSerialization';
import { createCheckAnnotation, createCrossAnnotation } from '../lib/stampTool';

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

describe('AE-170: Offline-Safe Local Draft of Annotations', () => {
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

  describe('1. Local Annotation Draft Storage & Retrieval', () => {
    const mockData: SerializedPageAnnotations = {
      annotations: [
        {
          id: 'mark-1',
          type: 'check',
          pageKey: 'page-1',
          x: 100,
          y: 150,
          size: 24,
          color: '#16a34a',
          createdAt: 1000,
        },
      ],
      strokes: [
        {
          id: 'stroke-1',
          pageKey: 'page-1',
          points: [10, 10, 20, 20],
          color: '#ef4444',
          strokeWidth: 2,
          createdAt: 1000,
        },
      ],
    };

    it('persists a draft to localStorage with metadata and unsynced state', () => {
      const saved = saveLocalAnnotationDraft('script-101', 1, 'page-1', mockData);
      expect(saved).not.toBeNull();
      expect(saved?.scriptId).toBe('script-101');
      expect(saved?.pageNumber).toBe(1);
      expect(saved?.synced).toBe(false);
      expect(typeof saved?.savedAt).toBe('number');

      const retrieved = getLocalAnnotationDraft('script-101', 1);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.data.annotations).toHaveLength(1);
      expect(retrieved?.data.strokes).toHaveLength(1);
      expect(retrieved?.synced).toBe(false);
    });

    it('marks a draft as synced', () => {
      saveLocalAnnotationDraft('script-101', 1, 'page-1', mockData, { synced: false });
      expect(hasPendingSync('script-101', 1)).toBe(true);

      markLocalAnnotationDraftSynced('script-101', 1);
      const retrieved = getLocalAnnotationDraft('script-101', 1);
      expect(retrieved?.synced).toBe(true);
      expect(hasPendingSync('script-101', 1)).toBe(false);
    });

    it('clears a draft when requested', () => {
      saveLocalAnnotationDraft('script-101', 1, 'page-1', mockData);
      expect(getLocalAnnotationDraft('script-101', 1)).not.toBeNull();

      clearLocalAnnotationDraft('script-101', 1);
      expect(getLocalAnnotationDraft('script-101', 1)).toBeNull();
    });

    it('retrieves all pending unsynced drafts for a specific script', () => {
      saveLocalAnnotationDraft('script-101', 1, 'page-1', mockData, { synced: false });
      saveLocalAnnotationDraft('script-101', 2, 'page-2', mockData, { synced: false });
      saveLocalAnnotationDraft('script-101', 3, 'page-3', mockData, { synced: true }); // already synced
      saveLocalAnnotationDraft('script-202', 1, 'page-1', mockData, { synced: false }); // other script

      const pending101 = getPendingAnnotationDrafts('script-101');
      expect(pending101).toHaveLength(2);
      expect(pending101.map((d) => d.pageNumber).sort()).toEqual([1, 2]);

      const allPending = getPendingAnnotationDrafts();
      expect(allPending).toHaveLength(3);
    });

    it('falls back seamlessly to in-memory storage if localStorage throws', () => {
      const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const saved = saveLocalAnnotationDraft('script-mem', 1, 'page-1', mockData);
      expect(saved).not.toBeNull();

      const retrieved = getLocalAnnotationDraft('script-mem', 1);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.scriptId).toBe('script-mem');

      setItemSpy.mockRestore();
    });
  });

  describe('2. Server Precedence & Stale Overwrite Prevention (isServerDataNewer)', () => {
    const localDraft = {
      scriptId: 'script-1',
      pageNumber: 1,
      pageKey: 'page-1',
      data: { annotations: [], strokes: [] },
      savedAt: 1700000000000,
      synced: false,
    };

    it('identifies when server data is strictly newer than local draft', () => {
      const newerServerDate = new Date(localDraft.savedAt + 5000).toISOString();
      expect(isServerDataNewer(localDraft, newerServerDate)).toBe(true);
    });

    it('identifies when local draft is newer than server data', () => {
      const olderServerDate = new Date(localDraft.savedAt - 5000).toISOString();
      expect(isServerDataNewer(localDraft, olderServerDate)).toBe(false);
    });

    it('returns false if timestamps are equal or missing', () => {
      const exactDate = new Date(localDraft.savedAt).toISOString();
      expect(isServerDataNewer(localDraft, exactDate)).toBe(false);
      expect(isServerDataNewer(localDraft, null)).toBe(false);
      expect(isServerDataNewer(null, exactDate)).toBe(false);
      expect(isServerDataNewer(localDraft, 'invalid-date')).toBe(false);
    });
  });

  describe('3. SaveStatusIndicator AE-170 Visual States', () => {
    it('renders pending_sync indicator with appropriate text and styling', () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, { status: 'pending_sync' })
      );
      expect(html).toContain('Pending sync (Saved locally)');
      expect(html).toContain('data-status="pending_sync"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
    });

    it('renders syncing indicator with spinner and appropriate text', () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, { status: 'syncing' })
      );
      expect(html).toContain('Syncing...');
      expect(html).toContain('data-status="syncing"');
      expect(html).toContain('animate-spin');
    });
  });

  describe('4. Network Disconnect Survival & Reconnect Sync Workflow', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('saves draft locally during network loss and transitions to pending_sync', async () => {
      let currentStatus: string = 'idle';

      const setStatus = (s: string) => {
        currentStatus = s;
      };

      // Mock save operation that fails when offline
      let isOnline = false;
      const saveAnnotationsApi = vi.fn().mockImplementation(async () => {
        if (!isOnline) {
          throw new TypeError('Failed to fetch');
        }
        return { success: true };
      });

      const executeSaveWorkflow = async (pageNumber: number, data: SerializedPageAnnotations) => {
        // Step 1: Immediately persist local draft
        saveLocalAnnotationDraft('script-999', pageNumber, 'page-1', data, { synced: false });

        if (!isOnline) {
          setStatus('pending_sync');
          return;
        }

        setStatus('saving');
        try {
          const res = await saveAnnotationsApi({ scriptId: 'script-999', pageNumber, data });
          if (res.success) {
            markLocalAnnotationDraftSynced('script-999', pageNumber);
            setStatus('saved');
          }
        } catch {
          setStatus('pending_sync');
        }
      };

      const annotation = createCheckAnnotation('page-1', { x: 50, y: 50 });
      const serialized = serializePageAnnotations('page-1', [annotation], []);

      // User adds annotation while offline
      await executeSaveWorkflow(1, serialized);

      // Draft must be safely in localStorage
      const draft = getLocalAnnotationDraft('script-999', 1);
      expect(draft).not.toBeNull();
      expect(draft?.synced).toBe(false);
      expect(draft?.data.annotations).toHaveLength(1);
      expect(currentStatus).toBe('pending_sync');

      // Network comes back online
      isOnline = true;
      setStatus('syncing');

      // Background auto-sync handler
      const pendingDrafts = getPendingAnnotationDrafts('script-999');
      expect(pendingDrafts).toHaveLength(1);

      for (const pending of pendingDrafts) {
        const res = await saveAnnotationsApi({
          scriptId: pending.scriptId,
          pageNumber: pending.pageNumber,
          data: pending.data,
        });
        if (res.success) {
          markLocalAnnotationDraftSynced(pending.scriptId, pending.pageNumber);
        }
      }

      setStatus('saved');

      // Verify synced state
      expect(getLocalAnnotationDraft('script-999', 1)?.synced).toBe(true);
      expect(getPendingAnnotationDrafts('script-999')).toHaveLength(0);
      expect(currentStatus).toBe('saved');
    });

    it('preserves local draft during page hydration if server data is older', () => {
      const now = Date.now();
      const localAnnotation = createCheckAnnotation('page-1', { x: 80, y: 80 });
      const localSerialized = serializePageAnnotations('page-1', [localAnnotation], []);

      // Local draft was saved 2 minutes ago
      saveLocalAnnotationDraft('script-777', 1, 'page-1', localSerialized, {
        savedAt: now - 120000,
        synced: false,
      });

      // Server data timestamp is older (5 minutes ago)
      const serverPayload = {
        pageKey: 'page-1',
        annotations: [],
        strokes: [],
        updatedAt: new Date(now - 300000).toISOString(),
      };

      const localDraft = getLocalAnnotationDraft('script-777', 1);
      let effectiveData: SerializedPageAnnotations;
      let effectiveStatus = 'saved';

      if (localDraft && !localDraft.synced && !isServerDataNewer(localDraft, serverPayload.updatedAt)) {
        effectiveData = localDraft.data;
        effectiveStatus = 'pending_sync';
      } else {
        effectiveData = serverPayload;
      }

      // Local unsynced draft must take precedence over older server data
      expect(effectiveData.annotations).toHaveLength(1);
      expect(effectiveStatus).toBe('pending_sync');
    });

    it('prefers newer server data over older local draft to prevent stale overwrite', () => {
      const now = Date.now();
      const localAnnotation = createCrossAnnotation('page-1', { x: 40, y: 40 });
      const localSerialized = serializePageAnnotations('page-1', [localAnnotation], []);

      // Local draft was saved 10 minutes ago
      saveLocalAnnotationDraft('script-777', 1, 'page-1', localSerialized, {
        savedAt: now - 600000,
        synced: false,
      });

      // Server data was updated more recently (1 minute ago) by another session/process
      const serverAnnotation = createCheckAnnotation('page-1', { x: 120, y: 120 });
      const serverPayload = {
        pageKey: 'page-1',
        annotations: [serverAnnotation],
        strokes: [],
        updatedAt: new Date(now - 60000).toISOString(),
      };

      const localDraft = getLocalAnnotationDraft('script-777', 1);
      let effectiveData: typeof serverPayload;
      let effectiveStatus = 'saved';

      if (localDraft && !localDraft.synced && !isServerDataNewer(localDraft, serverPayload.updatedAt)) {
        effectiveData = localDraft.data as unknown as typeof serverPayload;
        effectiveStatus = 'pending_sync';
      } else {
        effectiveData = serverPayload;
      }

      // Newer server data must be preferred
      expect(effectiveData.annotations).toHaveLength(1);
      expect(effectiveData.annotations[0].type).toBe('check');
      expect(effectiveStatus).toBe('saved');
    });
  });
});
