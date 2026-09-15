import { describe, it, expect } from 'vitest';
import { calculateImageFitBounds } from '../lib/annotations';
import DerivedStorageService from '../services/DerivedStorageService';

describe('AE-123: Answer-Sheet Page Image Fit & Scale', () => {
  describe('1. Aspect Ratio Preservation (No Distortion)', () => {
    it('preserves aspect ratio for standard A4 scan (2479 x 3508) in 1920x1080 widescreen viewport', () => {
      const naturalW = 2479;
      const naturalH = 3508;
      const containerW = 1920;
      const containerH = 1080;

      const bounds = calculateImageFitBounds(containerW, containerH, naturalW, naturalH, 'contain');

      // Container is wider (ratio 1.777) than portrait A4 (ratio 0.706)
      // Height should fit exactly to container height (1080)
      expect(bounds.height).toBe(1080);
      expect(bounds.width).toBeCloseTo(1080 * (naturalW / naturalH), 2);
      expect(bounds.y).toBe(0);
      expect(bounds.x).toBe((containerW - bounds.width) / 2);
      expect(bounds.x).toBeGreaterThan(0);

      // Verify aspect ratio strictly preserved
      const naturalRatio = naturalW / naturalH;
      const renderedRatio = bounds.width / bounds.height;
      expect(renderedRatio).toBeCloseTo(naturalRatio, 5);
    });

    it('preserves aspect ratio for US Letter scan (2550 x 3300) in 768x1024 tablet portrait viewport', () => {
      const naturalW = 2550;
      const naturalH = 3300;
      const containerW = 768;
      const containerH = 1024;

      const bounds = calculateImageFitBounds(containerW, containerH, naturalW, naturalH, 'contain');

      // Image ratio: 2550/3300 = 0.7727
      // Container ratio: 768/1024 = 0.75
      // Image is slightly wider than container -> Width should fit container (768)
      expect(bounds.width).toBe(768);
      expect(bounds.height).toBeCloseTo(768 / (naturalW / naturalH), 2);
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBeCloseTo((containerH - bounds.height) / 2, 2);
      expect(bounds.y).toBeGreaterThan(0);

      // Verify aspect ratio strictly preserved
      const naturalRatio = naturalW / naturalH;
      const renderedRatio = bounds.width / bounds.height;
      expect(renderedRatio).toBeCloseTo(naturalRatio, 5);
    });

    it('preserves aspect ratio for landscape exam attachment (1920 x 1080) in square container (800x800)', () => {
      const naturalW = 1920;
      const naturalH = 1080;
      const containerW = 800;
      const containerH = 800;

      const bounds = calculateImageFitBounds(containerW, containerH, naturalW, naturalH, 'contain');

      expect(bounds.width).toBe(800);
      expect(bounds.height).toBeCloseTo(800 / (1920 / 1080), 2); // 450
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe((800 - 450) / 2); // 175

      const naturalRatio = naturalW / naturalH;
      const renderedRatio = bounds.width / bounds.height;
      expect(renderedRatio).toBeCloseTo(naturalRatio, 5);
    });

    it('preserves aspect ratio for square answer-sheet section (1200 x 1200) in 1600x900 viewport', () => {
      const naturalW = 1200;
      const naturalH = 1200;
      const containerW = 1600;
      const containerH = 900;

      const bounds = calculateImageFitBounds(containerW, containerH, naturalW, naturalH, 'contain');

      expect(bounds.height).toBe(900);
      expect(bounds.width).toBe(900);
      expect(bounds.x).toBe((1600 - 900) / 2); // 350
      expect(bounds.y).toBe(0);

      expect(bounds.width / bounds.height).toBe(1);
    });
  });

  describe('2. Viewport Containment & Centering Invariants', () => {
    const testCases = [
      { name: 'Desktop Full HD', cW: 1920, cH: 1080, imgW: 1654, imgH: 2339 },
      { name: 'Laptop WXGA', cW: 1366, cH: 768, imgW: 1654, imgH: 2339 },
      { name: 'Tablet Portrait', cW: 768, cH: 1024, imgW: 1654, imgH: 2339 },
      { name: 'Mobile Narrow', cW: 375, cH: 667, imgW: 1654, imgH: 2339 },
      { name: 'Narrow Sidebar Split', cW: 400, cH: 800, imgW: 2400, imgH: 1200 },
      { name: 'Ultra-wide Monitor', cW: 3440, cH: 1440, imgW: 1654, imgH: 2339 },
    ];

    testCases.forEach(({ name, cW, cH, imgW, imgH }) => {
      it(`satisfies contain bounding box and centering rules for ${name}`, () => {
        const bounds = calculateImageFitBounds(cW, cH, imgW, imgH, 'contain');

        // Rule 1: Never exceeds container dimensions
        expect(bounds.width).toBeLessThanOrEqual(cW + 0.001);
        expect(bounds.height).toBeLessThanOrEqual(cH + 0.001);

        // Rule 2: At least one dimension touches container boundary in contain mode
        const touchesWidth = Math.abs(bounds.width - cW) < 0.01;
        const touchesHeight = Math.abs(bounds.height - cH) < 0.01;
        expect(touchesWidth || touchesHeight).toBe(true);

        // Rule 3: Centered within container
        expect(bounds.x).toBeCloseTo((cW - bounds.width) / 2, 2);
        expect(bounds.y).toBeCloseTo((cH - bounds.height) / 2, 2);

        // Rule 4: Aspect ratio matched
        expect(bounds.width / bounds.height).toBeCloseTo(imgW / imgH, 4);
      });
    });
  });

  describe('3. Dynamic Resizing Recalculation', () => {
    it('updates bounds smoothly when viewport resizes from 800x600 to 1200x900', () => {
      const imgW = 1600;
      const imgH = 2400; // 2:3 ratio

      const initialBounds = calculateImageFitBounds(800, 600, imgW, imgH, 'contain');
      expect(initialBounds.height).toBe(600);
      expect(initialBounds.width).toBe(400); // 600 * (2/3)
      expect(initialBounds.x).toBe(200);
      expect(initialBounds.y).toBe(0);

      // Simulate container resize (e.g. browser maximize or panel expand)
      const resizedBounds = calculateImageFitBounds(1200, 900, imgW, imgH, 'contain');
      expect(resizedBounds.height).toBe(900);
      expect(resizedBounds.width).toBe(600); // 900 * (2/3)
      expect(resizedBounds.x).toBe(300);
      expect(resizedBounds.y).toBe(0);

      // Verify scale increased by 1.5x
      expect(resizedBounds.scale / initialBounds.scale).toBeCloseTo(1.5, 4);
    });
  });

  describe('4. Safe Handling of Degenerate Dimensions', () => {
    it('returns zero bounds when container width or height is zero', () => {
      expect(calculateImageFitBounds(0, 500, 800, 600)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        scale: 1,
      });

      expect(calculateImageFitBounds(500, 0, 800, 600)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        scale: 1,
      });
    });

    it('returns zero bounds when natural image width or height is zero or negative', () => {
      expect(calculateImageFitBounds(800, 600, 0, 1000)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        scale: 1,
      });

      expect(calculateImageFitBounds(800, 600, -100, 1000)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        scale: 1,
      });
    });
  });

  describe('5. Derived Storage Keying & Asset Resolution', () => {
    it('computes deterministic full-resolution page image keys', () => {
      const key = DerivedStorageService.getDerivedPageKey('batch-123', 'file-456', 1, 'png');
      expect(key).toBe('batches/batch-123/derived/file-456/1/page.png');
    });

    it('resolves correct disk path for page assets', () => {
      const key = 'batches/batch-123/derived/file-456/2/page.png';
      const diskPath = DerivedStorageService.getDerivedDiskPath(key);
      expect(diskPath).toContain('batch-123');
      expect(diskPath).toContain('file-456');
      expect(diskPath).toContain('page.png');
    });
  });
});
