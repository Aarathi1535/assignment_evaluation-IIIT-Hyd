import type Konva from 'konva';
import type { ImageFitMode, RenderedImageBounds } from '@/lib/annotations';

export interface CanvasDimensions {
  width: number;
  height: number;
}

export interface CanvasStageProps {
  /** Width of the canvas stage. If omitted or 'auto', uses container width */
  width?: number | 'auto';
  /** Height of the canvas stage. If omitted or 'auto', uses container height */
  height?: number | 'auto';
  /** Additional CSS class names for the outer container */
  className?: string;
  /** Background color of the stage container */
  backgroundColor?: string;
  /** Callback fired when stage dimensions change */
  onResize?: (dimensions: CanvasDimensions) => void;
  /** Callback fired when stage instance is created or destroyed */
  onStageReady?: (stage: Konva.Stage | null) => void;
  /** Children layers/nodes to mount inside the stage container */
  children?: React.ReactNode;
}

export interface PageImageLayerProps {
  /** URL or base64 data URI of the page image */
  src?: string | null;
  /** Alt or debug label for the page image */
  alt?: string;
  /** Aspect ratio fit mode ('contain' | 'cover' | 'fill' | 'natural') */
  fitMode?: ImageFitMode;
  /** Callback fired when image is successfully loaded and rendered */
  onImageLoad?: (image: HTMLImageElement, bounds: RenderedImageBounds) => void;
  /** Callback fired if image loading fails */
  onImageError?: (error: Error) => void;
  /** Parent Konva stage instance */
  stage?: Konva.Stage | null;
}

export interface AnswerSheetCanvasProps {
  /** URL, API endpoint, or data URI of the answer-sheet page image */
  src?: string | null;
  /** Page number or label for display/accessibility */
  pageLabel?: string;
  /** Aspect ratio fit mode ('contain' | 'cover' | 'fill' | 'natural') */
  fitMode?: ImageFitMode;
  /** Custom width (defaults to 'auto' responsive) */
  width?: number | 'auto';
  /** Custom height (defaults to 'auto' responsive) */
  height?: number | 'auto';
  /** Custom CSS class names */
  className?: string;
  /** Stage background color (default '#f8fafc' / slate-50) */
  backgroundColor?: string;
  /** Custom fallback component on load error */
  fallback?: React.ReactNode;
  /** Callback fired when image is loaded and rendered with measured bounds */
  onLoad?: (bounds: RenderedImageBounds) => void;
  /** Callback fired if image fails to load */
  onError?: (error: Error) => void;
}
