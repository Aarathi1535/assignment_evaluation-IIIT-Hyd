// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { AnswerSheetCanvas } from '../components/canvas/AnswerSheetCanvas';

// Mock CanvasStage and Layers to avoid Konva DOM initialisation in tests
vi.mock('../components/canvas/CanvasStage', () => ({
  CanvasStage: ({ children }: any) => <div data-testid="mock-canvas-stage">{children}</div>,
  useCanvasStage: () => ({
    stage: null,
    dimensions: { width: 800, height: 600 },
    isReady: true
  })
}));

vi.mock('../components/canvas/PageImageLayer', () => ({
  PageImageLayer: ({ src, thumbnailUrl, onImageLoad }: any) => {
    React.useEffect(() => {
      // Expose a global function to trigger the load so tests can control it
      (window as any).triggerPageImageLoad = () => {
        if (onImageLoad) {
          onImageLoad({ naturalWidth: 800, naturalHeight: 1100 } as any, { x: 0, y: 0, width: 800, height: 1100, scale: 1 });
        }
      };
    }, [onImageLoad]);
    return <div data-testid="mock-page-image-layer" data-src={src} data-thumbnail={thumbnailUrl}></div>;
  }
}));

vi.mock('../components/canvas/PenLayer', () => ({
  PenLayer: () => <div data-testid="mock-pen-layer"></div>
}));

vi.mock('../components/canvas/MarkLayer', () => ({
  MarkLayer: () => <div data-testid="mock-mark-layer"></div>
}));

describe('AE-176 Canvas Prefetch & Thumbnail Tests', () => {
  let originalImage: any;
  let ImageMock: any;

  beforeEach(() => {
    originalImage = window.Image;
    ImageMock = vi.fn();
    window.Image = function(this: any) {
      this.src = '';
      this.onload = null;
      this.onerror = null;
      this.width = 800;
      this.height = 1000;
      ImageMock(this);
    } as any;
  });

  afterEach(() => {
    window.Image = originalImage;
    vi.restoreAllMocks();
  });

  it('1. Adjacent-page prefetch triggers after current page loads', () => {
    const pages = [
      { id: '1', pageNumber: 1, imageUrl: '/api/img1', thumbnailUrl: '/api/thumb1' },
      { id: '2', pageNumber: 2, imageUrl: '/api/img2', thumbnailUrl: '/api/thumb2' },
      { id: '3', pageNumber: 3, imageUrl: '/api/img3', thumbnailUrl: '/api/thumb3' },
    ];
    
    render(<AnswerSheetCanvas pages={pages} currentPageIndex={1} width={800} height={600} />);
    
    // trigger onImageLoad on the mock PageImageLayer
    act(() => {
      if ((window as any).triggerPageImageLoad) {
        (window as any).triggerPageImageLoad();
      }
    });

    // After load, prefetch should happen for index 0 and 2
    // AnswerSheetCanvas directly creates new window.Image() for prefetch
    const prefetchedImg1 = ImageMock.mock.calls.find((call: any) => call[0].src === '/api/img1');
    const prefetchedImg3 = ImageMock.mock.calls.find((call: any) => call[0].src === '/api/img3');
    
    expect(prefetchedImg1).toBeTruthy();
    expect(prefetchedImg3).toBeTruthy();
  });

  it('2. Invalid previous/next page indexes are not prefetched', () => {
    const pages = [
      { id: '1', pageNumber: 1, imageUrl: '/api/img1', thumbnailUrl: '/api/thumb1' },
      { id: '2', pageNumber: 2, imageUrl: '/api/img2', thumbnailUrl: '/api/thumb2' },
    ];
    
    render(<AnswerSheetCanvas pages={pages} currentPageIndex={1} width={800} height={600} />);
    
    act(() => {
      if ((window as any).triggerPageImageLoad) {
        (window as any).triggerPageImageLoad();
      }
    });

    // We are on page 2 (index 1). Prev is index 0. Next is index 2 (invalid).
    const prefetchedImg1 = ImageMock.mock.calls.find((call: any) => call[0].src === '/api/img1');
    const prefetchedImg3 = ImageMock.mock.calls.find((call: any) => call[0].src === '/api/img3');
    
    expect(prefetchedImg1).toBeTruthy(); // Should prefetch
    expect(prefetchedImg3).toBeUndefined(); // Should NOT prefetch
  });

  it('3. Thumbnail is used while full-resolution image is loading', () => {
    const pages = [
      { id: '1', pageNumber: 1, imageUrl: '/api/img1', thumbnailUrl: '/api/thumb1' },
    ];
    
    render(<AnswerSheetCanvas pages={pages} currentPageIndex={0} width={800} height={600} />);
    
    // Check if thumbnail is passed to PageImageLayer
    const layer = screen.getByTestId('mock-page-image-layer');
    expect(layer.getAttribute('data-thumbnail')).toBe('/api/thumb1');
    
    // We can verify that the main image loading state is still active
    expect(screen.getAllByTestId('canvas-loading-overlay').length).toBeGreaterThan(0);
  });
});
