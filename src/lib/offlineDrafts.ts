import type { SerializedPageAnnotations } from './annotationSerialization';
import {
  isCanvasProfilingEnabled,
  markCanvasProfile,
  measureCanvasProfile,
} from './canvasProfiling';

export interface LocalAnnotationDraft {
  userId?: string;
  scriptId: string;
  pageNumber: number;
  pageKey: string;
  data: SerializedPageAnnotations;
  savedAt: number; // timestamp in ms (Date.now())
  synced: boolean;
  serverUpdatedAt?: string | number | null;
  baseServerUpdatedAt?: string | number | null; // The server timestamp this draft was based on when loaded
  superseded?: boolean; // When server copy is newer during hydration, draft is marked superseded so it cannot be pushed on reconnect
  hasConflict?: boolean; // True when a concurrent edit conflict is detected (AE-171)
  conflictServerData?: SerializedPageAnnotations | null; // Cached remote server data for reconciliation (AE-171)
  conflictServerUpdatedAt?: string | number | null;
  isRecoveredDraft?: boolean; // True when detected on reload/mount before user explicitly restores or discards (AE-172)
}

export const ANNOTATION_DRAFT_PREFIX = 'ae_draft_annotations:';

// In-memory fallback map if localStorage is unavailable (e.g., SSR, private browsing restrictions, quota exceeded)
const memoryStorage = new Map<string, string>();

const pendingDrafts = new Map<string, LocalAnnotationDraft>();
const writeTimers = new Map<string, NodeJS.Timeout>();

export function flushPendingWrites(): void {
  pendingDrafts.forEach((draft, key) => {
    try {
      const serialized = JSON.stringify(draft);
      memoryStorage.set(key, serialized);
      if (isLocalStorageAvailable()) {
        window.localStorage.setItem(key, serialized);
      }
    } catch {}
  });
  pendingDrafts.clear();
  writeTimers.forEach(timer => clearTimeout(timer));
  writeTimers.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingWrites);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingWrites();
    }
  });
}

let currentDraftUserId = 'default';

/**
 * Sets the active user ID for user-isolated offline drafts.
 */
export function setCurrentDraftUser(userId: string | null | undefined): void {
  currentDraftUserId = userId?.trim() || 'default';
}

/**
 * Gets the current active user ID for offline drafts.
 */
export function getCurrentDraftUser(): string {
  return currentDraftUserId;
}

let _isLocalStorageAvailable: boolean | null = null;

/**
 * Checks whether localStorage is available and writable in the current runtime environment.
 */
export function isLocalStorageAvailable(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }
  if (_isLocalStorageAvailable !== null) return _isLocalStorageAvailable;
  try {
    const testKey = '__ae_offline_draft_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    _isLocalStorageAvailable = true;
    return true;
  } catch {
    _isLocalStorageAvailable = false;
    return false;
  }
}

/**
 * Helper to get the canonical storage key for a script page's annotation draft,
 * strictly user-isolated to prevent cross-user draft pollution on shared lab machines.
 */
export function getAnnotationDraftKey(
  userIdOrScriptId: string,
  scriptIdOrPageNum: string | number,
  maybePageNum?: number
): string {
  if (typeof maybePageNum === 'number') {
    const userId = userIdOrScriptId || currentDraftUserId;
    const scriptId = String(scriptIdOrPageNum);
    return `${ANNOTATION_DRAFT_PREFIX}${userId}:${scriptId}:${maybePageNum}`;
  }
  const userId = currentDraftUserId;
  const scriptId = userIdOrScriptId;
  const pageNum = scriptIdOrPageNum as number;
  return `${ANNOTATION_DRAFT_PREFIX}${userId}:${scriptId}:${pageNum}`;
}

export interface SaveAnnotationDraftOptions {
  userId?: string;
  serverUpdatedAt?: string | number | null;
  baseServerUpdatedAt?: string | number | null;
  synced?: boolean;
  savedAt?: number;
  superseded?: boolean;
  hasConflict?: boolean;
  conflictServerData?: SerializedPageAnnotations | null;
  conflictServerUpdatedAt?: string | number | null;
  isRecoveredDraft?: boolean;
}

/**
 * Persists a local annotation draft for a specific answer script page.
 */
