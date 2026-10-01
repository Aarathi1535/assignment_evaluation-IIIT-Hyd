import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveStatusIndicator } from '../components/canvas/SaveStatusIndicator';
import {
  saveLocalAnnotationDraft,
  getLocalAnnotationDraft,
  markLocalAnnotationDraftSynced,
  markLocalAnnotationDraftSuperseded,
  clearLocalAnnotationDraft,
  clearDraftOnSubmit,
  clearUserDrafts,
  getPendingAnnotationDrafts,
  hasPendingSync,
  isServerDataNewer,
  setCurrentDraftUser,
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
    setCurrentDraftUser(null);
    clearAllMemoryDrafts();
  });

  afterEach(() => {
    mockStorage.clear();
    clearAllMemoryDrafts();
    setCurrentDraftUser(null);
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

    it('marks a draft as synced and strips heavy strokes/notes payload', () => {
      saveLocalAnnotationDraft('script-101', 1, 'page-1', mockData, { synced: false });
      expect(hasPendingSync('script-101', 1)).toBe(true);

      markLocalAnnotationDraftSynced('script-101', 1, '2026-09-30T10:00:00Z');
      const retrieved = getLocalAnnotationDraft('script-101', 1);
      expect(retrieved?.synced).toBe(true);
      expect(retrieved?.serverUpdatedAt).toBe('2026-09-30T10:00:00Z');
      expect(hasPendingSync('script-101', 1)).toBe(false);

      // AE-170 requirement 8: Once synced, draft does not retain full strokes/notes
      expect(retrieved?.data.annotations).toHaveLength(0);
      expect(retrieved?.data.strokes).toHaveLength(0);
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

  describe('2. User Isolation & Lab Machine Security (Requirement 5)', () => {
    const mockDataUserA: SerializedPageAnnotations = {
      annotations: [
        {
          id: 'mark-a',
          type: 'check',
          pageKey: 'page-1',
          x: 10,
          y: 20,
          size: 24,
          color: '#16a34a',
          createdAt: 1000,
        },
      ],
      strokes: [],
    };

    const mockDataUserB: SerializedPageAnnotations = {
      annotations: [
        {
          id: 'mark-b',
          type: 'cross',
          pageKey: 'page-1',
          x: 50,
          y: 60,
          size: 24,
          color: '#ef4444',
          createdAt: 2000,
        },
      ],
      strokes: [],
    };

    it('isolates drafts between different users for the same script and page', () => {
      // User A logs into shared lab machine and creates draft
      saveLocalAnnotationDraft('script-lab-1', 1, 'page-1', mockDataUserA, {}, 'user-ta-1');

      // User B logs in on same machine
      saveLocalAnnotationDraft('script-lab-1', 1, 'page-1', mockDataUserB, {}, 'user-ta-2');

      // User A retrieves their own draft
      const draftA = getLocalAnnotationDraft('script-lab-1', 1, 'user-ta-1');
      expect(draftA).not.toBeNull();
      expect(draftA?.userId).toBe('user-ta-1');
      expect(draftA?.data.annotations[0].id).toBe('mark-a');

      // User B retrieves their own draft
      const draftB = getLocalAnnotationDraft('script-lab-1', 1, 'user-ta-2');
      expect(draftB).not.toBeNull();
      expect(draftB?.userId).toBe('user-ta-2');
      expect(draftB?.data.annotations[0].id).toBe('mark-b');

      // Pending drafts are isolated per user
      const pendingA = getPendingAnnotationDrafts('script-lab-1', 'user-ta-1');
      expect(pendingA).toHaveLength(1);
      expect(pendingA[0].data.annotations[0].id).toBe('mark-a');

      const pendingB = getPendingAnnotationDrafts('script-lab-1', 'user-ta-2');
      expect(pendingB).toHaveLength(1);
      expect(pendingB[0].data.annotations[0].id).toBe('mark-b');
    });

    it('uses session user context set via setCurrentDraftUser', () => {
      setCurrentDraftUser('user-session-99');
      saveLocalAnnotationDraft('script-ctx', 1, 'page-1', mockDataUserA);

      const draft = getLocalAnnotationDraft('script-ctx', 1);
      expect(draft).not.toBeNull();
      expect(draft?.userId).toBe('user-session-99');

      // Another user without explicit ID does not see it if session user changes
      setCurrentDraftUser('user-session-100');
      expect(getLocalAnnotationDraft('script-ctx', 1)).toBeNull();
    });
  });

  describe('3. Logout & Submit Clearing (Requirements 6 & 7)', () => {
    const mockData: SerializedPageAnnotations = {
      annotations: [],
      strokes: [],
    };

    it('clears all drafts belonging to a user on logout (clearUserDrafts)', () => {
      saveLocalAnnotationDraft('script-1', 1, 'page-1', mockData, {}, 'user-logout');
      saveLocalAnnotationDraft('script-1', 2, 'page-2', mockData, {}, 'user-logout');
      saveLocalAnnotationDraft('script-2', 1, 'page-1', mockData, {}, 'user-logout');
      // Other user's draft on same machine
      saveLocalAnnotationDraft('script-1', 1, 'page-1', mockData, {}, 'other-user');

      expect(getLocalAnnotationDraft('script-1', 1, 'user-logout')).not.toBeNull();
      expect(getLocalAnnotationDraft('script-1', 2, 'user-logout')).not.toBeNull();

      // Logout clears only user-logout drafts
      clearUserDrafts('user-logout');

      expect(getLocalAnnotationDraft('script-1', 1, 'user-logout')).toBeNull();
      expect(getLocalAnnotationDraft('script-1', 2, 'user-logout')).toBeNull();
      expect(getLocalAnnotationDraft('script-2', 1, 'user-logout')).toBeNull();

      // Other user draft remains intact
      expect(getLocalAnnotationDraft('script-1', 1, 'other-user')).not.toBeNull();
    });

    it('clears drafts on successful submission (clearDraftOnSubmit)', () => {
      saveLocalAnnotationDraft('script-sub-1', 1, 'page-1', mockData, {}, 'user-submit');
      saveLocalAnnotationDraft('script-sub-1', 2, 'page-2', mockData, {}, 'user-submit');
      saveLocalAnnotationDraft('script-sub-2', 1, 'page-1', mockData, {}, 'user-submit');

      // Clear specific page on page submit
      clearDraftOnSubmit('script-sub-1', 1, 'user-submit');
      expect(getLocalAnnotationDraft('script-sub-1', 1, 'user-submit')).toBeNull();
      expect(getLocalAnnotationDraft('script-sub-1', 2, 'user-submit')).not.toBeNull();

      // Clear entire script on script submit
      clearDraftOnSubmit('script-sub-1', undefined, 'user-submit');
      expect(getLocalAnnotationDraft('script-sub-1', 2, 'user-submit')).toBeNull();
      // Other script not affected
      expect(getLocalAnnotationDraft('script-sub-2', 1, 'user-submit')).not.toBeNull();
    });
  });

  describe('4. Stale / Server-Newer Draft Handling & Superseded Status (Requirements 8 & 9)', () => {
    const baseServerUpdatedAt = new Date(1700000000000).toISOString();
    const localDraft = {
      scriptId: 'script-1',
      pageNumber: 1,
      pageKey: 'page-1',
      data: { annotations: [], strokes: [] },
      savedAt: 1700000005000,
      baseServerUpdatedAt,
      synced: false,
    };

    it('identifies when server data is strictly newer than local draft', () => {
      const newerServerDate = new Date(1700000005000).toISOString();
      expect(isServerDataNewer(localDraft, newerServerDate)).toBe(true);
    });

    it('identifies when local draft is newer than server data', () => {
      const olderServerDate = new Date(1699999999000).toISOString();
      expect(isServerDataNewer(localDraft, olderServerDate)).toBe(false);
    });

    it('marks a local draft superseded when server is newer during hydration so it cannot be pushed on reconnect', () => {
      saveLocalAnnotationDraft('script-stale', 1, 'page-1', {
        annotations: [{ id: 'old-mark', type: 'check', pageKey: 'page-1', x: 0, y: 0, size: 20, color: '#000', createdAt: 100 }],
        strokes: [],
      }, { savedAt: 1000, synced: false }, 'user-stale');

      expect(hasPendingSync('script-stale', 1, 'user-stale')).toBe(true);
      expect(getPendingAnnotationDrafts('script-stale', 'user-stale')).toHaveLength(1);

      // Hydration discovers server has newer timestamp (e.g. 5000)
      markLocalAnnotationDraftSuperseded('script-stale', 1, '2026-09-30T12:00:00Z', 'user-stale');

      const retrieved = getLocalAnnotationDraft('script-stale', 1, 'user-stale');
      expect(retrieved?.superseded).toBe(true);
      expect(retrieved?.serverUpdatedAt).toBe('2026-09-30T12:00:00Z');

      // Superseded draft MUST NOT be pending sync or re-pushed on reconnect
      expect(hasPendingSync('script-stale', 1, 'user-stale')).toBe(false);
      expect(getPendingAnnotationDrafts('script-stale', 'user-stale')).toHaveLength(0);
    });
  });

  describe('5. SaveStatusIndicator AE-170 Visual States (No AE-171/172/173 UI)', () => {
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

    it('does not render AE-171 Keep Mine / Load Server buttons or AE-172 Restore / Discard buttons', () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, { status: 'saved' })
      );
      expect(html).not.toContain('Keep Mine');
      expect(html).not.toContain('Load Server');
      expect(html).not.toContain('Restore');
      expect(html).not.toContain('Discard');
      expect(html).not.toContain('conflict');
      expect(html).not.toContain('recovery');
    });
  });

  describe('6. Network Disconnect Survival & Reconnect Sync Workflow', () => {
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
        return { success: true, serverUpdatedAt: '2026-09-30T10:05:00Z' };
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
            markLocalAnnotationDraftSynced('script-999', pageNumber, res.serverUpdatedAt);
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
          markLocalAnnotationDraftSynced(pending.scriptId, pending.pageNumber, res.serverUpdatedAt);
        }
      }

      setStatus('saved');

      // Verify synced state & payload stripped
      const syncedDraft = getLocalAnnotationDraft('script-999', 1);
      expect(syncedDraft?.synced).toBe(true);
      expect(syncedDraft?.data.annotations).toHaveLength(0);
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

      if (localDraft && !localDraft.synced && !localDraft.superseded && !isServerDataNewer(localDraft, serverPayload.updatedAt)) {
        effectiveData = localDraft.data;
        effectiveStatus = 'pending_sync';
      } else {
        effectiveData = serverPayload;
      }

      // Local unsynced draft must take precedence over older server data
      expect(effectiveData.annotations).toHaveLength(1);
      expect(effectiveStatus).toBe('pending_sync');
    });

    it('marks local draft superseded when server data is newer during hydration', () => {
      const now = Date.now();
      const localAnnotation = createCrossAnnotation('page-1', { x: 40, y: 40 });
      const localSerialized = serializePageAnnotations('page-1', [localAnnotation], []);

      // Local draft was saved 10 minutes ago
      saveLocalAnnotationDraft('script-777', 1, 'page-1', localSerialized, {
        savedAt: now - 600000,
        baseServerUpdatedAt: new Date(now - 700000).toISOString(),
        synced: false,
      });

      // Server data was updated more recently (1 minute ago) by another session
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

      if (localDraft && !localDraft.synced && !localDraft.superseded) {
        if (isServerDataNewer(localDraft, serverPayload.updatedAt)) {
          markLocalAnnotationDraftSuperseded('script-777', 1, serverPayload.updatedAt);
          effectiveData = serverPayload;
        } else {
          effectiveData = localDraft.data as unknown as typeof serverPayload;
          effectiveStatus = 'pending_sync';
        }
      } else {
        effectiveData = serverPayload;
      }

      // Newer server data must be preferred and draft marked superseded
      expect(effectiveData.annotations).toHaveLength(1);
      expect(effectiveData.annotations[0].type).toBe('check');
      expect(effectiveStatus).toBe('saved');

      const supersededDraft = getLocalAnnotationDraft('script-777', 1);
      expect(supersededDraft?.superseded).toBe(true);
      expect(hasPendingSync('script-777', 1)).toBe(false);
    });
  });
});
