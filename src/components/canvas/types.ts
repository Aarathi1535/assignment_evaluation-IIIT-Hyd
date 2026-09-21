import type Konva from 'konva';
import type { ImageFitMode, RenderedImageBounds } from '@/lib/annotations';
import type { PanZoomTransform, CanvasViewState } from '@/lib/panZoom';
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
import type { SmoothingOptions } from '@/lib/strokeSmoothing';
import type {
  CheckAnnotation,
  CrossAnnotation,
  HighlightAnnotation,
  TextNoteAnnotation,
  MarkAnnotation,
  StampType,
} from '@/lib/stampTool';
import type {
  SerializedPageAnnotations,
  SerializedAnnotationDocument,
  SerializeCanvasOptions,
  ValidationResult,
  DeserializationResult,
} from '@/lib/annotationSerialization';

import type {
  ShortcutAction,
  ShortcutGroup,
  ShortcutDefinition,
} from '@/lib/shortcutMap';

export type CanvasTool = 'none' | 'select' | 'pen' | 'check' | 'cross' | 'highlight' | 'text' | 'eraser' | 'loupe';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type {
  CanvasViewState,
  AnswerSheetPage,
  FreehandStroke,
  StrokePoint,
  PenColorId,
  PenWidthId,
  PenColorOption,
  PenWidthOption,
  AnnotationAction,
  PageHistory,
  SmoothingOptions,
  CheckAnnotation,
  CrossAnnotation,
  HighlightAnnotation,
  TextNoteAnnotation,
  MarkAnnotation,
  StampType,
  SerializedPageAnnotations,
  SerializedAnnotationDocument,
  SerializeCanvasOptions,
  ValidationResult,
  DeserializationResult,
  ShortcutAction,
  ShortcutGroup,
  ShortcutDefinition,
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
  /** Current pan/zoom/rotation transform */
  transform?: PanZoomTransform;
  /** Brightness level (-100 to 100, default 0 = original image, AE-150) */
  brightness?: number;
  /** Contrast level (-100 to 100, default 0 = original image, AE-150) */
  contrast?: number;
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
  /** Page rotation in degrees (0, 90, 180, 270) (AE-150 / AE-151) */
  rotation?: number;
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
  /** Controlled rotation angle in degrees (0, 90, 180, 270, AE-150) */
  rotation?: number;
  /** Uncontrolled initial rotation angle in degrees (default 0, AE-150) */
  initialRotation?: number;
  /** Callback fired when page rotation changes (AE-150) */
  onRotationChange?: (rotation: number) => void;
  /** Controlled image brightness (-100 to 100, default 0, AE-150) */
  brightness?: number;
  /** Uncontrolled initial image brightness (default 0, AE-150) */
  initialBrightness?: number;
  /** Callback fired when image brightness changes (AE-150) */
  onBrightnessChange?: (brightness: number) => void;
  /** Controlled image contrast (-100 to 100, default 0, AE-150) */
  contrast?: number;
  /** Uncontrolled initial image contrast (default 0, AE-150) */
  initialContrast?: number;
  /** Callback fired when image contrast changes (AE-150) */
  onContrastChange?: (contrast: number) => void;
  /** Whether rotation control button is enabled (default true, AE-150) */
  enableRotationControls?: boolean;
  /** Whether brightness & contrast controls are enabled (default true, AE-150) */
  enableImageAdjustments?: boolean;
  /** Callback fired when Fit Width preset is applied (AE-151) */
  onFitWidth?: () => void;
  /** Callback fired when Actual Size (1:1) preset is applied (AE-151) */
  onActualSize?: () => void;
  /** Callback fired when Fit to Page preset is applied (AE-151) */
  onFitPage?: () => void;
  /** Whether the select / move / delete tool is enabled (default true, AE-132) */
  enableSelect?: boolean;
  /** Controlled selected annotation ID (AE-132) */
  selectedAnnotationId?: string | null;
  /** Callback fired when an annotation is selected or deselected (AE-132) */
  onSelectAnnotation?: (id: string | null) => void;
  /** Callback fired when an annotation is moved (AE-132) */
  onAnnotationMove?: (
    id: string,
    newPosition: { x: number; y: number },
    previousPosition: { x: number; y: number }
  ) => void;
  /** Callback fired when an annotation is deleted (AE-132) */
  onAnnotationDelete?: (annotation: MarkAnnotation) => void;
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
  /** Whether the magnifier / loupe tool is enabled (default true, AE-152) */
  enableLoupe?: boolean;
  /** Controlled loupe active state (AE-152) */
  isLoupeActive?: boolean;
  /** Callback fired when loupe active state changes (AE-152) */
  onLoupeActiveChange?: (active: boolean) => void;
  /** Loupe magnification multiplier (default 2.0x, AE-152) */
  loupeMagnification?: number;
  /** Loupe lens diameter in pixels (default 180px, AE-152) */
  loupeDiameter?: number;
  /** Whether the Reset View toolbar button is enabled (default true, AE-153) */
  enableResetView?: boolean;
  /** Callback fired when Reset View is executed (AE-153) */
  onResetView?: () => void;
  /** Whether the stamp tools (check, cross) are enabled (default true, AE-130) */
  enableStamps?: boolean;
  /** Whether the highlight tool is enabled (default true, AE-130) */
  enableHighlight?: boolean;
  /** Whether the text-note annotation tool is enabled (default true, AE-131) */
  enableTextNote?: boolean;
  /** Whether the undo/redo feature is enabled (default true, AE-128) */
  enableUndoRedo?: boolean;
  /** Controlled active tool ('none' | 'select' | 'pen' | 'check' | 'cross' | 'highlight' | 'text' | 'eraser' | 'loupe', AE-128 / AE-130 / AE-131 / AE-152) */
  activeTool?: CanvasTool;
  /** Callback fired when active tool changes (AE-128 / AE-130 / AE-152) */
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
  /** Optional stroke smoothing options (AE-129) */
  smoothingOptions?: SmoothingOptions;
  /** In-memory freehand strokes for the canvas or session */
  strokes?: FreehandStroke[];
  /** Callback fired when strokes change or new stroke is completed/erased */
  onStrokesChange?: (strokes: FreehandStroke[]) => void;
  /** In-memory check, cross, and highlight annotations for the canvas or session (AE-130) */
  annotations?: MarkAnnotation[];
  /** Callback fired when annotations change or new annotation is placed/erased (AE-130) */
  onAnnotationsChange?: (annotations: MarkAnnotation[]) => void;
  /** Callback fired when a new annotation (check, cross, highlight) is completed (AE-130) */
  onAnnotationComplete?: (annotation: MarkAnnotation) => void;
  /** Callback fired after an undo operation */
  onUndo?: () => void;
  /** Callback fired after a redo operation */
  onRedo?: () => void;
  /** Whether the overlay visibility toggle button is enabled in the toolbar (default true, AE-133) */
  enableOverlayToggle?: boolean;
  /** Controlled overlay visibility state (AE-133) */
  isOverlayVisible?: boolean;
  /** Uncontrolled initial overlay visibility state (default true, AE-133) */
  initialOverlayVisible?: boolean;
  /** Callback fired when overlay visibility is toggled (AE-133) */
  onOverlayVisibilityChange?: (visible: boolean) => void;
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
  /** Answer script ID used for loading page annotations (AE-136) */
  scriptId?: string;
  /** Whether automatic annotation retrieval from backend is enabled (default true when scriptId is present, AE-136) */
  enableAnnotationLoading?: boolean;
  /** Custom URL builder for fetching page annotations (AE-136) */
  loadAnnotationsUrl?: (scriptId: string, pageIdentifier: string | number) => string;
  /** Custom fetcher function for retrieving page annotations (AE-136) */
  fetchAnnotations?: (
    scriptId: string,
    pageIdentifier: string | number,
    signal?: AbortSignal
  ) => Promise<{ annotations: MarkAnnotation[]; strokes: FreehandStroke[] } | null>;
  /** Callback fired when page annotations are successfully loaded and hydrated (AE-136) */
  onAnnotationsLoaded?: (result: {
    scriptId?: string;
    pageId?: string;
    pageNumber?: number;
    annotations: MarkAnnotation[];
    strokes: FreehandStroke[];
  }) => void;
  /** Callback fired when loading page annotations fails (AE-136) */
  onAnnotationsLoadError?: (error: Error, pageIdentifier: string | number) => void;
  /** Whether debounced autosave to backend is enabled (default true when scriptId is present, AE-137) */
  enableAutosave?: boolean;
  /** Debounce delay in milliseconds before triggering autosave (default 800ms, AE-137) */
  debounceDelayMs?: number;
  /** Custom URL builder for saving page annotations (AE-137) */
  saveAnnotationsUrl?: (scriptId: string, pageNumber: number) => string;
  /** Custom saver function for sending serialized page annotations (AE-137) */
  saveAnnotations?: (params: {
    scriptId: string;
    pageNumber: number;
    data: SerializedPageAnnotations;
  }) => Promise<{ success: boolean; error?: string }>;
  /** Callback fired when save status changes ('idle' | 'saving' | 'saved' | 'error', AE-137) */
  onSaveStatusChange?: (status: SaveStatus) => void;
  /** Callback fired when autosave succeeds (AE-137) */
  onSaveSuccess?: (pageNumber: number) => void;
  /** Callback fired when autosave fails (AE-137) */
  onSaveError?: (pageNumber: number, error: Error) => void;
  /** Authoritative shortcut action listener (AE-154) */
  onShortcutAction?: (action: ShortcutAction, event: KeyboardEvent) => void;
  /** Save draft trigger handler (AE-154) */
  onSaveDraft?: () => void;
  /** Final submit trigger handler (AE-154) */
  onSubmitFinal?: () => void;
  /** Next question trigger handler (AE-154) */
  onNextQuestion?: () => void;
  /** Previous question trigger handler (AE-154) */
  onPrevQuestion?: () => void;
  /** Custom keymap override (default: SHORTCUT_MAP, AE-154) */
  shortcutMap?: readonly ShortcutDefinition[];
}