export function saveLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number,
  pageKey: string,
  data: SerializedPageAnnotations,
  options?: SaveAnnotationDraftOptions,
  userId?: string
): LocalAnnotationDraft | null {
  if (!scriptId || typeof pageNumber !== 'number') {
    return null;
  }

  const isDevProfiling = isCanvasProfilingEnabled();
  if (isDevProfiling) markCanvasProfile('save-draft-start');

  const effectiveUserId = userId || options?.userId || currentDraftUserId;
  const existing = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);

  const draft: LocalAnnotationDraft = {
    userId: effectiveUserId,
    scriptId,
    pageNumber,
    pageKey,
    data,
    savedAt: options?.savedAt ?? Date.now(),
    synced: options?.synced ?? false,
    serverUpdatedAt: options?.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
    baseServerUpdatedAt: options?.baseServerUpdatedAt ?? existing?.baseServerUpdatedAt ?? null,
    superseded: options?.superseded ?? existing?.superseded ?? false,
    hasConflict: options?.hasConflict ?? existing?.hasConflict ?? false,
    conflictServerData: options?.conflictServerData ?? existing?.conflictServerData ?? null,
    conflictServerUpdatedAt: options?.conflictServerUpdatedAt ?? existing?.conflictServerUpdatedAt ?? null,
    isRecoveredDraft: options?.isRecoveredDraft ?? existing?.isRecoveredDraft ?? false,
  };

  const key = getAnnotationDraftKey(effectiveUserId, scriptId, pageNumber);

  pendingDrafts.set(key, draft);

  if (writeTimers.has(key)) {
    clearTimeout(writeTimers.get(key));
  }

  const timer = setTimeout(() => {
    const d = pendingDrafts.get(key);
    if (d) {
      try {
        const serialized = JSON.stringify(d);
        memoryStorage.set(key, serialized);
        if (isLocalStorageAvailable()) {
          window.localStorage.setItem(key, serialized);
        }
      } catch {}
      pendingDrafts.delete(key);
    }
    writeTimers.delete(key);
  }, 200);

  writeTimers.set(key, timer);

  if (isDevProfiling) {
    markCanvasProfile('save-draft-end');
    measureCanvasProfile('saveLocalAnnotationDraft', 'save-draft-start', 'save-draft-end');
  }

  return draft;
}

/**
 * Retrieves the local annotation draft for a specific answer script page, if one exists.
 */
