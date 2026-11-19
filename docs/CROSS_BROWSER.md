# Cross-Browser Compatibility Matrix and Engine Normalization (AE-234)

This document establishes the official browser support tiers, engine-specific quirks, normalization strategies, and automated compatibility verification procedures for the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Browser Support Tiers

| Tier | Browser Engine | Platform | Min Version | Support Level |
|------|----------------|----------|-------------|---------------|
| **Tier 1** | **Chromium** (Blink) | Chrome (Win/macOS/Linux) | v110+ | **Full Support**: Reference browser for grading & admin. |
| **Tier 1** | **Chromium** (Blink) | Microsoft Edge (Win/macOS) | v110+ | **Full Support**: Campus enterprise standard. |
| **Tier 1** | **Gecko** | Mozilla Firefox (Win/macOS/Linux) | v115+ (ESR) | **Full Support**: Open source standard. |
| **Tier 1** | **WebKit** | Apple Safari (macOS & iPadOS) | v16+ | **Full Support**: Primary hardware stylus environment (Apple Pencil). |
| **Tier 2** | **Chromium** (Blink) | Chrome for Android | v110+ | **Functional**: Student script review and regrade submission. |
| **Tier 2** | **WebKit** | Mobile Safari (iOS) | v16+ | **Functional**: Student script viewing; grading canvas restricted. |
| **Tier 3** | Legacy / Embedded | Internet Explorer, Opera Mini | Any | **Unsupported**: Redirected to browser upgrade notice. |

---

## 2. Engine-Specific Quirks & Technical Mitigations

### 1. WebKit (Safari macOS & iPadOS)

- **Symptom 1: Stylus Pressure Reporting Inconsistency**
  - *Quirk*: When using an Apple Pencil or passive stylus, Safari occasionally reports `pressure = 0.0` or `0.0` for `pointerdown` events before full hardware contact is registered.
  - *Mitigation*: `normalizePointerPressure` detects `pointerType: 'pen'` and substitutes a calibrated default pressure ($$0.5$$) or clamps low pressure values ($$0.05 \le p \le 1.0$$), preventing invisible hairline pen strokes.
- **Symptom 2: Maximum Canvas Allocation Limit**
  - *Quirk*: Mobile Safari and iPadOS terminate the GPU process or crash the tab if a single HTML5 `<canvas>` exceeds 16,777,216 pixels ($$4096 \times 4096$$) or total memory exceeds hardware GPU bounds.
  - *Mitigation*: `clampCanvasDimensions` intercepts canvas allocations, reducing `devicePixelRatio` to 1.0 if memory budget is exceeded, and downscales oversized documents while maintaining exact aspect ratios.
- **Symptom 3: Viewport Rubber-Banding during Handwriting**
  - *Quirk*: Dragging a stylus across the canvas triggers native Safari gesture bounce and swipe navigation.
  - *Mitigation*: The canvas container explicitly specifies `touch-action: none` and calls `event.preventDefault()` on all Pointer Events.

### 2. Gecko (Mozilla Firefox)

- **Symptom 1: Layout Shift on Dynamic Annotation Scrollbars**
  - *Quirk*: Firefox renders non-overlay scrollbars by default on Windows and Linux, causing 15px layout recalculations when annotation lists overflow.
  - *Mitigation*: Global CSS specifies `scrollbar-gutter: stable` and `scrollbar-width: thin` to reserve scrollbar tracks deterministically.
- **Symptom 2: High-DPI Sub-pixel Stroke Aliasing**
  - *Quirk*: Firefox applies sharp anti-aliasing algorithms that render high-frequency pen strokes differently than Chromium.
  - *Mitigation*: Canvas rendering uses integer-snapped coordinate transforms and explicit stroke smoothing buffers.

### 3. Chromium (Google Chrome & Microsoft Edge)

- **Hardware Acceleration**: Serves as the primary reference implementation for HTML5 Canvas 2D and Konva layer composition.
- **Pointer Events**: Fully complies with W3C Pointer Events Level 3, reporting continuous `pressure`, `tiltX`, and `tiltY` parameters.

---

## 3. Session Cookie & Cross-Site Authentication

The platform authenticates users via NextAuth session tokens:
- **SameSite Policy**: `SameSite=Lax` is enforced across all environments.
  - Allows top-level navigation (e.g. following email links to review published exam results).
  - Blocks cross-site request forgery (CSRF) in third-party iframe contexts.
- **Secure Flag**: Automatically enabled in staging and production HTTPS environments (`secure: true`).
- **HttpOnly Flag**: Strictly enforced (`httpOnly: true`) to prevent client-side JavaScript access to authentication credentials.

---

## 4. Normalization Utility (`src/lib/browserCompatibility.ts`)

The platform includes a zero-dependency normalization library with three core functions:

```typescript
// 1. Engine & Tier Detection
const { name, engine, tier, isIPadOS } = detectBrowserEngine(navigator.userAgent, navigator.maxTouchPoints);

// 2. Cross-Browser Pointer Pressure Normalization
const { pressure, hasPressureSupport } = normalizePointerPressure(event);

// 3. Safe Canvas Dimension Clamping
const { width, height, dpr } = clampCanvasDimensions(rawWidth, rawHeight, window.devicePixelRatio);
```

---

## 5. Automated Verification Strategy

Automated test suite (`src/__tests__/CrossBrowserAE234.test.ts`) verifies:
1. Accurate parsing of Chromium, Gecko, WebKit, and iPadOS User-Agent profiles.
2. Normalization of zero-pressure stylus events and standard touch inputs.
3. Canvas dimension downscaling when exceeding the 16.7M pixel WebKit threshold.
4. Cookie configuration conformity with secure deployment guidelines.
