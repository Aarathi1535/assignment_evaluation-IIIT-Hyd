/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveLocalAnnotationDraft,
  getLocalAnnotationDraft,
  clearAllMemoryDrafts,
  flushPendingWrites,
  setCurrentDraftUser
} from '@/lib/offlineDrafts';
import type { SerializedPageAnnotations } from '@/lib/annotationSerialization';

describe('Offline Drafts Debounce AE-175', () => {
  const MOCK_SCRIPT_ID = 'debounce-test-script';
  const MOCK_PAGE_NUM = 1;
  const MOCK_PAGE_KEY = `${MOCK_SCRIPT_ID}_${MOCK_PAGE_NUM}`;
  const MOCK_DATA: SerializedPageAnnotations = {
    annotations: [],
    strokes: [
      { id: '1', points: [0, 0, 10, 10], color: 'red', strokeWidth: 2, pageKey: MOCK_PAGE_KEY, createdAt: 123456789 }
    ],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    clearAllMemoryDrafts();
    setCurrentDraftUser('test-user');
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    clearAllMemoryDrafts();
  });

  it('A. Immediate read: saveLocalAnnotationDraft immediately updates in-memory representation', () => {
    saveLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM, MOCK_PAGE_KEY, MOCK_DATA);

    // Read immediately without advancing timers
    const draft = getLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM);
    expect(draft).not.toBeNull();
    expect(draft?.data.strokes.length).toBe(1);

    // Verify localStorage has not yet received the write
    const key = `ae_draft_annotations:test-user:${MOCK_SCRIPT_ID}:${MOCK_PAGE_NUM}`;
    const rawLs = window.localStorage.getItem(key);
    expect(rawLs).toBeNull();
  });

  it('B. Timer flush: advances timers and verifies persistence', () => {
    saveLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM, MOCK_PAGE_KEY, MOCK_DATA);

    const key = `ae_draft_annotations:test-user:${MOCK_SCRIPT_ID}:${MOCK_PAGE_NUM}`;
    expect(window.localStorage.getItem(key)).toBeNull();

    // Advance by debounce interval
    vi.advanceTimersByTime(250);

    const rawLs = window.localStorage.getItem(key);
    expect(rawLs).not.toBeNull();
    const parsed = JSON.parse(rawLs!);
    expect(parsed.data.strokes.length).toBe(1);
  });

  it('C. Coalescing: multiple saves collapse into the latest draft before timer fires', () => {
    const dataA = { ...MOCK_DATA, strokes: [{ ...MOCK_DATA.strokes[0], id: 'A' }] };
    const dataB = { ...MOCK_DATA, strokes: [{ ...MOCK_DATA.strokes[0], id: 'B' }] };
    const dataC = { ...MOCK_DATA, strokes: [{ ...MOCK_DATA.strokes[0], id: 'C' }] };

    saveLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM, MOCK_PAGE_KEY, dataA);
    vi.advanceTimersByTime(50);
    
    saveLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM, MOCK_PAGE_KEY, dataB);
    vi.advanceTimersByTime(50);

    saveLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM, MOCK_PAGE_KEY, dataC);

    const key = `ae_draft_annotations:test-user:${MOCK_SCRIPT_ID}:${MOCK_PAGE_NUM}`;
    expect(window.localStorage.getItem(key)).toBeNull();

    vi.advanceTimersByTime(250); // Flush the final timer

    const rawLs = window.localStorage.getItem(key);
    expect(rawLs).not.toBeNull();
    const parsed = JSON.parse(rawLs!);
    expect(parsed.data.strokes[0].id).toBe('C');
  });

  it('D. Lifecycle flush: pagehide flushes pending writes immediately', () => {
    saveLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM, MOCK_PAGE_KEY, MOCK_DATA);

    const key = `ae_draft_annotations:test-user:${MOCK_SCRIPT_ID}:${MOCK_PAGE_NUM}`;
    expect(window.localStorage.getItem(key)).toBeNull();

    // Trigger flush
    flushPendingWrites();

    const rawLs = window.localStorage.getItem(key);
    expect(rawLs).not.toBeNull();
  });

  it('E. User isolation: pending draft for user A is not returned for user B', () => {
    setCurrentDraftUser('user-a');
    saveLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM, MOCK_PAGE_KEY, MOCK_DATA);

    setCurrentDraftUser('user-b');
    // Should be null for user B
    const draftB = getLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM);
    expect(draftB).toBeNull();

    // Verify User A can still get it
    setCurrentDraftUser('user-a');
    const draftA = getLocalAnnotationDraft(MOCK_SCRIPT_ID, MOCK_PAGE_NUM);
    expect(draftA).not.toBeNull();
    
    // Clean up
    vi.advanceTimersByTime(250);
  });
});
