# Accessibility Standards Compliance and WCAG 2.1 Level AA Verification (AE-236)

This document establishes the official accessibility compliance report (VPAT structure), automated color contrast verification matrix, screen reader interaction model, and keyboard navigation standards for the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Executive Summary & WCAG 2.1 Level AA Conformance

The platform is engineered to meet **WCAG 2.1 Level AA** standards with key Level AAA enhancements (notably Criterion 2.5.5 Target Size).

| Principle | Conformance Level | Key Features & Mitigations |
|-----------|-------------------|----------------------------|
| **1. Perceivable** | **Supports (AA)** | Minimum text contrast 4.5:1; high-resolution scanned page alternatives; semantic landmarks; responsive zoom to 200%. |
| **2. Operable** | **Supports (AA + AAA)** | 100% keyboard operable; no keyboard traps; skip-to-content links; visible focus indicators; min 44×44px touch targets. |
| **3. Understandable** | **Supports (AA)** | Declared `lang="en"`; explicit form input labels; clear error messages with ARIA live region announcements. |
| **4. Robust** | **Supports (AA)** | W3C semantic HTML5 markup; valid ARIA roles and states; verified across VoiceOver, NVDA, and JAWS screen readers. |

---

## 2. Color Palette Contrast Verification Matrix

All core UI color pairs have been validated using the official W3C relative luminance formula ($$L = 0.2126R + 0.7152G + 0.0722B$$):

| Element Description | Foreground Hex | Background Hex | Contrast Ratio | WCAG AA Req | WCAG AAA Req | Compliance Status |
|---------------------|----------------|----------------|----------------|-------------|--------------|-------------------|
| **Body Primary Text** | `#111827` (Slate 900) | `#FFFFFF` (White) | **17.74 : 1** | 4.5 : 1 | 7.0 : 1 | **Passes AAA** |
| **Body Secondary Text** | `#374151` (Gray 700) | `#FFFFFF` (White) | **10.31 : 1** | 4.5 : 1 | 7.0 : 1 | **Passes AAA** |
| **Muted Caption Text** | `#4B5563` (Gray 600) | `#FFFFFF` (White) | **7.56 : 1** | 4.5 : 1 | 7.0 : 1 | **Passes AAA** |
| **Primary Action Button**| `#FFFFFF` (White) | `#2563EB` (Blue 600) | **5.17 : 1** | 4.5 : 1 | 4.5 : 1 (Lg) | **Passes AA (AAA for Large Text)** |
| **Danger / Flag Button** | `#FFFFFF` (White) | `#DC2626` (Red 600) | **4.83 : 1** | 4.5 : 1 | 4.5 : 1 (Lg) | **Passes AA (AAA for Large Text)** |
| **Success / Approved (Normal Text)**| `#FFFFFF` (White) | `#15803D` (Green 700) | **4.56 : 1** | 4.5 : 1 | 4.5 : 1 (Lg) | **Passes AA** |
| **Success / Approved (UI/Large Text)**| `#FFFFFF` (White) | `#16A34A` (Green 600) | **3.30 : 1** | 3.0 : 1 (UI) | — | **Passes AA for UI & Large Text; Fails Normal Text (< 4.5:1)** |
| **UI Form Borders / Controls** | `#767676` (Gray 500) | `#FFFFFF` (White) | **4.54 : 1** | 3.0 : 1 (UI) | — | **Passes AA (UI Component & Normal Text)** |
| **Focus Indicator Ring**| `#2563EB` (Blue 600) | `#FFFFFF` (White) | **5.17 : 1** | 3.0 : 1 (UI) | — | **Passes AA (UI Component)** |

*Note: Gray 500 (`#767676`) or darker is enforced for all interactive controls and borders. For normal body text, green buttons must use Green 700 (`#15803D`, 4.56:1) to satisfy AA; Green 600 (`#16A34A`, 3.30:1) is reserved for large headings and UI icons/components only.*

---

## 3. Keyboard Navigation & Non-Mouse Grading

The entire grading lifecycle and student result viewer are fully operable via keyboard without mouse interaction:

```
[Tab] / [Shift+Tab] ────────► Navigate between interactive controls in natural DOM order
[Enter] / [Space]   ────────► Activate button, select rubric criterion, or submit grade
[Escape]            ────────► Close modal, cancel selection, or dismiss annotation tool
[ArrowUp / Down]    ────────► Increase or decrease question marks in score stepper
[P]                 ────────► Switch to Pen Annotation Tool
[E]                 ────────► Switch to Eraser Tool
[S]                 ────────► Cycle Stamp Tools (Tick / Cross)
[N] / [B]           ────────► Next Page / Previous Page navigation
```

### Keyboard Safeguards:
1. **Focus Ring Visibility**: Every interactive control receives an unambiguous `2px solid #2563EB` focus ring with a 2px offset (`ring-2 ring-blue-600 ring-offset-2`).
2. **Focus Traps in Modals**: When confirmation dialogs open (e.g. Publish Grades, Flag Script), focus is trapped within the dialog until dismissed, preventing background interaction.
3. **Skip-to-Content Link**: A high-priority bypass link (`<a href="#main-content" class="sr-only focus:not-sr-only">Skip to main content</a>`) appears upon the first `Tab` press on every page.

---

## 4. Screen Reader Integration (NVDA, VoiceOver, JAWS)

### Asynchronous Status Updates (`aria-live`)
When a grader updates rubric points or saves an offline draft, visual banners are accompanied by non-intrusive ARIA live regions:

```html
<!-- Non-interruptive notifications (score update, draft saved) -->
<div aria-live="polite" role="status" aria-atomic="true" class="sr-only">
  Marks updated: Question 2 score set to 8 out of 10.
</div>

<!-- Critical alerts (submission failure, network drop) -->
<div aria-live="assertive" role="alert" aria-atomic="true">
  Network connection lost. Offline draft preserved locally.
</div>
```

### Canvas & Scanned Page Semantics
Because raw `<canvas>` pixels are inaccessible to screen readers, each page renders an accessible DOM tree of annotations alongside the canvas:
- Each annotation renders an accessible hidden text element detailing:
  `Page {pageNumber}, Question {questionNumber}: {annotationType} by {author} at {coordinates} with note "{commentText}"`.
- Screen reader users can navigate through annotations linearly via standard virtual cursor navigation.

---

## 5. Automated Verification Strategy

The automated test suite (`src/__tests__/AccessibilityWcagAE236.test.ts`) verifies:
1. Relative luminance calculations against W3C reference test vectors.
2. Contrast ratios for all core color pairings across AA and AAA thresholds.
3. Accurate ARIA live region attribute formatting.
4. Keyboard shortcut conflict detection and browser-native key intercept prevention.
