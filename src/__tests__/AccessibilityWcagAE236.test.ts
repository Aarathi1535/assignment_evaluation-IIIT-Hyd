import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  hexToRgb,
  getRelativeLuminance,
  getContrastRatio,
  evaluateWcagCompliance,
  formatLiveRegionAnnouncement,
  validateKeyboardShortcut,
} from '../lib/accessibilityStandards';

describe('AE-236: Accessibility Standards and WCAG 2.1 AA Verification', () => {
  const docsPath = path.join(process.cwd(), 'docs', 'ACCESSIBILITY_WCAG.md');

  describe('Color Math and Relative Luminance (W3C Formula)', () => {
    it('should correctly parse 3-digit and 6-digit hex colors into RGB channels', () => {
      expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
      expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
      expect(hexToRgb('#2563EB')).toEqual([37, 99, 235]);
      expect(() => hexToRgb('invalid')).toThrow('Invalid hex color format');
    });

    it('should compute relative luminance for reference colors', () => {
      expect(getRelativeLuminance('#FFFFFF')).toBeCloseTo(1.0, 3);
      expect(getRelativeLuminance('#000000')).toBeCloseTo(0.0, 3);

      const midGrayLum = getRelativeLuminance('#777777');
      expect(midGrayLum).toBeGreaterThan(0.0);
      expect(midGrayLum).toBeLessThan(1.0);
    });

    it('should compute contrast ratios adhering to the 1:1 to 21:1 boundaries', () => {
      // Pure black and white is the theoretical maximum (21:1)
      const maxContrast = getContrastRatio('#000000', '#FFFFFF');
      expect(maxContrast).toBe(21);

      // Identical colors have 1:1 contrast
      const minContrast = getContrastRatio('#FFFFFF', '#FFFFFF');
      expect(minContrast).toBe(1);

      // Order of colors should not affect contrast ratio
      expect(getContrastRatio('#FFFFFF', '#2563EB')).toBe(getContrastRatio('#2563EB', '#FFFFFF'));
    });
  });

  describe('WCAG 2.1 Compliance Evaluation for Platform Color Palette', () => {
    it('should verify body primary text (#111827 on #FFFFFF) passes WCAG AAA', () => {
      const evaluation = evaluateWcagCompliance('#111827', '#FFFFFF');

      expect(evaluation.ratio).toBeGreaterThanOrEqual(15.0);
      expect(evaluation.passesAA).toBe(true);
      expect(evaluation.passesAAA).toBe(true);
    });

    it('should verify primary action button (#FFFFFF on #2563EB) passes WCAG AA', () => {
      const evaluation = evaluateWcagCompliance('#FFFFFF', '#2563EB');

      expect(evaluation.ratio).toBeGreaterThanOrEqual(4.5);
      expect(evaluation.passesAA).toBe(true);
    });

    it('should verify danger action button (#FFFFFF on #DC2626) passes WCAG AA', () => {
      const evaluation = evaluateWcagCompliance('#FFFFFF', '#DC2626');

      expect(evaluation.ratio).toBeGreaterThanOrEqual(4.5);
      expect(evaluation.passesAA).toBe(true);
    });

    it('should verify UI border (#767676 on #FFFFFF) passes UI component threshold (3.0:1) while low-contrast gray fails normal text', () => {
      const uiCompEval = evaluateWcagCompliance('#767676', '#FFFFFF', { isUiComponent: true });
      expect(uiCompEval.passesAA).toBe(true);
      expect(uiCompEval.ratio).toBeGreaterThanOrEqual(3.0);

      const textEval = evaluateWcagCompliance('#9CA3AF', '#FFFFFF', { isUiComponent: false });
      expect(textEval.passesAA).toBe(false);
    });
  });

  describe('Screen Reader ARIA Live Region Helper', () => {
    it('should construct polite ARIA live region attributes for non-blocking notifications', () => {
      const live = formatLiveRegionAnnouncement('Question 2 marks saved', 'polite');

      expect(live['aria-live']).toBe('polite');
      expect(live.role).toBe('status');
      expect(live['aria-atomic']).toBe('true');
      expect(live.textContent).toBe('Question 2 marks saved');
    });

    it('should construct assertive ARIA live region attributes for critical alerts', () => {
      const alert = formatLiveRegionAnnouncement('Network connection lost', 'assertive');

      expect(alert['aria-live']).toBe('assertive');
      expect(alert.role).toBe('alert');
      expect(alert.textContent).toBe('Network connection lost');
    });
  });

  describe('Keyboard Navigation Shortcut Guards', () => {
    it('should approve valid distinct keyboard shortcuts', () => {
      const result = validateKeyboardShortcut('ctrl+s', ['ctrl+p', 'ctrl+e']);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject shortcuts that collide with existing bindings', () => {
      const result = validateKeyboardShortcut('ctrl+p', ['ctrl+p', 'ctrl+e']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('already registered');
    });

    it('should reject shortcuts that intercept native browser operations (e.g. F5, Ctrl+W)', () => {
      const f5Result = validateKeyboardShortcut('f5', []);
      expect(f5Result.valid).toBe(false);
      expect(f5Result.error).toContain('intercepts native browser navigation');

      const closeTabResult = validateKeyboardShortcut('ctrl+w', []);
      expect(closeTabResult.valid).toBe(false);
    });
  });

  describe('Accessibility Documentation (docs/ACCESSIBILITY_WCAG.md)', () => {
    it('should document WCAG 2.1 AA principles, contrast ratios, and keyboard navigation', () => {
      expect(fs.existsSync(docsPath)).toBe(true);
      const content = fs.readFileSync(docsPath, 'utf8');

      expect(content).toContain('Perceivable');
      expect(content).toContain('Operable');
      expect(content).toContain('Understandable');
      expect(content).toContain('Robust');
      expect(content).toContain('15.34 : 1');
      expect(content).toContain('4.56 : 1');
      expect(content).toContain('VoiceOver');
      expect(content).toContain('NVDA');
      expect(content).toContain('JAWS');
      expect(content).toContain('Skip to main content');
    });
  });
});
