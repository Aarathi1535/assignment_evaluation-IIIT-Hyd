import type Konva from 'konva';
import type { ImageFitMode, RenderedImageBounds } from '@/lib/annotations';
import type { PanZoomTransform } from '@/lib/panZoom';
import type { AnswerSheetPage } from '@/lib/pageNavigation';
import type {
  FreehandStroke,
  StrokePoint,
  PenColorId,
  PenWidthId,
  PenColorOption,
  PenWidthOption,
} from '@/lib/penTool';
import type { AnnotationAction, PageHistory } from '@/lib/annotationHistory';

export type CanvasTool = 'none' | 'pen' | 'eraser';

export type {
  AnswerSheetPage,
  FreehandStroke,
  StrokePoint,
  PenColorId,
  PenWidthId,
  PenColorOption,
  PenWidthOption,
  AnnotationAction,
  PageHistory,
};

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
  /** Current pan/zoom transform */
  transform?: PanZoomTransform;
  /** Callback fired when image is successfully loaded and rendered */
  onImageLoad?: (image: HTMLImageElement, baseBounds: RenderedImageBounds) => void;
  /** Callback fired if image loading fails */
  onImageError?: (error: Error) => void;
  /** Callback fired when transform updates (e.g. from gestures) */
  onTransformChange?: (transform: PanZoomTransform) => void;
  /** Minimum zoom factor (default 1.0) */
  minZoom?: number;
  /** Maximum zoom factor (default 4.0) */
  maxZoom?: number;
  /** Whether interactive pan/zoom is enabled (default true) */
  enablePanZoom?: boolean;
  /** Whether freehand pen tool mode is currently active (disables drag-pan in favor of drawing) */
  isPenActive?: boolean;
  /** Parent Konva stage instance */
  stage?: Konva.Stage | null;
}

export interface AnswerSheetCanvasProps {
  /** Single image URL, API endpoint, or data URI (used when pages array is not provided) */
  src?: string | null;
  /** List of pages belonging to the answer script (AE-125) */
  pages?: AnswerSheetPage[];
  /** Controlled active page index (0-based) */
  currentPageIndex?: number;
  /** Uncontrolled initial active page index (default 0) */
  initialPageIndex?: number;
  /** Callback fired when active page changes */
  onPageChange?: (pageIndex: number, page: AnswerSheetPage) => void;
  /** Whether to render the multi-page navigation toolbar (default true when pages is present) */
  showPageNavigation?: boolean;
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
  /** Minimum zoom level (default 1.0 = 100%) */
  minZoom?: number;
  /** Maximum zoom level (default 4.0 = 400%) */
  maxZoom?: number;
  /** Whether pan and zoom gestures are enabled (default true) */
  enablePanZoom?: boolean;
  /** Whether to show the floating zoom toolbar controls (default true) */
  showZoomControls?: boolean;
  /** Whether the freehand pen tool feature is enabled (default true, AE-126) */
  enablePenTool?: boolean;
  /** Uncontrolled initial pen active state (default false, AE-126) */
  initialPenActive?: boolean;
  /** Controlled pen active state (AE-126) */
  isPenActive?: boolean;
  /** Callback fired when pen active state is toggled (AE-126) */
  onPenActiveChange?: (active: boolean) => void;
  /** Whether the eraser tool is enabled (default true, AE-128) */
  enableEraserTool?: boolean;
  /** Whether the undo/redo feature is enabled (default true, AE-128) */
  enableUndoRedo?: boolean;
  /** Controlled active tool ('none' | 'pen' | 'eraser', AE-128) */
  activeTool?: CanvasTool;
  /** Callback fired when active tool changes (AE-128) */
  onToolChange?: (tool: CanvasTool) => void;
  /** Controlled selected pen color ('red' | 'blue' | 'green', AE-127) */
  selectedPenColor?: PenColorId;
  /** Uncontrolled initial pen color (default 'red', AE-127) */
  initialPenColor?: PenColorId;
  /** Callback fired when pen color changes (AE-127) */
  onPenColorChange?: (color: PenColorId) => void;
  /** Controlled selected pen stroke width ('thin' | 'thick', AE-127) */
  selectedPenWidth?: PenWidthId;
  /** Uncontrolled initial pen stroke width (default 'thin', AE-127) */
  initialPenWidth?: PenWidthId;
  /** Callback fired when pen stroke width changes (AE-127) */
  onPenWidthChange?: (width: PenWidthId) => void;
  /** In-memory freehand strokes for the canvas or session */
  strokes?: FreehandStroke[];
  /** Callback fired when strokes change or new stroke is completed/erased */
  onStrokesChange?: (strokes: FreehandStroke[]) => void;
  /** Callback fired after an undo operation */
  onUndo?: () => void;
  /** Callback fired after a redo operation */
  onRedo?: () => void;
  /** Default pen stroke color fallback (default '#e11d48') */
  defaultStrokeColor?: string;
  /** Default pen stroke width fallback (default 2) */
  defaultStrokeWidth?: number;
  /** Custom fallback component on load error */
  fallback?: React.ReactNode;
  /** Callback fired when image is loaded and rendered with measured bounds */
  onLoad?: (bounds: RenderedImageBounds) => void;
  /** Callback fired if image fails to load */
  onError?: (error: Error) => void;
  /** Callback fired when zoom/pan transform changes */
  onTransformChange?: (transform: PanZoomTransform) => void;
}