export function getLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number,
  userId?: string
): LocalAnnotationDraft | null {
  if (!scriptId || typeof pageNumber !== 'number') {
    return null;
  }

  const effectiveUserId = userId || currentDraftUserId;
  const key = getAnnotationDraftKey(effectiveUserId, scriptId, pageNumber);

  if (pendingDrafts.has(key)) {
    return pendingDrafts.get(key)!;
  }

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
 * AE-170 requirement: Once synced, strips the full strokes/notes payload to avoid bloat,
 * retaining only the essential status/sync metadata.
 */
export function markLocalAnnotationDraftSynced(
  scriptId: string,
  pageNumber: number,
  serverUpdatedAt?: string | number | null,
  userId?: string
): void {
  const effectiveUserId = userId || currentDraftUserId;
  const existing = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
  if (existing) {
    const updatedTimestamp = serverUpdatedAt ?? existing.serverUpdatedAt ?? Date.now();
    const strippedData: SerializedPageAnnotations = {
      annotations: [],
      strokes: [],
    };
    saveLocalAnnotationDraft(scriptId, pageNumber, existing.pageKey, strippedData, {
      userId: effectiveUserId,
      serverUpdatedAt: updatedTimestamp,
      baseServerUpdatedAt: updatedTimestamp,
      synced: true,
      savedAt: existing.savedAt,
      superseded: false,
      hasConflict: false,
      conflictServerData: null,
      conflictServerUpdatedAt: null,
      isRecoveredDraft: false,
    }, effectiveUserId);
  }
}

/**
 * Marks an existing local draft as superseded by a newer server copy during hydration.
 * AE-170 requirement: When the server copy is newer during hydration/page load, clear or
 * mark the local draft superseded so it cannot be pushed again on reconnect.
 */
export function markLocalAnnotationDraftSuperseded(
  scriptId: string,
  pageNumber: number,
  serverUpdatedAt?: string | number | null,
  userId?: string
): void {
  const effectiveUserId = userId || currentDraftUserId;
  const existing = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
  if (existing) {
    const strippedData: SerializedPageAnnotations = {
      annotations: [],
      strokes: [],
    };
    saveLocalAnnotationDraft(scriptId, pageNumber, existing.pageKey, strippedData, {
      userId: effectiveUserId,
      serverUpdatedAt: serverUpdatedAt ?? existing.serverUpdatedAt,
      baseServerUpdatedAt: serverUpdatedAt ?? existing.baseServerUpdatedAt,
      synced: false,
      savedAt: existing.savedAt,
      superseded: true,
      hasConflict: false,
      conflictServerData: null,
      conflictServerUpdatedAt: null,
      isRecoveredDraft: false,
    }, effectiveUserId);
  }
}

/**
 * Marks a local draft as having a concurrent edit conflict (AE-171).
 * Preserves local unsaved edits in place while attaching the conflicting server data.
 */
export function markLocalAnnotationDraftConflict(
  scriptId: string,
  pageNumber: number,
  serverData?: SerializedPageAnnotations | null,
  serverUpdatedAt?: string | number | null,
  userId?: string
): LocalAnnotationDraft | null {
  const effectiveUserId = userId || currentDraftUserId;
  const existing = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
  if (!existing) {
    return null;
  }

  return saveLocalAnnotationDraft(
    scriptId,
    pageNumber,
    existing.pageKey,
    existing.data,
    {
      userId: effectiveUserId,
      savedAt: existing.savedAt,
      synced: false,
      baseServerUpdatedAt: existing.baseServerUpdatedAt,
      hasConflict: true,
      conflictServerData: serverData ?? null,
      conflictServerUpdatedAt: serverUpdatedAt ? String(serverUpdatedAt) : null,
      isRecoveredDraft: false,
    },
    effectiveUserId
  );
}

/**
 * Reconciles a conflicted local draft according to user choice (AE-171).
 * - 'keep_local': clears conflict flag, preserves local edits, advances baseServerUpdatedAt to conflict timestamp.
 * - 'load_server': replaces local edits with remote server data, marks synced: true.
 */
export function resolveLocalAnnotationDraftConflict(
  scriptId: string,
  pageNumber: number,
  resolution: 'keep_local' | 'load_server',
  serverData?: SerializedPageAnnotations | null,
  serverUpdatedAt?: string | number | null,
  userId?: string
): LocalAnnotationDraft | null {
  const effectiveUserId = userId || currentDraftUserId;
  const existing = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
  if (!existing) {
    return null;
  }

  if (resolution === 'keep_local') {
    return saveLocalAnnotationDraft(
      scriptId,
      pageNumber,
      existing.pageKey,
      existing.data,
      {
        userId: effectiveUserId,
        savedAt: Date.now(),
        synced: false,
        baseServerUpdatedAt: existing.conflictServerUpdatedAt || serverUpdatedAt || existing.baseServerUpdatedAt,
        hasConflict: false,
        conflictServerData: null,
        conflictServerUpdatedAt: null,
        isRecoveredDraft: false,
      },
      effectiveUserId
    );
  } else {
    const dataToUse = serverData || existing.conflictServerData || { annotations: [], strokes: [] };
    const updatedTimestamp = serverUpdatedAt || existing.conflictServerUpdatedAt || existing.serverUpdatedAt || Date.now();
    return saveLocalAnnotationDraft(
      scriptId,
      pageNumber,
      existing.pageKey,
      dataToUse,
      {
        userId: effectiveUserId,
        savedAt: Date.now(),
        synced: true,
        serverUpdatedAt: updatedTimestamp,
        baseServerUpdatedAt: updatedTimestamp,
        hasConflict: false,
        conflictServerData: null,
        conflictServerUpdatedAt: null,
        isRecoveredDraft: false,
      },
      effectiveUserId
    );
  }
}

/**
 * Detects whether incoming server data conflicts with an uncommitted local draft (AE-171).
 * Returns true if the draft has unsynced local edits AND the server updatedAt is newer than
 * the baseServerUpdatedAt that this draft was branched from.
 */
export function detectAnnotationConflict(
  localDraft: LocalAnnotationDraft | null,
  serverUpdatedAt?: string | number | Date | null
): boolean {
  if (!localDraft || localDraft.synced || localDraft.superseded) {
    return false;
  }

  if (localDraft.hasConflict) {
    return true;
  }

  if (!serverUpdatedAt || !localDraft.baseServerUpdatedAt) {
    return false;
  }

  const serverTime =
    typeof serverUpdatedAt === 'number'
      ? serverUpdatedAt
      : new Date(serverUpdatedAt).getTime();

  const baseTime =
    typeof localDraft.baseServerUpdatedAt === 'number'
      ? localDraft.baseServerUpdatedAt
      : new Date(localDraft.baseServerUpdatedAt).getTime();

  if (Number.isNaN(serverTime) || Number.isNaN(baseTime)) {
    return false;
  }

  return serverTime > baseTime;
}

/**
 * Checks whether a specific script or page has an active concurrent conflict (AE-171).
 */
export function hasConflict(
  scriptId?: string,
  pageNumber?: number,
  userId?: string
): boolean {
  const effectiveUserId = userId || currentDraftUserId;
  if (!scriptId) {
    return getConflictDrafts(undefined, effectiveUserId).length > 0;
  }
  if (typeof pageNumber === 'number') {
    const draft = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
    return Boolean(draft && draft.hasConflict);
  }
  return getConflictDrafts(scriptId, effectiveUserId).length > 0;
}

/**
 * Retrieves all drafts with active conflicts (AE-171).
 */
export function getConflictDrafts(
  scriptId?: string,
  userId?: string
): LocalAnnotationDraft[] {
  const effectiveUserId = userId || currentDraftUserId;
  const draftsMap = new Map<string, LocalAnnotationDraft>();
  const expectedPrefix =
    effectiveUserId !== undefined && effectiveUserId !== null
      ? `${ANNOTATION_DRAFT_PREFIX}${effectiveUserId}:`
      : ANNOTATION_DRAFT_PREFIX;

  const processDraft = (key: string, parsed: LocalAnnotationDraft | null) => {
    if (!parsed) return;
    if (
      typeof parsed.scriptId === 'string' &&
      typeof parsed.pageNumber === 'number' &&
      parsed.hasConflict
    ) {
      if (!scriptId || parsed.scriptId === scriptId) {
        if (!effectiveUserId || parsed.userId === effectiveUserId) {
          draftsMap.set(key, parsed);
        }
      }
    }
  };

  const processRaw = (key: string, raw: string | null) => {
    if (!raw) return;
    try {
      processDraft(key, JSON.parse(raw) as LocalAnnotationDraft);
    } catch {}
  };

  if (isLocalStorageAvailable()) {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(expectedPrefix)) {
          processRaw(k, window.localStorage.getItem(k));
        }
      }
    } catch {}
  }

  memoryStorage.forEach((v, k) => {
    if (k.startsWith(expectedPrefix)) {
      processRaw(k, v);
    }
  });

  pendingDrafts.forEach((v, k) => {
    if (k.startsWith(expectedPrefix)) {
      processDraft(k, v);
    }
  });

  return Array.from(draftsMap.values());
}

