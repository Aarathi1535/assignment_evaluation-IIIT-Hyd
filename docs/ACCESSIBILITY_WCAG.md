# Accessibility Standards Compliance and WCAG 2.1 Level AA Verification (AE-236)

This document establishes the official accessibility compliance report (VPAT structure), automated color contrast verification matrix, screen reader interaction model, and keyboard navigation standards for the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Executive Summary & WCAG 2.1 Level AA Conformance

The platform is evaluated against **WCAG 2.1 Level AA** standards with key Level AAA enhancements (notably Criterion 2.5.5 Target Size).

| Principle | Conformance Level | Current Implementation & Scope |
|-----------|-------------------|--------------------------------|
| **1. Perceivable** | **Supports (AA) with Token Gaps** | Body text meets 4.5:1; high-resolution scanned page rendering; responsive zoom to 200%. Note: palette audits identified contrast gaps in production CSS tokens (`--color-brand-secondary` and `--color-text-light`). |
| **2. Operable** | **Supports (AA)** | Core workflows navigable via keyboard; no keyboard traps in standard components; visible focus indicators; min 44×44px touch targets. |
| **3. Understandable** | **Supports (AA)** | Declared `lang="en"`; explicit form input labels; clear error messages with ARIA live region announcements (`aria-live="polite"` / `aria-live="assertive"`). |
| **4. Robust** | **Supports (AA)** | Semantic HTML5 markup and valid ARIA live region attributes across web browsers. |

---

## 2. Color Palette Contrast Verification Matrix

All core UI color pairs have been validated using the official W3C relative luminance formula ($L = 0.2126R + 0.7152G + 0.0722B$):

| Element Description | Foreground Hex | Background Hex | Contrast Ratio | WCAG AA Req | WCAG AAA Req | Compliance Status |
|---------------------|----------------|----------------|----------------|-------------|--------------|-------------------|
| **Body Primary Text** | `#111827` (Slate 900) | `#FFFFFF` (White) | **17.74 : 1** | 4.5 : 1 | 7.0 : 1 | **Passes AAA** |
| **Body Secondary Text** | `#374151` (Gray 700) | `#FFFFFF` (White) | **10.31 : 1** | 4.5 : 1 | 7.0 : 1 | **Passes AAA** |
| **Muted Caption Text** | `#4B5563` (Gray 600) | `#FFFFFF` (White) | **7.56 : 1** | 4.5 : 1 | 7.0 : 1 | **Passes AAA** |
| **Primary Action Button**| `#FFFFFF` (White) | `#2563EB` (Blue 600) | **5.17 : 1** | 4.5 : 1 | 4.5 : 1 (Lg) | **Passes AA (AAA for Large Text)** |
| **Danger / Flag Button** | `#FFFFFF` (White) | `#DC2626` (Red 600) | **4.83 : 1** | 4.5 : 1 | 4.5 : 1 (Lg) | **Passes AA (AAA for Large Text)** |
| **Success / Approved (Normal Text)**| `#FFFFFF` (White) | `#15803D` (Green 700) | **5.02 : 1** | 4.5 : 1 | 4.5 : 1 (Lg) | **Passes AA (AAA for Large Text)** |
| **Success / Approved (UI/Large Text)**| `#FFFFFF` (White) | `#16A34A` (Green 600) | **3.30 : 1** | 3.0 : 1 (UI) | — | **Passes AA for UI & Large Text; Fails Normal Text (< 4.5:1)** |
| **UI Form Borders / Controls** | `#767676` (Gray 500) | `#FFFFFF` (White) | **4.54 : 1** | 3.0 : 1 (UI) | — | **Passes AA (UI Component & Normal Text)** |
| **Focus Indicator Ring**| `#2563EB` (Blue 600) | `#FFFFFF` (White) | **5.17 : 1** | 3.0 : 1 (UI) | — | **Passes AA (UI Component)** |

> [!NOTE]
> **Production CSS Theme Token Audit (`src/app/globals.css`)**:
> Two production tokens fail WCAG 2.1 AA requirements on white surfaces:
> - Secondary Button: White on `--color-brand-secondary` (`#10b981`, Emerald 500) yields **2.54 : 1** (fails 4.5:1 AA for normal text and 3:1 for large text).
> - Light / Placeholder text: `--color-text-light` (`#94a3b8`, Slate 400) on white yields **2.56 : 1** (fails 4.5:1 AA for normal body text).
> A targeted follow-up PR is recommended to adjust these two CSS tokens across the design system once agreed with mentors.

---

## 3. Keyboard Navigation & Non-Mouse Grading

Standard interactive controls in the application follow accessible DOM navigation conventions:

```
[Tab] / [Shift+Tab] ────────► Navigate between interactive controls in natural DOM order
[Enter] / [Space]   ────────► Activate button, select rubric criterion, or submit grade
[Escape]            ────────► Close modal or cancel selection
```

### Keyboard & Focus Safeguards:
1. **Focus Ring Visibility**: Interactive elements maintain distinct focus styles (`ring-2 ring-blue-600 ring-offset-2`) to support visual keyboard tracking.
2. **Shortcut Conflict Guard**: `validateKeyboardShortcut` prevents shortcut registrations from colliding with active browser defaults (e.g. F5, Ctrl+W, Ctrl+T).

---

## 4. Screen Reader Integration & Live Regions

### Asynchronous Status Updates (`aria-live`)
When background events or user actions complete, ARIA live region helpers construct appropriate notification attributes:

```html
<!-- Non-interruptive notifications (status updates) -->
<div aria-live="polite" role="status" aria-atomic="true">
  Autosave status: saved
</div>

<!-- Critical alerts (submission failure, network drop) -->
<div aria-live="assertive" role="alert" aria-atomic="true">
  Network connection lost. Offline draft preserved locally.
</div>
```

---

## 5. Automated Verification Strategy

The automated test suite (`src/__tests__/AccessibilityWcagAE236.test.ts`) verifies:
1. Relative luminance calculations against W3C reference test vectors.
2. Contrast ratios for palette colors and production CSS tokens.
3. Accurate ARIA live region attribute formatting.
4. Keyboard shortcut conflict detection and browser-native key intercept prevention.
