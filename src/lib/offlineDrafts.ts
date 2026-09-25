import type { SerializedPageAnnotations } from './annotationSerialization';

export interface LocalAnnotationDraft {
  scriptId: string;
  pageNumber: number;
  pageKey: string;
  data: SerializedPageAnnotations;
  savedAt: number; // timestamp in ms (Date.now())
  synced: boolean;
  serverUpdatedAt?: string | number | null;
  baseServerUpdatedAt?: string | number | null; // The server timestamp this draft was based on when loaded
  hasConflict?: boolean; // True when a concurrent edit conflict is detected
  conflictServerData?: SerializedPageAnnotations | null; // Cached remote server data for reconciliation
  conflictServerUpdatedAt?: string | number | null;
  isRecoveredDraft?: boolean; // True when detected on reload/mount before user explicitly restores or discards
}

export interface LocalGradingDraft {
  scriptId: string;
  questionNumber: number;
  marksAwarded: Array<{ criterionName: string; score: number }>;
  feedback?: string;
  tagIds?: string[];
  savedAt: number;
  synced: boolean;
  serverUpdatedAt?: string | number | null;
  baseServerUpdatedAt?: string | number | null;
  hasConflict?: boolean;
}

export const ANNOTATION_DRAFT_PREFIX = 'ae_draft_annotations:';
export const GRADING_DRAFT_PREFIX = 'ae_draft_grading:';

// In-memory fallback map if localStorage is unavailable (e.g., SSR, private browsing restrictions, quota exceeded)
const memoryStorage = new Map<string, string>();

/**
 * Checks whether localStorage is available and writable in the current runtime environment.
 */
export function isLocalStorageAvailable(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }
    const testKey = '__ae_offline_draft_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to get the canonical storage key for a script page's annotation draft.
 */
export function getAnnotationDraftKey(scriptId: string, pageNumber: number): string {
  return `${ANNOTATION_DRAFT_PREFIX}${scriptId}:${pageNumber}`;
}

/**
 * Helper to get the canonical storage key for a script question's grading draft.
 */
export function getGradingDraftKey(scriptId: string, questionNumber: number): string {
  return `${GRADING_DRAFT_PREFIX}${scriptId}:${questionNumber}`;
}

/**
 * Persists a local annotation draft for a specific answer script page.
 */
export function saveLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number,
  pageKey: string,
  data: SerializedPageAnnotations,
  options?: {
    serverUpdatedAt?: string | number | null;
    baseServerUpdatedAt?: string | number | null;
    synced?: boolean;
    savedAt?: number;
    hasConflict?: boolean;
    conflictServerData?: SerializedPageAnnotations | null;
    conflictServerUpdatedAt?: string | number | null;
    isRecoveredDraft?: boolean;
  }
): LocalAnnotationDraft | null {
  if (!scriptId || typeof pageNumber !== 'number') {
    return null;
  }

  const existing = getLocalAnnotationDraft(scriptId, pageNumber);

  const draft: LocalAnnotationDraft = {
    scriptId,
    pageNumber,
    pageKey,
    data,
    savedAt: options?.savedAt ?? Date.now(),
    synced: options?.synced ?? false,
    serverUpdatedAt: options?.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
    baseServerUpdatedAt: options?.baseServerUpdatedAt ?? existing?.baseServerUpdatedAt ?? null,
    hasConflict: options?.hasConflict ?? existing?.hasConflict ?? false,
    conflictServerData: options?.conflictServerData ?? existing?.conflictServerData ?? null,
    conflictServerUpdatedAt: options?.conflictServerUpdatedAt ?? existing?.conflictServerUpdatedAt ?? null,
    isRecoveredDraft: options?.isRecoveredDraft ?? existing?.isRecoveredDraft ?? false,
  };

  const key = getAnnotationDraftKey(scriptId, pageNumber);
  const serialized = JSON.stringify(draft);

  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.setItem(key, serialized);
    } catch {
      memoryStorage.set(key, serialized);
    }
  } else {
    memoryStorage.set(key, serialized);
  }

  return draft;
}

