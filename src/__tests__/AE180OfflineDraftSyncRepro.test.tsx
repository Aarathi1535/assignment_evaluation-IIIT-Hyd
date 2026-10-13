// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { AnswerSheetCanvas } from '../components/canvas/AnswerSheetCanvas';
import {
  saveLocalAnnotationDraft,
  getLocalAnnotationDraft,
  getPendingAnnotationDrafts,
  hasPendingSync,
  clearAllMemoryDrafts,
  setCurrentDraftUser,
} from '../lib/offlineDrafts';
import type { SerializedPageAnnotations } from '../lib/annotationSerialization';

// Mock CanvasStage and Layers
vi.mock('../components/canvas/CanvasStage', () => ({
  CanvasStage: ({ children }: any) => <div data-testid="mock-canvas-stage">{children}</div>,
  useCanvasStage: () => ({
    stage: null,
    dimensions: { width: 800, height: 600 },
    isReady: true,
  }),
}));

vi.mock('../components/canvas/PageImageLayer', () => ({
  PageImageLayer: () => <div data-testid="mock-page-image-layer" />,
}));

vi.mock('../components/canvas/PenLayer', () => ({
  PenLayer: () => <div data-testid="mock-pen-layer" />,
}));

vi.mock('../components/canvas/MarkLayer', () => ({
  MarkLayer: () => <div data-testid="mock-mark-layer" />,
}));

