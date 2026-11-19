import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  profileDeviceCapabilities,
  RasterMemoryCacheManager,
  isAnnotationInViewport,
  shouldSampleStrokePoint,
} from '../lib/lowCostTabletOptimizer';

describe('AE-237: Low-Cost Tablet Performance Profiling and Optimization', () => {
  const docsPath = path.join(process.cwd(), 'docs', 'LOW_COST_TABLET_PERF.md');

  describe('Hardware Capability Profiling (profileDeviceCapabilities)', () => {
    it('should classify budget devices (<= 4GB RAM or <= 4 cores) as constrained', () => {
      const budgetTablet = profileDeviceCapabilities(3, 4, true);

      expect(budgetTablet.tier).toBe('constrained');
      expect(budgetTablet.maxCacheMemoryMb).toBe(150);
      expect(budgetTablet.maxDpr).toBe(1.25);
      expect(budgetTablet.enableTileCulling).toBe(true);
      expect(budgetTablet.strokeThrottleMs).toBe(12);
    });

    it('should classify mid-range tablets as medium profile', () => {
      const midTablet = profileDeviceCapabilities(6, 6, true);

      expect(midTablet.tier).toBe('medium');
      expect(midTablet.maxCacheMemoryMb).toBe(400);
      expect(midTablet.maxDpr).toBe(1.75);
      expect(midTablet.strokeThrottleMs).toBe(6);
    });

    it('should classify high-end devices as high profile with unthrottled strokes', () => {
      const highTablet = profileDeviceCapabilities(16, 8, false);

      expect(highTablet.tier).toBe('high');
      expect(highTablet.maxCacheMemoryMb).toBe(1024);
      expect(highTablet.strokeThrottleMs).toBe(0);
      expect(highTablet.enableTileCulling).toBe(false);
    });
  });

  describe('Raster Memory Cache Manager (Deterministic LRU Eviction)', () => {
    it('should maintain cache within 150MB budget by evicting oldest pages', () => {
      const cache = new RasterMemoryCacheManager(150); // 150MB max budget
      const thirtyMb = 30 * 1024 * 1024; // 30MB in bytes

      // Add 4 pages (4 * 30MB = 120MB <= 150MB)
      cache.setPageTexture('page-1', thirtyMb);
      cache.setPageTexture('page-2', thirtyMb);
      cache.setPageTexture('page-3', thirtyMb);
      cache.setPageTexture('page-4', thirtyMb);

      expect(cache.getCachedPageCount()).toBe(4);
      expect(cache.getCurrentMemoryMb()).toBeCloseTo(120, 1);
      expect(cache.has('page-1')).toBe(true);

      // Access page-1 to refresh its LRU recency
      cache.getPageTexture('page-1');

      // Add 5th page of 35MB (120 + 35 = 155MB > 150MB -> must evict oldest unaccessed, which is page-2!)
      const thirtyFiveMb = 35 * 1024 * 1024;
      cache.setPageTexture('page-5', thirtyFiveMb);

      // Page-2 should have been evicted; Page-1, 3, 4, 5 should remain
      expect(cache.has('page-2')).toBe(false);
      expect(cache.has('page-1')).toBe(true);
      expect(cache.has('page-5')).toBe(true);
      expect(cache.getCurrentMemoryMb()).toBeLessThanOrEqual(150);
    });

    it('should reject single textures exceeding entire memory budget', () => {
      const cache = new RasterMemoryCacheManager(150);
      const oversized = 200 * 1024 * 1024; // 200MB > 150MB budget

      cache.setPageTexture('oversized-page', oversized);
      expect(cache.getCachedPageCount()).toBe(0);
      expect(cache.has('oversized-page')).toBe(false);
    });
  });

  describe('Viewport Tile Culling (isAnnotationInViewport)', () => {
    const viewport = {
      scrollX: 0,
      scrollY: 0,
      width: 800,
      height: 600,
    };

    it('should return true for annotations directly inside viewport', () => {
      const insideAnnotation = { x: 100, y: 150, width: 40, height: 40 };
      expect(isAnnotationInViewport(insideAnnotation, viewport)).toBe(true);
    });

    it('should return true for annotations within the buffer margin (50px)', () => {
      // 20px beyond the right edge (820px), within 50px buffer (850px)
      const marginAnnotation = { x: 820, y: 200, width: 20, height: 20 };
      expect(isAnnotationInViewport(marginAnnotation, viewport, 50)).toBe(true);
    });

    it('should return false for annotations clearly outside viewport', () => {
      // Completely off-screen below (scrollY + height = 600, annotation at y = 900)
      const offscreenAnnotation = { x: 100, y: 900, width: 50, height: 50 };
      expect(isAnnotationInViewport(offscreenAnnotation, viewport, 50)).toBe(false);
    });
  });

  describe('Adaptive Event Loop Throttling (shouldSampleStrokePoint)', () => {
    it('should throttle high-frequency events within throttle window', () => {
      const throttleMs = 12; // 12ms window
      const t0 = 1000;

      // Event arrives at t=1005 (delta 5ms < 12ms) -> Drop
      expect(shouldSampleStrokePoint(t0, 1005, throttleMs)).toBe(false);

      // Event arrives at t=1013 (delta 13ms >= 12ms) -> Sample
      expect(shouldSampleStrokePoint(t0, 1013, throttleMs)).toBe(true);
    });

    it('should allow all points when throttling is disabled (0ms)', () => {
      expect(shouldSampleStrokePoint(1000, 1001, 0)).toBe(true);
    });
  });

  describe('Performance Documentation (docs/LOW_COST_TABLET_PERF.md)', () => {
    it('should document memory limits, 30 FPS target, and viewport culling results', () => {
      expect(fs.existsSync(docsPath)).toBe(true);
      const content = fs.readFileSync(docsPath, 'utf8');

      expect(content).toContain('150 MB');
      expect(content).toContain('30 FPS');
      expect(content).toContain('Viewport Tile Culling');
      expect(content).toContain('Mali-G52');
      expect(content).toContain('LRU Eviction');
    });
  });
});
