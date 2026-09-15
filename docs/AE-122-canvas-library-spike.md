# Canvas Library Spike — AE-122

## Requirements

The Assignment Evaluation platform requires an interactive answer-sheet grading interface where instructors and Teaching Assistants (TAs) can view high-resolution scanned student answer-sheets, zoom and pan across pages, and overlay digital grading marks (freehand pen strokes, highlights, comments, bounding boxes, score rubrics, and stamps).

Key technical and operational requirements for the canvas foundation include:
1. **High-Resolution Page Image Rendering**: Efficiently display scanned A4/letter answer-sheet pages (typically 150–300 DPI, multi-megapixel images) without browser freezing, blurry downsampling, or memory leaks.
2. **Layered Architecture**: Independent rendering of the static background page image and dynamic annotations so drawing actions do not trigger costly bitmap repaints.
3. **Smooth Pan & Zoom**: Responsive viewport transformation (zooming into specific student answers and panning across margins) with sub-pixel precision.
4. **Coordinate Precision & Transformation**: Stable conversion between screen/viewport coordinates and normalized image coordinates (0.0–1.0 or pixel space) to ensure annotations persist accurately across different screen sizes, aspect ratios, and resolutions.
5. **Next.js & React 19 Compatibility**: Safe execution in Next.js App Router with `'use client'` hydration boundaries and no fragile reliance on outdated React reconcilers.
6. **Extensibility for Annotation Tools (AE-123+)**: Native primitives for lines, rects, text, icons, and custom composite shapes with hit testing and event handling.
7. **Performance & Resource Efficiency**: Low memory overhead, tree-shakeable bundle impact, and zero problematic native C++ runtime dependencies on the client.
8. **Testability**: Feasible unit and integration testing within Vitest / Node.js test environments.

---

## Candidates Evaluated

We evaluated the primary candidate libraries explicitly specified in AE-122 along with standard alternatives:

1. **Konva.js (`konva`)**
   - A 2D scene-graph canvas library providing object-oriented canvas abstractions (`Stage`, `Layer`, `Group`, `Shape`, `Image`, `Transformer`).
2. **Fabric.js (`fabric`)**
   - An interactive object-model canvas library providing an object oriented model over HTML5 canvas, SVG parsing/rendering, and built-in interactive controls.
3. **SVG / Native Canvas (Custom HTML5 Canvas Implementation)**
   - Plain HTML5 2D Canvas API or SVG DOM nodes without an external framework.

---

## Evaluation Criteria

We evaluated the candidates systematically against the 12 project criteria:

| # | Criterion | Importance | Description |
|---|---|---|---|
| 1 | **React/Next.js Compatibility** | Critical | Seamless integration with Next.js App Router and React 19 without reconciler conflicts or SSR breakage. |
| 2 | **TypeScript Support** | High | First-class, accurate type definitions for shapes, events, vectors, and lifecycle methods. |
| 3 | **Image Rendering** | Critical | High-DPI support, aspect-ratio handling, image caching, and pixel-crisp display of scanned exam pages. |
| 4 | **Future Pan/Zoom Support** | High | Built-in coordinate transforms, viewport scaling, pointer position calculation, and drag constraints. |
| 5 | **Future Annotation/Drawing Support** | Critical | Primitives for freehand strokes, smoothing, erasers (`destination-out`), highlighters (`multiply`), rects, arrows. |
| 6 | **Future Overlays & Score Stamps** | High | Composite shapes, text bounding boxes, badge groups, and interactive transformation widgets. |
| 7 | **Performance with Large Scans** | Critical | Multi-layer canvas isolation to avoid repainting heavy image bitmaps during continuous drawing/pointer moves. |
| 8 | **API Complexity** | Medium | Clean, predictable scene-graph hierarchy (`Stage` -> `Layer` -> `Group` -> `Shape`). |
| 9 | **Bundle / Dependency Impact** | High | Minimal bundle size, pure JavaScript/ESM, zero heavy transitive dependencies. |
| 10 | **Maintainability** | High | Active community, frequent releases, stable LTS APIs, extensive production battle-testing. |
| 11 | **Testing Feasibility** | Medium | Clean mocking/stubbing capabilities in Vitest / Node headless test runners. |
| 12 | **Fit with Existing Architecture** | High | Direct alignment with MongoDB annotation schemas (`IPosition`, normalized coordinates) and UI design system. |

---

## Comparison

