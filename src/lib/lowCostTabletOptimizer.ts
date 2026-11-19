/**
 * Low-Cost Tablet Performance Optimizer (AE-237)
 * Implements hardware capability profiling, dynamic raster cache budgeting,
 * viewport tile culling, and adaptive stroke sampling for budget tablets.
 */

export type HardwareTier = 'high' | 'medium' | 'constrained';

export interface DeviceCapabilityProfile {
  tier: HardwareTier;
  maxCacheMemoryMb: number;
  maxDpr: number;
  enableTileCulling: boolean;
  maxPointsPerStroke: number;
  strokeThrottleMs: number;
}

export interface ViewportBox {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Profiles client hardware parameters and returns performance tuning configuration.
 */
export function profileDeviceCapabilities(
  deviceMemoryGb?: number,
  hardwareConcurrency?: number,
  isMobileOrTablet = true
): DeviceCapabilityProfile {
  const ram = typeof deviceMemoryGb === 'number' ? deviceMemoryGb : 4;
  const cores = typeof hardwareConcurrency === 'number' ? hardwareConcurrency : 4;

  let tier: HardwareTier;

  if (isMobileOrTablet && (ram <= 4 || cores <= 4)) {
    tier = 'constrained';
  } else if (ram <= 8 || cores <= 6) {
    tier = 'medium';
  } else {
    tier = 'high';
  }

  switch (tier) {
    case 'constrained':
      return {
        tier: 'constrained',
        maxCacheMemoryMb: 150, // Strict 150MB raster cache ceiling
        maxDpr: 1.25,          // Downscale high-DPI rendering to relieve GPU
        enableTileCulling: true,
        maxPointsPerStroke: 200,
        strokeThrottleMs: 12,  // Cap digitizer updates to ~80Hz
      };
    case 'medium':
      return {
        tier: 'medium',
        maxCacheMemoryMb: 400,
        maxDpr: 1.75,
        enableTileCulling: true,
        maxPointsPerStroke: 500,
        strokeThrottleMs: 6,
      };
    case 'high':
    default:
      return {
        tier: 'high',
        maxCacheMemoryMb: 1024,
        maxDpr: 2.5,
        enableTileCulling: false,
        maxPointsPerStroke: 1000,
        strokeThrottleMs: 0,   // Unthrottled
      };
  }
}

/**
 * Manages in-memory raster page textures with deterministic LRU eviction.
 */
export class RasterMemoryCacheManager {
  private readonly maxBytes: number;
  private currentBytes = 0;
  private cache = new Map<string, { sizeBytes: number; lastAccessed: number }>();

  constructor(maxMemoryMb = 150) {
    this.maxBytes = maxMemoryMb * 1024 * 1024;
  }

  public setPageTexture(pageId: string, sizeBytes: number): void {
    if (sizeBytes > this.maxBytes) {
      // Single texture exceeds entire budget, reject caching
      return;
    }

    // Evict existing entry if updating
    if (this.cache.has(pageId)) {
      this.currentBytes -= this.cache.get(pageId)!.sizeBytes;
      this.cache.delete(pageId);
    }

    // Evict LRU entries until space is available
    while (this.currentBytes + sizeBytes > this.maxBytes && this.cache.size > 0) {
      this.evictOldest();
    }

    this.cache.set(pageId, {
      sizeBytes,
      lastAccessed: Date.now(),
    });
    this.currentBytes += sizeBytes;
  }

  public getPageTexture(pageId: string): boolean {
    const entry = this.cache.get(pageId);
    if (!entry) return false;

    entry.lastAccessed = Date.now();
    return true;
  }

  public has(pageId: string): boolean {
    return this.cache.has(pageId);
  }

  public getCurrentMemoryMb(): number {
    return Math.round((this.currentBytes / (1024 * 1024)) * 100) / 100;
  }

  public getCachedPageCount(): number {
    return this.cache.size;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, value] of this.cache.entries()) {
      if (value.lastAccessed < oldestTimestamp) {
        oldestTimestamp = value.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey)!;
      this.currentBytes -= entry.sizeBytes;
      this.cache.delete(oldestKey);
    }
  }
}

/**
 * Determines whether an annotation's bounding box intersects the visible viewport (+ margin).
 */
export function isAnnotationInViewport(
  annotationBounds: BoundingBox,
  viewport: ViewportBox,
  margin = 50
): boolean {
  const viewLeft = viewport.scrollX - margin;
  const viewRight = viewport.scrollX + viewport.width + margin;
  const viewTop = viewport.scrollY - margin;
  const viewBottom = viewport.scrollY + viewport.height + margin;

  const annoLeft = annotationBounds.x;
  const annoRight = annotationBounds.x + annotationBounds.width;
  const annoTop = annotationBounds.y;
  const annoBottom = annotationBounds.y + annotationBounds.height;

  // Check if completely outside viewport
  if (
    annoRight < viewLeft ||
    annoLeft > viewRight ||
    annoBottom < viewTop ||
    annoTop > viewBottom
  ) {
    return false;
  }

  return true;
}

/**
 * Evaluates whether an incoming stroke event should be sampled or dropped to avoid event starvation.
 */
export function shouldSampleStrokePoint(
  lastSampleTimestamp: number,
  currentTimestamp: number,
  throttleMs: number
): boolean {
  if (throttleMs <= 0) return true;
  return currentTimestamp - lastSampleTimestamp >= throttleMs;
}
