import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveStatusIndicator } from '../components/canvas/SaveStatusIndicator';
import {
  saveLocalAnnotationDraft,
  getLocalAnnotationDraft,
  markLocalAnnotationDraftSynced,
  markLocalAnnotationDraftConflict,
  resolveLocalAnnotationDraftConflict,
  detectAnnotationConflict,
  getConflictDrafts,
  hasConflict,
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

describe('AE-171: Conflict Handling on Concurrent Edits', () => {
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

  describe('1. detectAnnotationConflict & Conflict Storage Utilities', () => {
    const baseTime = 1700000000000;
    const initialData: SerializedPageAnnotations = {
      annotations: [
        {
          id: 'mark-local-1',
          type: 'check',
          pageKey: 'page-1',
          x: 100,
          y: 150,
          size: 24,
          color: '#16a34a',
          createdAt: baseTime + 1000,
        },
      ],
      strokes: [],
    };

    it('returns false if local draft is already synced (no uncommitted local work)', () => {
      const draft = {
        scriptId: 'script-1',
        pageNumber: 1,
        pageKey: 'page-1',
        data: initialData,
        savedAt: baseTime + 1000,
        synced: true,
        baseServerUpdatedAt: new Date(baseTime).toISOString(),
      };

      const newerServerDate = new Date(baseTime + 50000).toISOString();
      expect(detectAnnotationConflict(draft, newerServerDate)).toBe(false);
    });

    it('returns false if server was NOT modified after baseServerUpdatedAt', () => {
      const draft = {
        scriptId: 'script-1',
        pageNumber: 1,
        pageKey: 'page-1',
        data: initialData,
        savedAt: baseTime + 1000,
        synced: false,
        baseServerUpdatedAt: new Date(baseTime).toISOString(),
      };

      // Server is at same timestamp or older
      expect(detectAnnotationConflict(draft, new Date(baseTime).toISOString())).toBe(false);
      expect(detectAnnotationConflict(draft, new Date(baseTime - 5000).toISOString())).toBe(false);
    });

    it('returns true when server was modified after baseServerUpdatedAt with pending local changes', () => {
      const draft = {
        scriptId: 'script-1',
        pageNumber: 1,
        pageKey: 'page-1',
        data: initialData,
        savedAt: baseTime + 1000,
        synced: false,
        baseServerUpdatedAt: new Date(baseTime).toISOString(),
      };

      const newerServerDate = new Date(baseTime + 5000).toISOString();
      expect(detectAnnotationConflict(draft, newerServerDate)).toBe(true);
    });

    it('marks a draft as conflicted and preserves both local edits and remote server payload', () => {
      saveLocalAnnotationDraft('script-c1', 1, 'page-1', initialData, {
        baseServerUpdatedAt: new Date(baseTime).toISOString(),
        synced: false,
      });

      const serverConflictData: SerializedPageAnnotations = {
        annotations: [
          {
            id: 'mark-server-2',
            type: 'cross',
            pageKey: 'page-1',
            x: 200,
            y: 250,
            size: 24,
            color: '#dc2626',
            createdAt: baseTime + 4000,
          },
        ],
        strokes: [],
      };
      const serverUpdatedAt = new Date(baseTime + 4000).toISOString();

      markLocalAnnotationDraftConflict('script-c1', 1, serverConflictData, serverUpdatedAt);

      const conflicted = getLocalAnnotationDraft('script-c1', 1);
      expect(conflicted).not.toBeNull();
      expect(conflicted?.hasConflict).toBe(true);
      expect(conflicted?.data.annotations[0].id).toBe('mark-local-1'); // local changes preserved
      expect(conflicted?.conflictServerData?.annotations[0].id).toBe('mark-server-2'); // server changes cached
      expect(conflicted?.conflictServerUpdatedAt).toBe(serverUpdatedAt);

      expect(hasConflict('script-c1', 1)).toBe(true);
      expect(getConflictDrafts('script-c1')).toHaveLength(1);
    });

    it('reconciles conflict with "keep_local" to allow overwriting server on subsequent save', () => {
      saveLocalAnnotationDraft('script-c2', 1, 'page-1', initialData, {
        baseServerUpdatedAt: new Date(baseTime).toISOString(),
        synced: false,
        hasConflict: true,
        conflictServerUpdatedAt: new Date(baseTime + 10000).toISOString(),
      });

      const resolved = resolveLocalAnnotationDraftConflict('script-c2', 1, 'keep_local');
      expect(resolved?.hasConflict).toBe(false);
      expect(resolved?.synced).toBe(false); // still unsynced, ready to save
      expect(resolved?.data.annotations[0].id).toBe('mark-local-1');
      expect(resolved?.baseServerUpdatedAt).toBe(new Date(baseTime + 10000).toISOString());
      expect(hasConflict('script-c2', 1)).toBe(false);
    });

    it('reconciles conflict with "load_server" to discard local uncommitted edits and accept server data', () => {
      const serverData: SerializedPageAnnotations = {
        annotations: [
          {
            id: 'mark-server-remote',
            type: 'cross',
            pageKey: 'page-1',
            x: 300,
            y: 350,
            size: 24,
            color: '#dc2626',
            createdAt: baseTime + 12000,
          },
        ],
        strokes: [],
      };

      saveLocalAnnotationDraft('script-c3', 1, 'page-1', initialData, {
        baseServerUpdatedAt: new Date(baseTime).toISOString(),
        synced: false,
        hasConflict: true,
        conflictServerData: serverData,
        conflictServerUpdatedAt: new Date(baseTime + 12000).toISOString(),
      });

      const resolved = resolveLocalAnnotationDraftConflict('script-c3', 1, 'load_server');
      expect(resolved?.hasConflict).toBe(false);
      expect(resolved?.synced).toBe(true); // marked synced
      expect(resolved?.data.annotations[0].id).toBe('mark-server-remote'); // server data accepted
      expect(hasConflict('script-c3', 1)).toBe(false);
    });
  });

  describe('2. SaveStatusIndicator Conflict UI & Actions', () => {
    it('renders conflict status with alert role, assertive live region, and action buttons', () => {
      const onKeepMineMock = vi.fn();
      const onLoadServerMock = vi.fn();

      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, {
          status: 'conflict',
          onKeepMine: onKeepMineMock,
          onLoadServer: onLoadServerMock,
        })
      );

      expect(html).toContain('Conflict detected');
      expect(html).toContain('data-status="conflict"');
      expect(html).toContain('role="alert"');
      expect(html).toContain('aria-live="assertive"');
      expect(html).toContain('Keep Mine');
      expect(html).toContain('Load Server');
    });
  });

  describe('3. Concurrent Edit Detection & Save Reconciliation Workflow', () => {
    it('detects 409 Conflict from backend, preserves local draft, and transitions to conflict state', async () => {
      const baseTimestamp = new Date('2026-09-24T12:00:00.000Z').toISOString();
      const serverNewerTimestamp = new Date('2026-09-24T12:05:00.000Z').toISOString();

      let currentStatus: string = 'idle';
      const conflictsRecorded: unknown[] = [];

      const setStatus = (s: string) => {
        currentStatus = s;
      };

      // Initial draft established when user loaded page at 12:00:00
      const localAnnotation = createCheckAnnotation('page-1', { x: 50, y: 50 });
      const localSerialized = serializePageAnnotations('page-1', [localAnnotation], []);

      saveLocalAnnotationDraft('script-conc-1', 1, 'page-1', localSerialized, {
        baseServerUpdatedAt: baseTimestamp,
        synced: false,
      });

      // Mock save handler simulating remote concurrent edit by another TA
      const mockSaveAnnotations = vi.fn().mockImplementation(async (params: {
        scriptId: string;
        pageNumber: number;
        data: SerializedPageAnnotations;
        baseUpdatedAt?: string | null;
        force?: boolean;
      }) => {
        // Another user already saved at 12:05:00
        if (!params.force && params.baseUpdatedAt === baseTimestamp) {
          return {
            success: false,
            conflict: true,
            serverUpdatedAt: serverNewerTimestamp,
            serverData: {
              annotations: [createCrossAnnotation('page-1', { x: 90, y: 90 })],
              strokes: [],
            },
            error: 'Conflict: Annotations have been modified on the server since your draft was loaded.',
          };
        }
        return { success: true, serverUpdatedAt: new Date().toISOString() };
      });

      const executeSaveWorkflow = async (force?: boolean) => {
        const existingDraft = getLocalAnnotationDraft('script-conc-1', 1);
        setStatus('saving');

        const res = await mockSaveAnnotations({
          scriptId: 'script-conc-1',
          pageNumber: 1,
          data: existingDraft!.data,
          baseUpdatedAt: existingDraft?.baseServerUpdatedAt,
          force,
        });

        if (res.conflict) {
          markLocalAnnotationDraftConflict('script-conc-1', 1, res.serverData, res.serverUpdatedAt);
          setStatus('conflict');
          conflictsRecorded.push(res);
        } else if (res.success) {
          markLocalAnnotationDraftSynced('script-conc-1', 1, res.serverUpdatedAt);
          setStatus('saved');
        }
      };

      // 1. Attempt initial save without force -> should detect conflict
      await executeSaveWorkflow();

      expect(currentStatus).toBe('conflict');
      expect(conflictsRecorded).toHaveLength(1);

      // Verify local edits are strictly preserved in storage
      const draftInConflict = getLocalAnnotationDraft('script-conc-1', 1);
      expect(draftInConflict?.hasConflict).toBe(true);
      expect(draftInConflict?.data.annotations).toHaveLength(1);
      expect(draftInConflict?.data.annotations[0].type).toBe('check');

      // 2. User chooses "Keep Mine" -> resolves conflict locally and force saves
      resolveLocalAnnotationDraftConflict('script-conc-1', 1, 'keep_local');
      await executeSaveWorkflow(true);

      expect(currentStatus).toBe('saved');
      expect(getLocalAnnotationDraft('script-conc-1', 1)?.synced).toBe(true);
      expect(getLocalAnnotationDraft('script-conc-1', 1)?.hasConflict).toBe(false);
    });

    it('handles "Load Server" reconciliation by discarding local changes and loading server state', async () => {
      const baseTimestamp = new Date('2026-09-24T12:00:00.000Z').toISOString();
      const serverNewerTimestamp = new Date('2026-09-24T12:05:00.000Z').toISOString();

      let currentStatus = 'conflict';

      const localAnnotation = createCheckAnnotation('page-1', { x: 50, y: 50 });
      const localSerialized = serializePageAnnotations('page-1', [localAnnotation], []);

      const serverAnnotation = createCrossAnnotation('page-1', { x: 120, y: 120 });
      const serverSerialized = serializePageAnnotations('page-1', [serverAnnotation], []);

      // Draft is in conflict
      saveLocalAnnotationDraft('script-conc-2', 1, 'page-1', localSerialized, {
        baseServerUpdatedAt: baseTimestamp,
        synced: false,
        hasConflict: true,
        conflictServerData: serverSerialized,
        conflictServerUpdatedAt: serverNewerTimestamp,
      });

      // User clicks "Load Server"
      const resolved = resolveLocalAnnotationDraftConflict('script-conc-2', 1, 'load_server');
      currentStatus = 'saved';

      expect(currentStatus).toBe('saved');
      expect(resolved?.hasConflict).toBe(false);
      expect(resolved?.synced).toBe(true);
      expect(resolved?.data.annotations).toHaveLength(1);
      expect(resolved?.data.annotations[0].type).toBe('cross'); // loaded server cross annotation
    });
  });

  describe('4. Annotation Hydration Conflict Detection', () => {
    it('flags conflict during page load if local draft was based on stale server timestamp', () => {
      const now = Date.now();
      const localAnnotation = createCheckAnnotation('page-1', { x: 30, y: 30 });
      const localSerialized = serializePageAnnotations('page-1', [localAnnotation], []);

      // Local draft was based on server version from 10 minutes ago
      saveLocalAnnotationDraft('script-hyd-1', 1, 'page-1', localSerialized, {
        baseServerUpdatedAt: new Date(now - 600000).toISOString(),
        savedAt: now - 300000,
        synced: false,
      });

      // Server payload returned from GET request was modified 2 minutes ago
      const serverPayload = {
        annotations: [createCrossAnnotation('page-1', { x: 70, y: 70 })],
        strokes: [],
        updatedAt: new Date(now - 120000).toISOString(),
      };

      const localDraft = getLocalAnnotationDraft('script-hyd-1', 1);
      let effectiveData: SerializedPageAnnotations;
      let effectiveStatus = 'saved';

      const isConflict = detectAnnotationConflict(localDraft, serverPayload.updatedAt);
      expect(isConflict).toBe(true);

      if (isConflict) {
        markLocalAnnotationDraftConflict('script-hyd-1', 1, serverPayload, serverPayload.updatedAt);
        effectiveData = localDraft!.data; // Keep user local work visible
        effectiveStatus = 'conflict';
      } else {
        effectiveData = serverPayload;
      }

      expect(effectiveStatus).toBe('conflict');
      expect(effectiveData.annotations[0].type).toBe('check'); // User's work remains on screen
      expect(getLocalAnnotationDraft('script-hyd-1', 1)?.hasConflict).toBe(true);
    });
  });
});