/**
 * Restores a recovered local draft after reload/crash (AE-172).
 * Marks the draft active for synchronization and clears the recovery prompt flag.
 * Only restores drafts belonging to the logged-in user (Mentor Fix 2).
 */
export function restoreLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number,
  userId?: string
): LocalAnnotationDraft | null {
  const effectiveUserId = userId || currentDraftUserId;
  const existing = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
  if (!existing) return null;

  return saveLocalAnnotationDraft(
    scriptId,
    pageNumber,
    existing.pageKey,
    existing.data,
    {
      userId: effectiveUserId,
      serverUpdatedAt: existing.serverUpdatedAt,
      baseServerUpdatedAt: existing.baseServerUpdatedAt,
      savedAt: existing.savedAt,
      synced: false,
      hasConflict: existing.hasConflict ?? false,
      conflictServerData: existing.conflictServerData,
      conflictServerUpdatedAt: existing.conflictServerUpdatedAt,
      isRecoveredDraft: false,
    },
    effectiveUserId
  );
}

/**
 * Discards a recovered local draft after reload/crash (AE-172).
 * Replaces with server data or clears storage so recovery prompt will not reappear.
 * Only affects drafts belonging to the logged-in user (Mentor Fix 2).
 */
export function discardLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number,
  serverData?: SerializedPageAnnotations | null,
  serverUpdatedAt?: string | number | null,
  userId?: string
): void {
  const effectiveUserId = userId || currentDraftUserId;
  const existing = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
  if (!existing) {
    clearLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
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
        userId: effectiveUserId,
        serverUpdatedAt: newBase,
        baseServerUpdatedAt: newBase,
        savedAt: Date.now(),
        synced: true,
        hasConflict: false,
        conflictServerData: null,
        conflictServerUpdatedAt: null,
        isRecoveredDraft: false,
      },
      effectiveUserId
    );
  } else {
    clearLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
  }
}

