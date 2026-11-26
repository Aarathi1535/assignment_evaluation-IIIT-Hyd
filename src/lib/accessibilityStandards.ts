/**
 * Accessibility & WCAG 2.1 AA/AAA Compliance Utilities (AE-236)
 * Implements W3C Relative Luminance calculation, contrast ratio validation,
 * ARIA live region helpers, and keyboard accessibility guards.
 */

export interface ContrastEvaluation {
  ratio: number;
  passesAA: boolean;
  passesAAA: boolean;
  requiredRatioAA: number;
  requiredRatioAAA: number;
}

/**
 * Converts a 3-char or 6-char hex color to RGB channels [0..255].
 */
export function hexToRgb(hex: string): [number, number, number] {
  const cleanHex = hex.replace('#', '').trim();
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return [r, g, b];
  }
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.slice(0, 2), 16);
    const g = parseInt(cleanHex.slice(2, 4), 16);
    const b = parseInt(cleanHex.slice(4, 6), 16);
    return [r, g, b];
  }
  throw new Error(`Invalid hex color format: ${hex}`);
}

/**
 * Computes W3C relative luminance from sRGB channels.
 * Formula: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function getRelativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((val) => {
    const sRGB = val / 255;
    return sRGB <= 0.04045 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Computes contrast ratio between two hex colors according to W3C formula:
 * (L1 + 0.05) / (L2 + 0.05) where L1 is lighter than L2.
 * Range: 1:1 (identical) to 21:1 (pure black on pure white).
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1);
  const lum2 = getRelativeLuminance(hex2);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

/**
 * Evaluates contrast compliance for normal text, large text, or UI components.
 */
export function evaluateWcagCompliance(
  foregroundHex: string,
  backgroundHex: string,
  options: { isLargeText?: boolean; isUiComponent?: boolean } = {}
): ContrastEvaluation {
  const ratio = getContrastRatio(foregroundHex, backgroundHex);

  let requiredRatioAA: number;
  let requiredRatioAAA: number;

  if (options.isUiComponent) {
    requiredRatioAA = 3.0;
    requiredRatioAAA = 4.5;
  } else if (options.isLargeText) {
    // 18pt regular or 14pt bold
    requiredRatioAA = 3.0;
    requiredRatioAAA = 4.5;
  } else {
    // Standard body text
    requiredRatioAA = 4.5;
    requiredRatioAAA = 7.0;
  }

  return {
    ratio,
    passesAA: ratio >= requiredRatioAA,
    passesAAA: ratio >= requiredRatioAAA,
    requiredRatioAA,
    requiredRatioAAA,
  };
}

/**
 * Constructs ARIA live region announcement attributes.
 */
export function formatLiveRegionAnnouncement(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): {
  'aria-live': 'polite' | 'assertive';
  role: 'status' | 'alert';
  'aria-atomic': 'true';
  textContent: string;
} {
  return {
    'aria-live': priority,
    role: priority === 'assertive' ? 'alert' : 'status',
    'aria-atomic': 'true',
    textContent: message.trim(),
  };
}

/**
 * Validates a keyboard shortcut against existing bindings to prevent key collisions.
 */
export function validateKeyboardShortcut(
  candidateKey: string,
  registeredShortcuts: string[]
): { valid: boolean; error?: string } {
  const normalizedCandidate = candidateKey.toLowerCase().trim();

  // Guard against single-key browser system collisions
  const prohibitedKeys = ['f5', 'ctrl+r', 'ctrl+w', 'ctrl+t', 'ctrl+n', 'alt+f4'];
  if (prohibitedKeys.includes(normalizedCandidate)) {
    return {
      valid: false,
      error: `Shortcut '${candidateKey}' intercepts native browser navigation or tab closing`,
    };
  }

  const normalizedExisting = registeredShortcuts.map((s) => s.toLowerCase().trim());
  if (normalizedExisting.includes(normalizedCandidate)) {
    return {
      valid: false,
      error: `Shortcut collision: '${candidateKey}' is already registered by another action`,
    };
  }

  return { valid: true };
}