/**
 * Retrieves the local annotation draft for a specific answer script page, if one exists.
 */
export function getLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number
): LocalAnnotationDraft | null {
  if (!scriptId || typeof pageNumber !== 'number') {
    return null;
  }

  const key = getAnnotationDraftKey(scriptId, pageNumber);
  let raw: string | null = null;

  if (isLocalStorageAvailable()) {
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      raw = null;
    }
  }

  if (!raw) {
    raw = memoryStorage.get(key) || null;
  }

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as LocalAnnotationDraft;
  } catch {
    return null;
  }
}

/**
 * Marks an existing local annotation draft as synced with the server.
 */
export function markLocalAnnotationDraftSynced(
  scriptId: string,
  pageNumber: number,
  serverUpdatedAt?: string | number | null
): void {
  const existing = getLocalAnnotationDraft(scriptId, pageNumber);
  if (existing) {
    const updatedTimestamp = serverUpdatedAt ?? existing.serverUpdatedAt;
    saveLocalAnnotationDraft(scriptId, pageNumber, existing.pageKey, existing.data, {
      serverUpdatedAt: updatedTimestamp,
      baseServerUpdatedAt: updatedTimestamp,
      synced: true,
      savedAt: existing.savedAt,
      hasConflict: false,
      conflictServerData: null,
      conflictServerUpdatedAt: null,
    });
  }
}

/**
 * Flags an existing local draft as conflicted due to concurrent modifications on the server.
 */
export function markLocalAnnotationDraftConflict(
  scriptId: string,
  pageNumber: number,
  conflictServerData?: SerializedPageAnnotations | null,
  conflictServerUpdatedAt?: string | number | null
): LocalAnnotationDraft | null {
  const existing = getLocalAnnotationDraft(scriptId, pageNumber);
  if (!existing) return null;

  return saveLocalAnnotationDraft(
    scriptId,
    pageNumber,
    existing.pageKey,
    existing.data,
    {
      serverUpdatedAt: existing.serverUpdatedAt,
      baseServerUpdatedAt: existing.baseServerUpdatedAt,
      savedAt: existing.savedAt,
      synced: false,
      hasConflict: true,
      conflictServerData: conflictServerData ?? existing.conflictServerData ?? null,
      conflictServerUpdatedAt: conflictServerUpdatedAt ?? existing.conflictServerUpdatedAt ?? null,
    }
  );
}

/**
 * Resolves a conflict on a local annotation draft.
 * - 'keep_local': Keeps user's local edits and updates baseServerUpdatedAt so the next save can proceed.
 * - 'load_server': Discards local uncommitted edits and replaces with server data.
 */
export function resolveLocalAnnotationDraftConflict(
  scriptId: string,
  pageNumber: number,
  resolution: 'keep_local' | 'load_server',
  serverData?: SerializedPageAnnotations | null,
  serverUpdatedAt?: string | number | null
): LocalAnnotationDraft | null {
  const existing = getLocalAnnotationDraft(scriptId, pageNumber);
  if (!existing) return null;

  if (resolution === 'keep_local') {
    const newBase = serverUpdatedAt ?? existing.conflictServerUpdatedAt ?? Date.now();
    return saveLocalAnnotationDraft(
      scriptId,
      pageNumber,
      existing.pageKey,
      existing.data,
      {
        serverUpdatedAt: newBase,
        baseServerUpdatedAt: newBase,
        savedAt: existing.savedAt,
        synced: false,
        hasConflict: false,
        conflictServerData: null,
        conflictServerUpdatedAt: null,
      }
    );
  } else {
    const finalData = serverData ?? existing.conflictServerData ?? { annotations: [], strokes: [] };
    const newBase = serverUpdatedAt ?? existing.conflictServerUpdatedAt ?? Date.now();
    return saveLocalAnnotationDraft(
      scriptId,
      pageNumber,
      existing.pageKey,
      finalData,
      {
        serverUpdatedAt: newBase,
        baseServerUpdatedAt: newBase,
        savedAt: Date.now(),
        synced: true,
        hasConflict: false,
        conflictServerData: null,
        conflictServerUpdatedAt: null,
        isRecoveredDraft: false,
      }
    );
  }
}