/**
 * Checks whether an unsynced recoverable local draft exists for the given script/page (AE-172).
 * Must only offer drafts belonging to the logged-in user (Mentor Fix 2).
 */
export function hasRecoverableDraft(
  scriptId: string,
  pageNumber?: number,
  userId?: string
): boolean {
  const effectiveUserId = userId || currentDraftUserId;
  if (typeof pageNumber === 'number') {
    const draft = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
    return Boolean(draft && !draft.synced && !draft.superseded && !draft.hasConflict);
  }
  const pending = getPendingAnnotationDrafts(scriptId, effectiveUserId);
  return pending.some((d) => !d.hasConflict);
}

/**
 * Clears the local annotation draft for a specific answer script page.
 */
export function clearLocalAnnotationDraft(
  scriptId: string,
  pageNumber: number,
  userId?: string
): void {
  const effectiveUserId = userId || currentDraftUserId;
  const key = getAnnotationDraftKey(effectiveUserId, scriptId, pageNumber);

  if (writeTimers.has(key)) {
    clearTimeout(writeTimers.get(key));
    writeTimers.delete(key);
  }
  pendingDrafts.delete(key);

  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }
  memoryStorage.delete(key);
}

/**
 * Clears all drafts for a script after successful final submit.
 * AE-170 / AE-172 requirement: Clear the relevant draft after successful submit.
 */
export function clearDraftOnSubmit(
  scriptId: string,
  pageNumber?: number,
  userId?: string
): void {
  const effectiveUserId = userId || currentDraftUserId;
  if (typeof pageNumber === 'number') {
    clearLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
    return;
  }
  clearAllScriptDrafts(scriptId, effectiveUserId);
}

/**
 * Clears all page annotation drafts for a specific script.
 */
export function clearAllScriptDrafts(scriptId: string, userId?: string): void {
  const effectiveUserId = userId || currentDraftUserId;
  const matches = (k: string) => {
    if (effectiveUserId) {
      return (
        k.startsWith(`${ANNOTATION_DRAFT_PREFIX}${effectiveUserId}:${scriptId}:`)
      );
    }
    return (
      k.startsWith(ANNOTATION_DRAFT_PREFIX) &&
      (k.includes(`:${scriptId}:`) || k.endsWith(`:${scriptId}`))
    );
  };

  if (isLocalStorageAvailable()) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && matches(k)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => window.localStorage.removeItem(k));
    } catch {}
  }

  const memKeysToRemove: string[] = [];
  memoryStorage.forEach((_, k) => {
    if (matches(k)) {
      memKeysToRemove.push(k);
    }
  });
  pendingDrafts.forEach((_, k) => {
    if (matches(k) && !memKeysToRemove.includes(k)) {
      memKeysToRemove.push(k);
    }
  });
  memKeysToRemove.forEach((k) => {
    memoryStorage.delete(k);
    pendingDrafts.delete(k);
    if (writeTimers.has(k)) {
      clearTimeout(writeTimers.get(k));
      writeTimers.delete(k);
    }
  });
}

/**
 * Clears all drafts belonging to a specific user on logout.
 * AE-170 / AE-172 requirement: Clear the user's drafts on logout.
 */
export function clearUserDrafts(userId?: string): void {
  const effectiveUserId = userId || currentDraftUserId;
  if (!effectiveUserId) return;
  const annotUserPrefix = `${ANNOTATION_DRAFT_PREFIX}${effectiveUserId}:`;

  if (isLocalStorageAvailable()) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(annotUserPrefix)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => window.localStorage.removeItem(k));
    } catch {}
  }

  const memKeysToRemove: string[] = [];
  memoryStorage.forEach((_, k) => {
    if (k.startsWith(annotUserPrefix)) {
      memKeysToRemove.push(k);
    }
  });
  pendingDrafts.forEach((_, k) => {
    if (k.startsWith(annotUserPrefix) && !memKeysToRemove.includes(k)) {
      memKeysToRemove.push(k);
    }
  });
  memKeysToRemove.forEach((k) => {
    memoryStorage.delete(k);
    pendingDrafts.delete(k);
    if (writeTimers.has(k)) {
      clearTimeout(writeTimers.get(k));
      writeTimers.delete(k);
    }
  });
}