describe('AE-180: Bug 2 Offline Drafts Stuck Pending Sync Reproduction Tests', () => {
  const SCRIPT_ID = 'test-script-ae180';
  const PAGE_NUMBER = 1;
  const PAGE_KEY = `${SCRIPT_ID}_1`;
  const USER_ID = 'ta-grader-ae180';

  const sampleData: SerializedPageAnnotations = {
    annotations: [
      {
        id: 'mark-1',
        type: 'check',
        pageKey: PAGE_KEY,
        x: 100,
        y: 100,
        size: 24,
        color: '#16a34a',
        createdAt: Date.now(),
      },
    ],
    strokes: [
      {
        id: 'stroke-1',
        pageKey: PAGE_KEY,
        points: [10, 10, 20, 20],
        color: '#ef4444',
        strokeWidth: 2,
        createdAt: Date.now(),
      },
    ],
  };

  const mockPages = [
    {
      _id: 'page-1',
      id: 'page-1',
      pageNumber: 1,
      imageUrl: '/test-page-1.png',
      width: 800,
      height: 1100,
    },
  ];

  beforeEach(() => {
    window.localStorage.clear();
    clearAllMemoryDrafts();
    setCurrentDraftUser(USER_ID);
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    window.localStorage.clear();
    clearAllMemoryDrafts();
    vi.restoreAllMocks();
  });

  it('Bug 2A Reproduction: saved offline draft with null baseServerUpdatedAt fails to sync on reconnect and remains stuck pending sync', async () => {
    // 1. User saved a draft while offline (baseServerUpdatedAt is null/undefined)
    saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
      synced: false,
      baseServerUpdatedAt: null, // Initial offline edit has no base timestamp
      userId: USER_ID,
    });

    expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);

    const onSaveStatusChange = vi.fn();
    const saveAnnotationsMock = vi.fn().mockImplementation(async (params: any) => {
      // Backend requirement: requireBaseUpdatedAt rejects if baseUpdatedAt is null/undefined
      if (!params.baseUpdatedAt) {
        // Backend returns 400 Bad Request
        return {
          success: false,
          error: 'baseUpdatedAt is required on every save to ensure conflict detection',
        };
      }
      return {
        success: true,
        serverUpdatedAt: '2026-10-12T12:00:00.000Z',
      };
    });

    // Start offline
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

    await act(async () => {
      render(
        <AnswerSheetCanvas
          scriptId={SCRIPT_ID}
          pages={mockPages}
          userId={USER_ID}
          saveAnnotations={saveAnnotationsMock}
          onSaveStatusChange={onSaveStatusChange}
          enableAutosave={true}
          enableAnnotationLoading={false}
        />
      );
    });

    // 2. Reconnect: network comes back online
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    // On buggy code:
    // handleOnline called saveAnnotations with baseUpdatedAt: null (or undefined)
    // The call failed (success: false)
    // markLocalAnnotationDraftSynced was never called
    // draft remains in pending drafts: hasPendingSync is still true!
    // saveStatus remains 'pending_sync' instead of transitioning to 'saved'
    // On fixed code:
    // Draft resolves valid base timestamp, syncs successfully, and transitions to 'saved'
    const pendingDrafts = getPendingAnnotationDrafts(SCRIPT_ID, USER_ID);
    expect(pendingDrafts).toHaveLength(0);
    expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(false);
    expect(onSaveStatusChange).toHaveBeenCalledWith('saved');
  });

  it('Bug 2B Reproduction: pending offline draft remains stuck pending sync when canvas mounts while already online', async () => {
    // 1. User has a saved offline draft in storage
    saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
      synced: false,
      baseServerUpdatedAt: '2026-10-12T10:00:00.000Z',
      userId: USER_ID,
    });

    expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);

    const onSaveStatusChange = vi.fn();
    const saveAnnotationsMock = vi.fn().mockResolvedValue({
      success: true,
      serverUpdatedAt: '2026-10-12T12:00:00.000Z',
    });

    // 2. Browser is already online when user opens/mounts canvas
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

    await act(async () => {
      render(
        <AnswerSheetCanvas
          scriptId={SCRIPT_ID}
          pages={mockPages}
          userId={USER_ID}
          saveAnnotations={saveAnnotationsMock}
          onSaveStatusChange={onSaveStatusChange}
          enableAutosave={true}
          enableAnnotationLoading={false}
        />
      );
    });

    // On buggy code:
    // window.online event NEVER fires because browser is already online!
    // saveAnnotationsMock is never called on mount!
    // Draft remains pending indefinitely:
    expect(saveAnnotationsMock).toHaveBeenCalled();
    const pendingDrafts = getPendingAnnotationDrafts(SCRIPT_ID, USER_ID);
    expect(pendingDrafts).toHaveLength(0);
    expect(onSaveStatusChange).toHaveBeenCalledWith('saved');
  });

  it('Bug 2C: manual retry triggers synchronization of pending drafts and transitions to saved', async () => {
    // 1. User has a pending draft in storage
    saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
      synced: false,
      baseServerUpdatedAt: '2026-10-12T10:00:00.000Z',
      userId: USER_ID,
    });

    let saveCalled = false;
    const saveAnnotationsMock = vi.fn().mockImplementation(async () => {
      saveCalled = true;
      return {
        success: true,
        serverUpdatedAt: '2026-10-12T12:00:00.000Z',
      };
    });

    // Start offline so initial mount does not immediately auto-sync
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

    await act(async () => {
      render(
        <AnswerSheetCanvas
          scriptId={SCRIPT_ID}
          pages={mockPages}
          userId={USER_ID}
          saveAnnotations={saveAnnotationsMock}
          enableAutosave={true}
          enableAnnotationLoading={false}
        />
      );
    });

    expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);

    // Network restored
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

    // Click retry button in SaveStatusIndicator
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeDefined();

    await act(async () => {
      retryBtn.click();
    });

    expect(saveCalled).toBe(true);
    expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(false);
  });

  it('Bug 2D: unsynced user work is strictly preserved when offline or sync fails', async () => {
    // Save draft
    saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
      synced: false,
      baseServerUpdatedAt: '2026-10-12T10:00:00.000Z',
      userId: USER_ID,
    });

    const saveAnnotationsMock = vi.fn().mockImplementation(async () => {
      // Simulate persistent server error 500
      return {
        success: false,
        error: 'Internal Server Error (500)',
      };
    });

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

    await act(async () => {
      render(
        <AnswerSheetCanvas
          scriptId={SCRIPT_ID}
          pages={mockPages}
          userId={USER_ID}
          saveAnnotations={saveAnnotationsMock}
          enableAutosave={true}
          enableAnnotationLoading={false}
        />
      );
    });

    // The draft must NOT be discarded or wiped to clear the pending state!
    const draft = getLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, USER_ID);
    expect(draft).not.toBeNull();
    expect(draft?.data.annotations).toHaveLength(1);
    expect(draft?.data.strokes).toHaveLength(1);
    expect(draft?.synced).toBe(false);
    expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);
  });

  it('Bug 2E: server conflict during sync transitions to conflict state while preserving local draft', async () => {
    saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
      synced: false,
      baseServerUpdatedAt: '2026-10-12T10:00:00.000Z',
      userId: USER_ID,
    });

    const onSaveStatusChange = vi.fn();
    const saveAnnotationsMock = vi.fn().mockResolvedValue({
      success: false,
      conflict: true,
      serverData: { annotations: [], strokes: [] },
      serverUpdatedAt: '2026-10-12T11:00:00.000Z',
      error: 'Conflict: Server has newer changes',
    });

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

    await act(async () => {
      render(
        <AnswerSheetCanvas
          scriptId={SCRIPT_ID}
          pages={mockPages}
          userId={USER_ID}
          saveAnnotations={saveAnnotationsMock}
          onSaveStatusChange={onSaveStatusChange}
          enableAutosave={true}
          enableAnnotationLoading={false}
        />
      );
    });

    expect(onSaveStatusChange).toHaveBeenCalledWith('conflict');
    const draft = getLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, USER_ID);
    expect(draft?.hasConflict).toBe(true);
    // Unsynced work preserved
    expect(draft?.data.annotations).toHaveLength(1);
  });

  describe('AE-180: Production Fetch-Based Offline Draft Sync Regression Tests', () => {
    it('fetch-based sync error handling: HTTP 400 Bad Request transitions UI to error and preserves draft', async () => {
      saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
        synced: false,
        baseServerUpdatedAt: '2026-10-12T10:00:00.000Z',
        userId: USER_ID,
      });

      expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);

      const onSaveStatusChange = vi.fn();
      const onSaveError = vi.fn();

      const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              success: false,
              message: 'Invalid annotation payload format (400)',
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ annotations: [], strokes: [], updatedAt: '2026-10-12T10:00:00.000Z' }),
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

      await act(async () => {
        render(
          <AnswerSheetCanvas
            scriptId={SCRIPT_ID}
            pages={mockPages}
            userId={USER_ID}
            onSaveStatusChange={onSaveStatusChange}
            onSaveError={onSaveError}
            enableAutosave={true}
            enableAnnotationLoading={false}
          />
        );
      });

      expect(fetchMock).toHaveBeenCalled();
      expect(onSaveStatusChange).toHaveBeenCalledWith('error');
      expect(onSaveError).toHaveBeenCalled();

      // UI state: SaveStatusIndicator shows error badge with alert role and actionable text
      const indicator = screen.getByTestId('save-status-indicator');
      expect(indicator.getAttribute('data-status')).toBe('error');
      expect(indicator.getAttribute('role')).toBe('alert');
      expect(screen.getByTestId('save-status-error-detail').textContent).toContain('Invalid annotation payload format (400)');

      // Retry button is available for the user
      const retryBtn = screen.getByRole('button', { name: /retry/i });
      expect(retryBtn).toBeDefined();

      // Draft preservation: Draft is strictly NOT discarded or lost
      const draft = getLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, USER_ID);
      expect(draft).not.toBeNull();
      expect(draft?.data.annotations).toHaveLength(1);
      expect(draft?.data.strokes).toHaveLength(1);
      expect(draft?.synced).toBe(false);
      expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);
    });

    it('fetch-based sync error handling: HTTP 403 Forbidden transitions UI to error and preserves draft', async () => {
      saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
        synced: false,
        baseServerUpdatedAt: '2026-10-12T10:00:00.000Z',
        userId: USER_ID,
      });

      const onSaveStatusChange = vi.fn();
      const onSaveError = vi.fn();

      const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          return {
            ok: false,
            status: 403,
            json: async () => ({
              success: false,
              message: 'Grading permission denied: allocation unassigned (403)',
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

      await act(async () => {
        render(
          <AnswerSheetCanvas
            scriptId={SCRIPT_ID}
            pages={mockPages}
            userId={USER_ID}
            onSaveStatusChange={onSaveStatusChange}
            onSaveError={onSaveError}
            enableAutosave={true}
            enableAnnotationLoading={false}
          />
        );
      });

      expect(fetchMock).toHaveBeenCalled();
      expect(onSaveStatusChange).toHaveBeenCalledWith('error');

      const indicator = screen.getByTestId('save-status-indicator');
      expect(indicator.getAttribute('data-status')).toBe('error');
      expect(screen.getByTestId('save-status-error-detail').textContent).toContain('Grading permission denied: allocation unassigned (403)');

      // Draft must be preserved
      const draft = getLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, USER_ID);
      expect(draft?.synced).toBe(false);
      expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);
    });

    it('fetch-based sync error handling: HTTP 5xx Server Error transitions UI to error and preserves draft', async () => {
      saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
        synced: false,
        baseServerUpdatedAt: '2026-10-12T10:00:00.000Z',
        userId: USER_ID,
      });

      const onSaveStatusChange = vi.fn();

      const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              success: false,
              message: 'Internal Server Error (500)',
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

      await act(async () => {
        render(
          <AnswerSheetCanvas
            scriptId={SCRIPT_ID}
            pages={mockPages}
            userId={USER_ID}
            onSaveStatusChange={onSaveStatusChange}
            enableAutosave={true}
            enableAnnotationLoading={false}
          />
        );
      });

      expect(onSaveStatusChange).toHaveBeenCalledWith('error');

      const indicator = screen.getByTestId('save-status-indicator');
      expect(indicator.getAttribute('data-status')).toBe('error');
      expect(screen.getByTestId('save-status-error-detail').textContent).toContain('Internal Server Error (500)');

      const draft = getLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, USER_ID);
      expect(draft?.synced).toBe(false);
      expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);
    });

    it('fetch-based sync error handling: network failure / rejected request transitions UI to error and preserves draft', async () => {
      saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
        synced: false,
        baseServerUpdatedAt: '2026-10-12T10:00:00.000Z',
        userId: USER_ID,
      });

      const onSaveStatusChange = vi.fn();

      const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          throw new TypeError('Failed to fetch');
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

      await act(async () => {
        render(
          <AnswerSheetCanvas
            scriptId={SCRIPT_ID}
            pages={mockPages}
            userId={USER_ID}
            onSaveStatusChange={onSaveStatusChange}
            enableAutosave={true}
            enableAnnotationLoading={false}
          />
        );
      });

      expect(onSaveStatusChange).toHaveBeenCalledWith('error');

      const indicator = screen.getByTestId('save-status-indicator');
      expect(indicator.getAttribute('data-status')).toBe('error');
      expect(screen.getByText('Save failed')).toBeDefined();

      const draft = getLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, USER_ID);
      expect(draft?.synced).toBe(false);
      expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);
    });

    it('successful retry after failed fetch sync synchronizes pending draft and transitions UI to saved', async () => {
      saveLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, PAGE_KEY, sampleData, {
        synced: false,
        baseServerUpdatedAt: '2026-10-12T10:00:00.000Z',
        userId: USER_ID,
      });

      let shouldFail = true;
      const onSaveStatusChange = vi.fn();

      const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          if (shouldFail) {
            return {
              ok: false,
              status: 500,
              json: async () => ({
                success: false,
                message: 'Internal Server Error (500)',
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { updatedAt: '2026-10-13T12:00:00.000Z' },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

      await act(async () => {
        render(
          <AnswerSheetCanvas
            scriptId={SCRIPT_ID}
            pages={mockPages}
            userId={USER_ID}
            onSaveStatusChange={onSaveStatusChange}
            enableAutosave={true}
            enableAnnotationLoading={false}
          />
        );
      });

      // Initial sync failed: status is error, draft preserved
      expect(onSaveStatusChange).toHaveBeenCalledWith('error');
      expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(true);

      const retryBtn = screen.getByRole('button', { name: /retry/i });
      expect(retryBtn).toBeDefined();

      // Now server recovers
      shouldFail = false;

      await act(async () => {
        retryBtn.click();
      });

      // Retried sync succeeds: status transitions to syncing and then saved
      expect(onSaveStatusChange).toHaveBeenCalledWith('syncing');
      expect(onSaveStatusChange).toHaveBeenCalledWith('saved');

      const indicator = screen.getByTestId('save-status-indicator');
      expect(indicator.getAttribute('data-status')).toBe('saved');
      expect(screen.getByText('Saved')).toBeDefined();

      // Draft is marked synced and pending state is resolved
      expect(hasPendingSync(SCRIPT_ID, PAGE_NUMBER, USER_ID)).toBe(false);
      expect(getPendingAnnotationDrafts(SCRIPT_ID, USER_ID)).toHaveLength(0);
      const syncedDraft = getLocalAnnotationDraft(SCRIPT_ID, PAGE_NUMBER, USER_ID);
      expect(syncedDraft?.synced).toBe(true);
    });
  });
});