/**
 * Restores a recovered local draft after reload/crash (AE-172).
 * Marks the draft active for synchronization and clears the recovery prompt flag.
 */
export function restoreLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number
): LocalAnnotationDraft | null {
  const existing = getLocalAnnotationDraft(scriptId, pageNumber);
  if (!existing) return null;

  return saveLocalAnnotationDraft(
    scriptId,
    pageNumber,
    existing.pageKey,
    existing.data,
    {
      serverUpdatedAt: existing.serverUpdatedAt,
      baseServerUpdatedAt: existing.baseServerUpdatedAt,
      savedAt: existing.savedAt,
      synced: false,
      hasConflict: existing.hasConflict ?? false,
      conflictServerData: existing.conflictServerData,
      conflictServerUpdatedAt: existing.conflictServerUpdatedAt,
      isRecoveredDraft: false,
    }
  );
}

/**
 * Discards a recovered local draft after reload/crash (AE-172).
 * Replaces with server data or clears storage so recovery prompt will not reappear.
 */
export function discardLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number,
  serverData?: SerializedPageAnnotations | null,
  serverUpdatedAt?: string | number | null
): void {
  const existing = getLocalAnnotationDraft(scriptId, pageNumber);
  if (!existing) {
    clearLocalAnnotationDraft(scriptId, pageNumber);
    return;
  }

  if (serverData) {
    const newBase = serverUpdatedAt ?? existing.serverUpdatedAt ?? Date.now();
    saveLocalAnnotationDraft(
      scriptId,
      pageNumber,
      existing.pageKey,
      serverData,
      {
        serverUpdatedAt: newBase,
        baseServerUpdatedAt: newBase,
        savedAt: Date.now(),
        synced: true,
        hasConflict: false,
        conflictServerData: null,
        conflictServerUpdatedAt: null,
        isRecoveredDraft: false,
      }
    );
  } else {
    clearLocalAnnotationDraft(scriptId, pageNumber);
  }
}

/**
 * Checks whether an unsynced recoverable local draft exists for the given script/page (AE-172).
 */
export function hasRecoverableDraft(scriptId: string, pageNumber?: number): boolean {
  if (typeof pageNumber === 'number') {
    const draft = getLocalAnnotationDraft(scriptId, pageNumber);
    return Boolean(draft && !draft.synced && !draft.hasConflict);
  }
  const pending = getPendingAnnotationDrafts(scriptId);
  return pending.some((d) => !d.hasConflict);
}

/**
 * Clears the local annotation draft for a specific answer script page.
 */
export function clearLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number
): void {
  const key = getAnnotationDraftKey(scriptId, pageNumber);
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }
  memoryStorage.delete(key);
}

/**
 * Retrieves all pending (unsynced) annotation drafts, optionally filtered by script ID.
 */
export function getPendingAnnotationDrafts(
  scriptId?: string
): LocalAnnotationDraft[] {
  const draftsMap = new Map<string, LocalAnnotationDraft>();

  const processRaw = (raw: string | null) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as LocalAnnotationDraft;
      if (parsed && typeof parsed.scriptId === 'string' && typeof parsed.pageNumber === 'number' && !parsed.synced) {
        if (!scriptId || parsed.scriptId === scriptId) {
          const key = getAnnotationDraftKey(parsed.scriptId, parsed.pageNumber);
          draftsMap.set(key, parsed);
        }
      }
    } catch {}
  };

  if (isLocalStorageAvailable()) {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(ANNOTATION_DRAFT_PREFIX)) {
          processRaw(window.localStorage.getItem(k));
        }
      }
    } catch {}
  }

  for (const [k, v] of memoryStorage.entries()) {
    if (k.startsWith(ANNOTATION_DRAFT_PREFIX)) {
      processRaw(v);
    }
  }

  return Array.from(draftsMap.values());
}

