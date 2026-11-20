export type FeatureFlag = 'CLASSROOM_ASSESSMENT' | 'PERSONALIZED_ASSESSMENT';

export const FEATURE_FLAGS: Record<FeatureFlag, FeatureFlag> = {
  CLASSROOM_ASSESSMENT: 'CLASSROOM_ASSESSMENT',
  PERSONALIZED_ASSESSMENT: 'PERSONALIZED_ASSESSMENT',
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
 * Checks whether a research feature flag is enabled.
 * Defaults to false (disabled) unless explicitly enabled via environment variables:
 * - FEATURE_<FLAG_NAME>
 * - NEXT_PUBLIC_FEATURE_<FLAG_NAME>
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (flag === 'CLASSROOM_ASSESSMENT') {
    return (
      parseBooleanFlag(process.env.FEATURE_CLASSROOM_ASSESSMENT) ||
      parseBooleanFlag(process.env.NEXT_PUBLIC_FEATURE_CLASSROOM_ASSESSMENT)
    );
  }

  if (flag === 'PERSONALIZED_ASSESSMENT') {
    return (
      parseBooleanFlag(process.env.FEATURE_PERSONALIZED_ASSESSMENT) ||
      parseBooleanFlag(process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT)
    );
  }

  return false;
}

/**
 * Returns a dictionary containing the current resolution for all feature flags.
 */
export function getFeatureFlags(): Record<FeatureFlag, boolean> {
  return {
    CLASSROOM_ASSESSMENT: isFeatureEnabled('CLASSROOM_ASSESSMENT'),
    PERSONALIZED_ASSESSMENT: isFeatureEnabled('PERSONALIZED_ASSESSMENT'),
  };
}
