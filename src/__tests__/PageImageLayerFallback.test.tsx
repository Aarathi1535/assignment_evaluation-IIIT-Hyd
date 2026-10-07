// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { PageImageLayer } from '../components/canvas/PageImageLayer';

// Mock Konva to avoid JSDOM Canvas context errors
vi.mock('konva', () => {
  return {
    default: {
      Layer: class {
        destroy = vi.fn();
        add = vi.fn();
        batchDraw = vi.fn();
      },
      Group: class {
        destroy = vi.fn();
        add = vi.fn();
        position = vi.fn();
        offset = vi.fn();
        scale = vi.fn();
        rotation = vi.fn();
      },
      Image: class {
        destroy = vi.fn();
        image = vi.fn();
        position = vi.fn();
        size = vi.fn();
        filters = vi.fn();
        cache = vi.fn();
        clearCache = vi.fn();
        brightness = vi.fn();
        contrast = vi.fn();
      },
      Filters: { Brighten: {}, Contrast: {} },
    }
  };
});

// Mock CanvasStage context
vi.mock('../components/canvas/CanvasStage', () => ({
  useCanvasStage: () => ({
    stage: { width: () => 800, height: () => 600, add: vi.fn(), on: vi.fn(), off: vi.fn(), container: () => document.createElement('div') },
    dimensions: { width: 800, height: 600 },
    isReady: true
  })
}));

describe('AE-176 PageImageLayer Thumbnail Fallback', () => {
  let originalImage: any;
  let imageInstances: any[] = [];

  beforeEach(() => {
    originalImage = window.Image;
    imageInstances = [];
    window.Image = function(this: any) {
      this.src = '';
      this.onload = null;
      this.onerror = null;
      this.width = 800;
      this.height = 1000;
      imageInstances.push(this);
    } as any;
  });

  afterEach(() => {
    window.Image = originalImage;
    vi.restoreAllMocks();
  });

  it('falls back to full-resolution image when thumbnail fails and avoids infinite loops', () => {
    render(
      <PageImageLayer 
        src="/api/high-res.jpg" 
        thumbnailUrl="/api/thumb.jpg" 
      />
    );

    // Two images should be instantiated: one for thumbnail, one for high-res
    expect(imageInstances.length).toBe(2);
    
    const thumbImg = imageInstances.find(img => img.src.includes('thumb.jpg'));
    const highResImg = imageInstances.find(img => img.src.includes('high-res.jpg'));

    expect(thumbImg).toBeDefined();
    expect(highResImg).toBeDefined();
    
    // Simulate thumbnail failure
    expect(thumbImg.onerror).toBeInstanceOf(Function);
    
    act(() => {
      thumbImg.onerror(new Event('error'));
    });
    
    // The high-res image should still be able to load successfully
    expect(highResImg.onload).toBeInstanceOf(Function);
    
    let loaded = false;
    const mockOnLoad = vi.fn();
    const originalOnload = highResImg.onload;
    highResImg.onload = (...args: any[]) => {
        loaded = true;
        mockOnLoad();
        if (originalOnload) originalOnload(...args);
    };

    act(() => {
      highResImg.onload(new Event('load'));
    });

    expect(loaded).toBe(true);
    expect(mockOnLoad).toHaveBeenCalled();
  });
});
