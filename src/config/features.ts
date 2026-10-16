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
 * - FEATURE_<FLAG_NAME> (server authorization gate)
 * - NEXT_PUBLIC_FEATURE_<FLAG_NAME> (client navigation display flag)
 *
 * If conflicting values are configured (e.g. one true and one false),
 * the feature remains disabled to prevent unintended exposure.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (flag === 'LEARNING_MODULE') {
    const serverVal = process.env.FEATURE_LEARNING_MODULE;
    const clientVal = process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE;

    const hasServer = serverVal !== undefined && serverVal !== null && serverVal.trim() !== '';
    const hasClient = clientVal !== undefined && clientVal !== null && clientVal.trim() !== '';

    if (!hasServer && !hasClient) {
      return false;
    }

    if (hasServer && !hasClient) {
      return parseBooleanFlag(serverVal);
    }

    if (!hasServer && hasClient) {
      return parseBooleanFlag(clientVal);
    }

    // Both are configured: both must be true; conflicting values cannot unexpectedly enable
    return parseBooleanFlag(serverVal) && parseBooleanFlag(clientVal);
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