| Feature / Criteria | Konva.js (`konva`) | Fabric.js (`fabric` v6) | Native HTML5 Canvas / SVG |
|---|---|---|---|
| **Multi-Layer Isolation** | **Native (`Konva.Layer`)** — Separate background image layer from active drawing layer. | Single canvas element + upper interaction canvas. Layer separation requires custom canvas stacking. | Manual multi-canvas DOM management required. |
| **React 19 / Next.js** | **Excellent** via direct DOM ref & `useEffect` hook. No strict reconciler dependency. | **Good** via DOM ref & `useEffect`. | Direct DOM hooks. |
| **TypeScript Support** | Built-in first-party `.d.ts` bundled with package. | Built-in (Fabric v6 is written in TS). | Standard browser types (`CanvasRenderingContext2D`). |
| **Image Caching & Performance** | `shape.cache()` and layer hit-graph toggles allow zero-cost bitmap retention during redraws. | Object caching available; image redraws can cause frame drops on complex stacks. | Manual offscreen canvas caching. |
| **Pan & Zoom Mathematics** | Built-in `stage.scale()`, `stage.position()`, and `stage.getRelativePointerPosition()`. | Built-in `canvas.setZoom()` and `canvas.viewportTransform`. | Must write matrix math / Affine transforms manually. |
| **Drawing & Annotation Primitives** | Rich primitives (`Line` with spline tension, `Rect`, `Circle`, `Text`, `Arrow`, `Group`, `Transformer`). | Rich primitives (`Path`, `Rect`, `IText`, `Group`). Built-in free drawing brush. | Must implement path algorithms, hit detection, and selection handles from scratch. |
| **Dependency Footprint** | Lightweight (~140 KB minified), zero runtime dependencies. | Moderate (~280 KB minified), historically included SVG/Node canvas sub-modules. | 0 KB external dependencies, high custom code maintenance. |
| **Testability & Mocking** | Clean scene graph easily mockable in headless unit tests. | Canvas context requirements can complicate headless jsdom testing. | Standard canvas mock stubs. |

---

## Decision

**Selected Library: Konva.js (`konva`)**

We select **Konva.js** as the canvas library for the Assignment Evaluator platform.

---

## Rationale

1. **True Multi-Layer Architecture**:
   Answer-sheet evaluation involves high-resolution page scans (often 2–5 MB bitmaps per page). In Konva, the base image lives on a dedicated background `Layer`, while grader annotations live on an overlay `Layer`. When a TA draws freehand strokes or drags score badges, only the annotation layer repaints. The underlying scanned page image is never unnecessarily re-rasterized, guaranteeing 60 FPS grading interactions.
2. **React 19 & Next.js Compatibility**:
   By using the core `konva` library within a React lifecycle wrapper (via `useRef` and `useEffect`), we avoid third-party React reconciler synchronization issues while maintaining full control over canvas mounting and teardown.
3. **Zero Runtime Dependencies & Lightweight Footprint**:
   `konva` has zero external runtime dependencies and is delivered as clean ESM, keeping the client bundle lean and eliminating build conflicts.
4. **Built-in Coordinate Projection**:
   Konva provides `stage.getRelativePointerPosition()` which handles all scale, rotation, and pan offsets automatically. This simplifies converting between screen pixels and normalized image coordinates for persistence in MongoDB (`src/models/Annotation.ts`).
5. **Rich Shape Hierarchy & Transformer**:
   Konva's built-in `Transformer` and `Group` primitives will enable score badge resizing, rotation, and comment pin attachments in AE-123/AE-124 with minimal custom code.

---

## Integration Approach

1. **Client Boundary**:
   All canvas components are declared with `'use client'` to prevent SSR execution of browser-only canvas APIs.
2. **Component Architecture**:
   - `CanvasStage`: Encapsulates the container DOM element, Konva `Stage`, responsive `ResizeObserver`, and base layer configuration.
   - `PageImageLayer`: Manages asynchronous loading of the answer-sheet page image, aspect-ratio preservation (`contain`), high-DPI scaling, and rendering onto the image layer.
   - `AnswerSheetCanvas`: The unified high-level component that brings together the stage, image layer, loading indicators, and error fallbacks.
3. **Coordinate & Model Layer (`src/lib/annotations.ts`)**:
   Provides pure mathematical utilities to map between:
   - Screen Canvas Coordinates (pixels)
   - Rendered Image Coordinates (pixels on canvas)
   - Normalized Coordinates (0.0 to 1.0 relative to page width and height)
   Ensures seamless future interoperability with the MongoDB `Annotation` model (`IPosition`).

---

## Future Compatibility

| Capability | Future Ticket | How Konva Foundation Supports It |
|---|---|---|
| **Image Rendering** | AE-122 (Current) | `PageImageLayer` renders scanned pages with aspect ratio preservation and crisp high-DPI scaling. |
| **Pan / Zoom** | AE-123 | `stage.scale()` and `stage.position()` hooks with mouse wheel and drag-to-pan handlers. |
| **Drawing & Pen Annotations** | AE-123 | `Konva.Line` with `tension` for smooth freehand curves and blend modes for highlighter. |
| **Comments & Overlays** | AE-124 | `Konva.Group`, `Konva.Label`, and `Konva.Text` for comment badges and pin markers. |
| **Marks & Score Stamps** | AE-124 | Custom composite `Group` shapes with rubric score badges. |
| **Multi-Page Navigation** | AE-125 | Reusable `AnswerSheetCanvas` instances switched via page state or virtualized page lists. |

---

## Limitations / Trade-offs

1. **Browser-Only Execution**:
   Konva requires DOM and Canvas APIs. It cannot execute during server-side pre-rendering. This is mitigated by enforcing client component boundaries and mounting Konva strictly inside `useEffect` / dynamic client mounts.
2. **Headless Testing Mocking**:
   In Node.js test environments (such as Vitest without a full browser), `HTMLCanvasElement` context methods require standard stubs or mocking. The foundation is modularized so coordinate math and state logic are isolated into pure unit-testable functions.
3. **Memory Management for Multi-Page Batches**:
   When viewing multi-page exam scripts, creating many large Konva stages simultaneously could consume excessive GPU/canvas memory. Future multi-page implementations should recycle or virtualize off-screen canvas instances and call `stage.destroy()` on unmount.