/**
 * Retrieves all pending (unsynced, not superseded, not in conflict) annotation drafts,
 * optionally filtered by script ID and user ID.
 */
export function getPendingAnnotationDrafts(
  scriptId?: string,
  userId?: string
): LocalAnnotationDraft[] {
  const effectiveUserId = userId || currentDraftUserId;
  const draftsMap = new Map<string, LocalAnnotationDraft>();
  const expectedPrefix =
    effectiveUserId !== undefined && effectiveUserId !== null
      ? `${ANNOTATION_DRAFT_PREFIX}${effectiveUserId}:`
      : ANNOTATION_DRAFT_PREFIX;

  const processDraft = (key: string, parsed: LocalAnnotationDraft | null) => {
    if (!parsed) return;
    if (
      typeof parsed.scriptId === 'string' &&
      typeof parsed.pageNumber === 'number' &&
      !parsed.synced &&
      !parsed.superseded &&
      !parsed.hasConflict
    ) {
      if (!scriptId || parsed.scriptId === scriptId) {
        if (!effectiveUserId || parsed.userId === effectiveUserId) {
          draftsMap.set(key, parsed);
        }
      }
    }
  };

  const processRaw = (key: string, raw: string | null) => {
    if (!raw) return;
    try {
      processDraft(key, JSON.parse(raw) as LocalAnnotationDraft);
    } catch {}
  };

  if (isLocalStorageAvailable()) {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(expectedPrefix)) {
          processRaw(k, window.localStorage.getItem(k));
        }
      }
    } catch {}
  }

  memoryStorage.forEach((v, k) => {
    if (k.startsWith(expectedPrefix)) {
      processRaw(k, v);
    }
  });

  pendingDrafts.forEach((v, k) => {
    if (k.startsWith(expectedPrefix)) {
      processDraft(k, v);
    }
  });

  return Array.from(draftsMap.values());
}

/**
 * Checks whether any unsynced local drafts exist for the specified script (or page).
 */
export function hasPendingSync(
  scriptId?: string,
  pageNumber?: number,
  userId?: string
): boolean {
  const effectiveUserId = userId || currentDraftUserId;
  if (!scriptId) {
    return getPendingAnnotationDrafts(undefined, effectiveUserId).length > 0;
  }
  if (typeof pageNumber === 'number') {
    const draft = getLocalAnnotationDraft(scriptId, pageNumber, effectiveUserId);
    return Boolean(draft && !draft.synced && !draft.superseded && !draft.hasConflict);
  }
  const pending = getPendingAnnotationDrafts(scriptId, effectiveUserId);
  return pending.length > 0;
}

/**
 * Determines whether server data is strictly newer than the local draft's stored server updatedAt.
 * Mentor Fix 1: Compare the draft's stored server updatedAt against the current server updatedAt.
 * Never compare the client's clock (savedAt), unless no server timestamp was ever recorded.
 */
export function isServerDataNewer(
  localDraft: LocalAnnotationDraft | null,
  serverUpdatedAt?: string | number | Date | null
): boolean {
  if (!localDraft || !serverUpdatedAt) {
    return false;
  }

  const serverTime =
    typeof serverUpdatedAt === 'number'
      ? serverUpdatedAt
      : new Date(serverUpdatedAt).getTime();

  if (Number.isNaN(serverTime)) {
    return false;
  }

  const storedServer = localDraft.baseServerUpdatedAt ?? localDraft.serverUpdatedAt;
  if (storedServer != null) {
    const storedServerTime =
      typeof storedServer === 'number'
        ? storedServer
        : new Date(storedServer).getTime();
    if (!Number.isNaN(storedServerTime)) {
      return serverTime > storedServerTime;
    }
  }
  // AE-172: If no server base timestamp exists in the draft, we cannot
  // safely determine if the server is newer. We do not fall back to the
  // client clock. Return false to keep the local draft and rely on the
  // backend's 409 Conflict detection during sync.
  return false;
}

/**
 * Clears all in-memory drafts (useful for test isolation).
 */
export function clearAllMemoryDrafts(): void {
  memoryStorage.clear();
  pendingDrafts.clear();
  writeTimers.forEach(timer => clearTimeout(timer));
  writeTimers.clear();
}
