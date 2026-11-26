# Cross-Browser Compatibility and Input Normalization (AE-234 / PR #361)

> [!NOTE]
> **Status: Implemented Normalizations & Compatibility Baseline**
> Per mentor review guidance on PR #361, this document specifies the browser engine normalization and input handling behaviors that are actively implemented in the codebase. Unimplemented feature descriptions (tier upgrade notices, custom scrollbar-gutter styles, and custom auth cookie overrides) have been removed.

---

## 1. Engine Normalization & Input Handling

The platform handles document annotation, canvas rendering, and stylus interaction across major modern browser engines (Chromium, Gecko, WebKit).

### 1. Stylus & Pointer Pressure Normalization (`src/lib/browserCompatibility.ts`)
- **WebKit / Stylus Quirk**: Safari on iPadOS and macOS occasionally emits `pressure = 0.0` on initial contact before full hardware contact calibration is registered by PointerEvents.
- **Implementation in `PenLayer.tsx`**:
  - `normalizePointerPressure(event)` checks `pointerType`.
  - For `pen`, uncalibrated zero-pressure strokes are assigned a calibrated default ($$0.5$$), and low pressures are bounded ($$0.05 \le p \le 1.0$$), preventing invisible hairline pen strokes.
  - Standard touch inputs without pressure support default to $$0.5$$.
  - Mouse clicks report $$0.5$$ when active and $$0.0$$ when released.

### 2. Touch Gesture Isolation (`src/components/canvas/CanvasStage.tsx`)
- **Touch / Stylus Gesture Interference**: Dragging a stylus or finger across canvas surfaces on touch devices can trigger viewport rubber-banding, scroll bounce, or swipe navigation.
- **Implementation in `CanvasStage.tsx`**:
  - The canvas stage container explicitly sets `touch-action: none` in its inline style.
  - Isolates touch and pointer input strictly to canvas drawing and annotation events.

### 3. Canvas GPU Memory Management on Retina / High-DPI Displays
- **High-DPI Overhead**: Ultra-high DPI screens (e.g. 3x Retina displays) create large backing canvas buffers that can cause GPU memory pressure on mobile devices.
- **Implementation in `CanvasStage.tsx`**:
  - Stage dimensions remain in CSS pixels (`width`, `height`) so that layouts and coordinates are never clipped.
  - Limits `Konva.pixelRatio = Math.min(window.devicePixelRatio, 2)` to cap memory overhead while maintaining high rendering crispness.

### 4. Engine & Platform Detection
- **Detection Utility (`detectBrowserEngine`)**:
  - Identifies browser engines (`chromium`, `gecko`, `webkit`, `unknown`) from `navigator.userAgent`.
  - Detects iPadOS desktop-class Safari using `navigator.maxTouchPoints > 1` on Macintosh platforms.

---

## 2. Core Normalization API Reference (`src/lib/browserCompatibility.ts`)

```typescript
import {
  detectBrowserEngine,
  normalizePointerPressure,
  clampCanvasDimensions,
  getRecommendedCookieOptions
} from '@/lib/browserCompatibility';

// 1. Detect browser engine and platform
const engineInfo = detectBrowserEngine(navigator.userAgent, navigator.maxTouchPoints);

// 2. Normalize stylus/touch pointer pressure in event listeners
const normalizedPointer = normalizePointerPressure(pointerEvent);

// 3. Safe canvas dimensions computation
const dimensions = clampCanvasDimensions(rawWidth, rawHeight, window.devicePixelRatio);
```
