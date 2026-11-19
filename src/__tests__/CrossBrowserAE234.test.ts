import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  detectBrowserEngine,
  normalizePointerPressure,
  clampCanvasDimensions,
  getRecommendedCookieOptions,
  MAX_SAFE_CANVAS_PIXELS,
  MAX_SAFE_CANVAS_DIMENSION,
} from '../lib/browserCompatibility';

describe('AE-234: Cross-Browser Compatibility Matrix and Normalization', () => {
  const docsPath = path.join(process.cwd(), 'docs', 'CROSS_BROWSER.md');

  describe('Browser Engine and Tier Detection (detectBrowserEngine)', () => {
    it('should detect Google Chrome desktop as Tier 1 Chromium', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
      const result = detectBrowserEngine(ua, 0);

      expect(result.name).toBe('chrome');
      expect(result.engine).toBe('chromium');
      expect(result.isMobile).toBe(false);
      expect(result.tier).toBe(1);
    });

    it('should detect Microsoft Edge as Tier 1 Chromium', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.2365.92';
      const result = detectBrowserEngine(ua, 0);

      expect(result.name).toBe('edge');
      expect(result.engine).toBe('chromium');
      expect(result.tier).toBe(1);
    });

    it('should detect Mozilla Firefox desktop as Tier 1 Gecko', () => {
      const ua = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0';
      const result = detectBrowserEngine(ua, 0);

      expect(result.name).toBe('firefox');
      expect(result.engine).toBe('gecko');
      expect(result.tier).toBe(1);
    });

    it('should detect Safari macOS desktop as Tier 1 WebKit', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15';
      const result = detectBrowserEngine(ua, 0);

      expect(result.name).toBe('safari');
      expect(result.engine).toBe('webkit');
      expect(result.isIPadOS).toBe(false);
      expect(result.tier).toBe(1);
    });

    it('should detect Safari on iPadOS (with touch capability) as Tier 1 WebKit stylus device', () => {
      // iPadOS 13+ reports Macintosh user agent by default
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
      const result = detectBrowserEngine(ua, 5); // maxTouchPoints = 5 indicates touch hardware (iPad)

      expect(result.name).toBe('safari');
      expect(result.engine).toBe('webkit');
      expect(result.isIPadOS).toBe(true);
      expect(result.isMobile).toBe(true);
      expect(result.tier).toBe(1);
    });

    it('should detect Chrome on Android as Tier 2 mobile', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.105 Mobile Safari/537.36';
      const result = detectBrowserEngine(ua, 5);

      expect(result.name).toBe('chrome');
      expect(result.engine).toBe('chromium');
      expect(result.isMobile).toBe(true);
      expect(result.tier).toBe(2);
    });

    it('should classify unknown legacy browsers as Tier 3', () => {
      const ua = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)';
      const result = detectBrowserEngine(ua, 0);

      expect(result.name).toBe('unknown');
      expect(result.tier).toBe(3);
    });
  });

  describe('PointerEvent Pressure Normalization (normalizePointerPressure)', () => {
    it('should preserve calibrated stylus pen pressure', () => {
      const event = { pointerType: 'pen', pressure: 0.65 };
      const normalized = normalizePointerPressure(event);

      expect(normalized.pointerType).toBe('pen');
      expect(normalized.pressure).toBe(0.65);
      expect(normalized.hasPressureSupport).toBe(true);
    });

    it('should mitigate WebKit zero-pressure stylus bug with default calibrated pressure', () => {
      const event = { pointerType: 'pen', pressure: 0.0 };
      const normalized = normalizePointerPressure(event);

      expect(normalized.pointerType).toBe('pen');
      expect(normalized.pressure).toBe(0.5);
      expect(normalized.hasPressureSupport).toBe(false);
    });

    it('should normalize standard touch events to 0.5 fallback pressure', () => {
      const event = { pointerType: 'touch', pressure: 0 };
      const normalized = normalizePointerPressure(event);

      expect(normalized.pointerType).toBe('touch');
      expect(normalized.pressure).toBe(0.5);
    });

    it('should normalize mouse active click to 0.5 and release to 0.0', () => {
      const down = normalizePointerPressure({ pointerType: 'mouse', pressure: 0.5 });
      const up = normalizePointerPressure({ pointerType: 'mouse', pressure: 0.0 });

      expect(down.pointerType).toBe('mouse');
      expect(down.pressure).toBe(0.5);
      expect(up.pressure).toBe(0.0);
    });
  });

  describe('Canvas Dimension Clamping (clampCanvasDimensions)', () => {
    it('should preserve standard dimensions within GPU memory budget', () => {
      const clamped = clampCanvasDimensions(1200, 1600, 2.0);

      expect(clamped.width).toBe(2400);
      expect(clamped.height).toBe(3200);
      expect(clamped.dpr).toBe(2.0);
      expect(clamped.totalPixels).toBeLessThanOrEqual(MAX_SAFE_CANVAS_PIXELS);
    });

    it('should reduce devicePixelRatio when high-DPI exceeds pixel threshold', () => {
      // 3000 x 4000 at 2x DPR = 6000 x 8000 = 48M pixels (> 16.7M limit)
      const clamped = clampCanvasDimensions(3000, 4000, 2.0);

      // DPR reduced to 1.0 (3000 x 4000 = 12M pixels)
      expect(clamped.dpr).toBe(1.0);
      expect(clamped.totalPixels).toBeLessThanOrEqual(MAX_SAFE_CANVAS_PIXELS);
      expect(clamped.width).toBeLessThanOrEqual(MAX_SAFE_CANVAS_DIMENSION);
      expect(clamped.height).toBeLessThanOrEqual(MAX_SAFE_CANVAS_DIMENSION);
    });

    it('should proportionally downscale oversized single dimensions exceeding 4096px', () => {
      const clamped = clampCanvasDimensions(5000, 2500, 1.0);

      expect(clamped.width).toBeLessThanOrEqual(MAX_SAFE_CANVAS_DIMENSION);
      expect(clamped.height).toBeLessThanOrEqual(MAX_SAFE_CANVAS_DIMENSION);
      expect(clamped.totalPixels).toBeLessThanOrEqual(MAX_SAFE_CANVAS_PIXELS);
    });
  });

  describe('Session Cookie Cross-Site Options (getRecommendedCookieOptions)', () => {
    it('should configure SameSite=Lax and HttpOnly across environments', () => {
      const prodOpts = getRecommendedCookieOptions(true);
      expect(prodOpts.httpOnly).toBe(true);
      expect(prodOpts.sameSite).toBe('lax');
      expect(prodOpts.secure).toBe(true);

      const devOpts = getRecommendedCookieOptions(false);
      expect(devOpts.secure).toBe(false);
      expect(devOpts.sameSite).toBe('lax');
    });
  });

  describe('Cross-Browser Documentation (docs/CROSS_BROWSER.md)', () => {
    it('should document browser tiers, engine quirks, and normalization solutions', () => {
      expect(fs.existsSync(docsPath)).toBe(true);
      const content = fs.readFileSync(docsPath, 'utf8');

      expect(content).toContain('Tier 1');
      expect(content).toContain('Tier 2');
      expect(content).toContain('Tier 3');
      expect(content).toContain('WebKit');
      expect(content).toContain('Gecko');
      expect(content).toContain('Chromium');
      expect(content).toContain('normalizePointerPressure');
      expect(content).toContain('clampCanvasDimensions');
      expect(content).toContain('SameSite=Lax');
    });
  });
});
