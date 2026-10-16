export type FeatureFlag = 'LEARNING_MODULE';

export const FEATURE_FLAGS: Record<FeatureFlag, FeatureFlag> = {
  LEARNING_MODULE: 'LEARNING_MODULE',
};

/**
 * Normalizes boolean flag string values.
 * Returns true only for 'true', '1', 'yes', 'on' (case-insensitive).
 */
export function parseBooleanFlag(val: string | undefined | null): boolean {
  if (!val) return false;
  const normalized = val.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * Checks whether a feature flag is enabled.
 * Defaults to false (disabled) when unset or false.
 * Supports consistent server and browser evaluation:
 * - FEATURE_<FLAG_NAME>
 * - NEXT_PUBLIC_FEATURE_<FLAG_NAME>
 * - <FLAG_NAME>
 * - NEXT_PUBLIC_<FLAG_NAME>
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (flag === 'LEARNING_MODULE') {
    return (
      parseBooleanFlag(process.env.FEATURE_LEARNING_MODULE) ||
      parseBooleanFlag(process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE) ||
      parseBooleanFlag(process.env.LEARNING_MODULE) ||
      parseBooleanFlag(process.env.NEXT_PUBLIC_LEARNING_MODULE)
    );
  }

  return false;
}

/**
 * Convenience helper for checking the LEARNING_MODULE flag status.
 */
export function isLearningModuleEnabled(): boolean {
  return isFeatureEnabled('LEARNING_MODULE');
}

/**
 * Returns a dictionary containing the current resolution for all feature flags.
 */
export function getFeatureFlags(): Record<FeatureFlag, boolean> {
  return {
    LEARNING_MODULE: isFeatureEnabled('LEARNING_MODULE'),
  };
}
