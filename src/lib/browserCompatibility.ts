/**
 * Browser Engine and Compatibility Utility (AE-234)
 * Provides engine detection, PointerEvent normalization, and Canvas dimension clamping
 * across Chromium, Gecko, and WebKit rendering engines.
 */

export type BrowserEngine = 'chromium' | 'gecko' | 'webkit' | 'unknown';
export type BrowserName = 'chrome' | 'edge' | 'firefox' | 'safari' | 'unknown';
export type BrowserTier = 1 | 2 | 3;

export interface BrowserDetectionResult {
  name: BrowserName;
  engine: BrowserEngine;
  isMobile: boolean;
  isIPadOS: boolean;
  tier: BrowserTier;
}

export interface NormalizedPointerEvent {
  pointerType: 'mouse' | 'pen' | 'touch';
  pressure: number;
  hasPressureSupport: boolean;
}

/**
 * Detects browser engine, name, and support tier from User-Agent and environment hints.
 */
export function detectBrowserEngine(
  userAgent: string,
  maxTouchPoints = 0
): BrowserDetectionResult {
  const ua = userAgent.toLowerCase();

  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
  const isIPadOS =
    /ipad/i.test(ua) || (/macintosh/i.test(ua) && maxTouchPoints > 1);

  let name: BrowserName = 'unknown';
  let engine: BrowserEngine = 'unknown';
  let tier: BrowserTier = 3;

  if (ua.includes('edg/')) {
    name = 'edge';
    engine = 'chromium';
    tier = 1;
  } else if (ua.includes('chrome/') && !ua.includes('edg/')) {
    name = 'chrome';
    engine = 'chromium';
    tier = isMobile ? 2 : 1;
  } else if (ua.includes('firefox/') || ua.includes('fxios/')) {
    name = 'firefox';
    engine = 'gecko';
    tier = 1;
  } else if (ua.includes('safari/') && !ua.includes('chrome/')) {
    name = 'safari';
    engine = 'webkit';
    tier = isIPadOS ? 1 : isMobile ? 2 : 1;
  }

  // Legacy or unparseable browsers fall back to tier 3
  if (engine === 'unknown') {
    tier = 3;
  }

  return {
    name,
    engine,
    isMobile: isMobile || isIPadOS,
    isIPadOS,
    tier,
  };
}

/**
 * Normalizes PointerEvent pressure across browser engines.
 * WebKit often emits pressure = 0 on initial stylus touch or fallback mouse clicks.
 */
export function normalizePointerPressure(event: {
  pointerType?: string;
  pressure?: number;
}): NormalizedPointerEvent {
  const rawType = (event.pointerType || 'mouse').toLowerCase();
  const pointerType: 'mouse' | 'pen' | 'touch' =
    rawType === 'pen' ? 'pen' : rawType === 'touch' ? 'touch' : 'mouse';

  const rawPressure = typeof event.pressure === 'number' ? event.pressure : 0;
  const hasPressureSupport = pointerType === 'pen' && rawPressure > 0 && rawPressure < 1;

  let pressure: number;
  if (pointerType === 'pen') {
    // Stylus pressure normalization: clamp to [0.1, 1.0] if pressure is zero or uncalibrated
    pressure = rawPressure > 0 ? Math.min(Math.max(rawPressure, 0.05), 1.0) : 0.5;
  } else if (pointerType === 'touch') {
    // Standard touch typically lacks pressure: default to 0.5
    pressure = rawPressure > 0 ? rawPressure : 0.5;
  } else {
    // Mouse buttons report 0.5 when down, 0 when up
    pressure = rawPressure > 0 ? 0.5 : 0.0;
  }

  return {
    pointerType,
    pressure,
    hasPressureSupport,
  };
}

/**
 * Maximum safe canvas dimensions to prevent WebKit / mobile GPU memory crashes.
 * Safari iOS limits total canvas memory to 16,777,216 pixels (4096 x 4096).
 */
export const MAX_SAFE_CANVAS_PIXELS = 16_777_216;
export const MAX_SAFE_CANVAS_DIMENSION = 4096;

export function clampCanvasDimensions(
  width: number,
  height: number,
  dpr = 1.0
): { width: number; height: number; dpr: number; totalPixels: number } {
  let effectiveDpr = Math.max(dpr, 1.0);
  let scaledW = Math.round(width * effectiveDpr);
  let scaledH = Math.round(height * effectiveDpr);

  let totalPixels = scaledW * scaledH;

  // If pixel budget is exceeded, reduce devicePixelRatio first
  if (totalPixels > MAX_SAFE_CANVAS_PIXELS && effectiveDpr > 1.0) {
    effectiveDpr = 1.0;
    scaledW = Math.round(width * effectiveDpr);
    scaledH = Math.round(height * effectiveDpr);
    totalPixels = scaledW * scaledH;
  }

  // If still exceeding or single dimension exceeds 4096, downscale proportionally
  if (scaledW > MAX_SAFE_CANVAS_DIMENSION || scaledH > MAX_SAFE_CANVAS_DIMENSION || totalPixels > MAX_SAFE_CANVAS_PIXELS) {
    const scaleFactor = Math.min(
      MAX_SAFE_CANVAS_DIMENSION / scaledW,
      MAX_SAFE_CANVAS_DIMENSION / scaledH,
      Math.sqrt(MAX_SAFE_CANVAS_PIXELS / totalPixels)
    );
    scaledW = Math.floor(scaledW * scaleFactor);
    scaledH = Math.floor(scaledH * scaleFactor);
    totalPixels = scaledW * scaledH;
  }

  return {
    width: scaledW,
    height: scaledH,
    dpr: effectiveDpr,
    totalPixels,
  };
}

/**
 * Returns cross-browser standard cookie configuration attributes.
 */
export function getRecommendedCookieOptions(isSecure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isSecure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  };
}
