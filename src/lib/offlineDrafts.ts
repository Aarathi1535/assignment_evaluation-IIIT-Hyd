import type { SerializedPageAnnotations } from './annotationSerialization';

export interface LocalAnnotationDraft {
  userId?: string;
  scriptId: string;
  pageNumber: number;
  pageKey: string;
  data: SerializedPageAnnotations;
  savedAt: number; // timestamp in ms (Date.now())
  synced: boolean;
  serverUpdatedAt?: string | number | null;
  baseServerUpdatedAt?: string | number | null;
  superseded?: boolean; // When server copy is newer during hydration, draft is marked superseded so it cannot be pushed on reconnect
}

export interface LocalGradingDraft {
  userId?: string;
  scriptId: string;
  questionNumber: number;
  marksAwarded: Array<{ criterionName: string; score: number }>;
  feedback?: string;
  tagIds?: string[];
  savedAt: number;
  synced: boolean;
  serverUpdatedAt?: string | number | null;
  baseServerUpdatedAt?: string | number | null;
  superseded?: boolean;
}

export const ANNOTATION_DRAFT_PREFIX = 'ae_draft_annotations:';
export const GRADING_DRAFT_PREFIX = 'ae_draft_grading:';

// In-memory fallback map if localStorage is unavailable (e.g., SSR, private browsing restrictions, quota exceeded)
const memoryStorage = new Map<string, string>();

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

/**
 * Helper to get the canonical storage key for a script question's grading draft,
 * strictly user-isolated.
 */
export function getGradingDraftKey(
  userIdOrScriptId: string,
  scriptIdOrQuestionNum: string | number,
  maybeQuestionNum?: number
): string {
  if (typeof maybeQuestionNum === 'number') {
    const userId = userIdOrScriptId || currentDraftUserId;
    const scriptId = String(scriptIdOrQuestionNum);
    return `${GRADING_DRAFT_PREFIX}${userId}:${scriptId}:${maybeQuestionNum}`;
  }
  const userId = currentDraftUserId;
  const scriptId = userIdOrScriptId;
  const questionNum = scriptIdOrQuestionNum as number;
  return `${GRADING_DRAFT_PREFIX}${userId}:${scriptId}:${questionNum}`;
}

export interface SaveAnnotationDraftOptions {
  userId?: string;
  serverUpdatedAt?: string | number | null;
  baseServerUpdatedAt?: string | number | null;
  synced?: boolean;
  savedAt?: number;
  superseded?: boolean;
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
  };

  const key = getAnnotationDraftKey(effectiveUserId, scriptId, pageNumber);
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
  pageNumber: number,
  userId?: string
): LocalAnnotationDraft | null {
  if (!scriptId || typeof pageNumber !== 'number') {
    return null;
  }

  const effectiveUserId = userId || currentDraftUserId;
  const key = getAnnotationDraftKey(effectiveUserId, scriptId, pageNumber);
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
    });
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
      synced: true,
      savedAt: existing.savedAt,
      superseded: true,
    });
  }
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
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }
  memoryStorage.delete(key);
}

/**
 * Clears all drafts for a script after successful final submit.
 * AE-170 requirement: Clear the relevant draft after successful submit.
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
 * Clears all page annotation and grading drafts for a specific script.
 */
export function clearAllScriptDrafts(scriptId: string, userId?: string): void {
  const effectiveUserId = userId || currentDraftUserId;
  const matches = (k: string) => {
    if (effectiveUserId) {
      return (
        k.startsWith(`${ANNOTATION_DRAFT_PREFIX}${effectiveUserId}:${scriptId}:`) ||
        k.startsWith(`${GRADING_DRAFT_PREFIX}${effectiveUserId}:${scriptId}:`)
      );
    }
    return (
      (k.startsWith(ANNOTATION_DRAFT_PREFIX) || k.startsWith(GRADING_DRAFT_PREFIX)) &&
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
  memKeysToRemove.forEach((k) => memoryStorage.delete(k));
}

/**
 * Clears all drafts belonging to a specific user on logout.
 * AE-170 requirement: Clear the user's drafts on logout.
 */
export function clearUserDrafts(userId?: string): void {
  const effectiveUserId = userId || currentDraftUserId;
  if (!effectiveUserId) return;
  const annotUserPrefix = `${ANNOTATION_DRAFT_PREFIX}${effectiveUserId}:`;
  const gradingUserPrefix = `${GRADING_DRAFT_PREFIX}${effectiveUserId}:`;

  if (isLocalStorageAvailable()) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && (k.startsWith(annotUserPrefix) || k.startsWith(gradingUserPrefix))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => window.localStorage.removeItem(k));
    } catch {}
  }

  const memKeysToRemove: string[] = [];
  memoryStorage.forEach((_, k) => {
    if (k.startsWith(annotUserPrefix) || k.startsWith(gradingUserPrefix)) {
      memKeysToRemove.push(k);
    }
  });
  memKeysToRemove.forEach((k) => memoryStorage.delete(k));
}

/**
 * Retrieves all pending (unsynced and not superseded) annotation drafts,
 * optionally filtered by script ID.
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

  const processRaw = (key: string, raw: string | null) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as LocalAnnotationDraft;
      if (
        parsed &&
        typeof parsed.scriptId === 'string' &&
        typeof parsed.pageNumber === 'number' &&
        !parsed.synced &&
        !parsed.superseded
      ) {
        if (!scriptId || parsed.scriptId === scriptId) {
          if (!effectiveUserId || parsed.userId === effectiveUserId) {
            draftsMap.set(key, parsed);
          }
        }
      }
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
    return Boolean(draft && !draft.synced && !draft.superseded);
  }
  const pending = getPendingAnnotationDrafts(scriptId, effectiveUserId);
  return pending.length > 0;
}

/**
 * Determines whether server data is strictly newer than the local draft savedAt timestamp.
 * Used during hydration to detect if the server copy supersedes the local draft.
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
