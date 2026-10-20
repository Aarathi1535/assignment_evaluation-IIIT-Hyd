import { isLearningModuleServerEnabled, isLearningModulePublicEnabled } from './env';

export type FeatureFlag = 'LEARNING_MODULE';

export const FEATURE_FLAGS: Record<FeatureFlag, FeatureFlag> = {
  LEARNING_MODULE: 'LEARNING_MODULE',
};

/**
 * Standardized boolean flag parsing matching STUDENT_RESULTS_ENABLED in env.ts.
 * Only the exact string value 'true' enables the flag.
 * Values '1', 'yes', 'on', 'false', and undefined/null do not enable it.
 */
export function parseBooleanFlag(val: string | undefined | null): boolean {
  return val === 'true';
}

/**
 * Server authorization check.
 * Strictly reads only server environment variables (e.g. FEATURE_LEARNING_MODULE).
 * The public flag NEVER enables server access.
 * If unset or not exactly 'true', the feature remains disabled.
 */
export function isServerFeatureEnabled(flag: FeatureFlag): boolean {
  if (flag === 'LEARNING_MODULE') {
    return isLearningModuleServerEnabled();
  }
  return false;
}

/**
 * Public navigation visibility check.
 * Strictly reads only client/public environment variables (e.g. NEXT_PUBLIC_FEATURE_LEARNING_MODULE).
 * If unset or not exactly 'true', navigation remains hidden.
 */
export function isPublicFeatureEnabled(flag: FeatureFlag): boolean {
  if (flag === 'LEARNING_MODULE') {
    return isLearningModulePublicEnabled();
  }
  return false;
}

/**
 * Authoritative server feature check (default for server-side evaluation).
 * Preserves existing isFeatureEnabled() contract for server code like requireFeature().
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return isServerFeatureEnabled(flag);
}

/**
 * Server-side convenience helper for LEARNING_MODULE.
 * Integrates directly with isServerFeatureEnabled without duplicated logic.
 */
export function isLearningModuleEnabled(): boolean {
  return isLearningModuleServerEnabled();
}

/**
 * Returns a dictionary containing the current server resolution for all feature flags.
 */
export function getFeatureFlags(): Record<FeatureFlag, boolean> {
  return {
    LEARNING_MODULE: isServerFeatureEnabled('LEARNING_MODULE'),
  };
}