/**
 * Retrieves all conflicted drafts, optionally filtered by script ID.
 */
export function getConflictDrafts(scriptId?: string): LocalAnnotationDraft[] {
  const allDrafts: LocalAnnotationDraft[] = [];

  const processRaw = (raw: string | null) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as LocalAnnotationDraft;
      if (parsed && typeof parsed.scriptId === 'string' && typeof parsed.pageNumber === 'number' && parsed.hasConflict) {
        if (!scriptId || parsed.scriptId === scriptId) {
          allDrafts.push(parsed);
        }
      }
    } catch {}
  };

  if (isLocalStorageAvailable()) {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(ANNOTATION_DRAFT_PREFIX)) {
          processRaw(window.localStorage.getItem(k));
        }
      }
    } catch {}
  }

  for (const [k, v] of memoryStorage.entries()) {
    if (k.startsWith(ANNOTATION_DRAFT_PREFIX)) {
      processRaw(v);
    }
  }

  return allDrafts;
}

/**
 * Checks whether any unsynced local drafts exist for the specified script (or page).
 */
export function hasPendingSync(scriptId?: string, pageNumber?: number): boolean {
  if (!scriptId) {
    return getPendingAnnotationDrafts().length > 0;
  }
  if (typeof pageNumber === 'number') {
    const draft = getLocalAnnotationDraft(scriptId, pageNumber);
    return Boolean(draft && !draft.synced);
  }
  const pending = getPendingAnnotationDrafts(scriptId);
  return pending.length > 0;
}

/**
 * Checks whether a conflict exists for the specified script (or page).
 */
export function hasConflict(scriptId: string, pageNumber?: number): boolean {
  if (typeof pageNumber === 'number') {
    const draft = getLocalAnnotationDraft(scriptId, pageNumber);
    return Boolean(draft && draft.hasConflict);
  }
  const conflicts = getConflictDrafts(scriptId);
  return conflicts.length > 0;
}

/**
 * Detects whether a conflict exists between the local draft and current server data.
 * A conflict occurs if the local draft has unsynced changes and the server was updated after
 * the draft's baseServerUpdatedAt (or if the draft is explicitly flagged as conflicted).
 */
export function detectAnnotationConflict(
  localDraft: LocalAnnotationDraft | null,
  serverUpdatedAt?: string | number | Date | null
): boolean {
  if (!localDraft || localDraft.synced) {
    return false;
  }
  if (localDraft.hasConflict) {
    return true;
  }
  if (localDraft.baseServerUpdatedAt && serverUpdatedAt) {
    const serverTime = new Date(serverUpdatedAt).getTime();
    const baseTime = new Date(localDraft.baseServerUpdatedAt).getTime();
    if (!isNaN(serverTime) && !isNaN(baseTime) && serverTime > baseTime) {
      return true;
    }
  }
  return false;
}

/**
 * Determines whether server data is strictly newer than the local draft savedAt timestamp.
 * Used to avoid silently overwriting newer server modifications.
 */
export function isServerDataNewer(
  localDraft: LocalAnnotationDraft | null,
  serverUpdatedAt?: string | number | Date | null
): boolean {
  if (!localDraft || !serverUpdatedAt) {
    return false;
  }
  const serverTime = new Date(serverUpdatedAt).getTime();
  if (isNaN(serverTime)) {
    return false;
  }

  return serverTime > localDraft.savedAt;
}

/**
 * Clears all in-memory drafts (useful for test isolation).
 */
export function clearAllMemoryDrafts(): void {
  memoryStorage.clear();
}

