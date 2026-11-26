# Tablet & Hardware Stylus Input Validation and Palm Rejection (AE-235)

This document establishes the hardware verification matrix, palm rejection architecture, pressure curve mapping, and ergonomic touch-target standards for tablet-based script evaluation on the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Executive Summary & Ergonomic Objectives

Grading handwritten examination scripts on tablets with active styluses offers high grading speed while preserving natural ink handwriting. The evaluation platform aims for:
- **Responsive Ink Rendering**: Low-latency canvas event dispatch to keep handwriting perception smooth and natural.
- **Palm Rejection Filtering**: Suppression of resting palm smudges and unintentional canvas gestures while the stylus is actively drawing or within a cooldown window.
- **Ergonomic Sizing**: Minimum interactive button targets of **44 × 44 CSS pixels** adhering to WCAG 2.1 AAA accessibility requirements to prevent grading fatigue.

---

## 2. Hardware Compatibility Matrix & Verification Status

> [!NOTE]
> Physical tablet verification across live Android hardware remains pending. Browser-level pointer-event handling and contact-area heuristics have been verified in software unit tests; live physical device testing on Android tablets is required to evaluate fingertip width/height variability.

| Device Category | Stylus Technology | Status | Notes |
|-----------------|-------------------|--------|-------|
| **Apple iPad / Safari (WebKit)** | Apple Pencil | Target Architecture | Handled via Pointer Events (`pointerType === 'pen'`); zero-pressure initial contact coordinates with #361 by falling back to 0.5. |
| **Android Tablets (Chrome)** | Active Stylus (e.g. S-Pen / USI) | Target Architecture | Requires verification on physical devices; the 400 px² contact-area threshold may require tuning for normal fingertips on Android. |
| **Generic Capacitive / Touch** | Passive / Fingertip | Fallback | Palm rejection cooldown active; pressure default fixed at 0.5. |

### Note on Android Contact Area Cut-Off
The contact-area heuristic currently rejects touch events where `width × height > 400 px²`. On certain Android devices and digitizers, normal fingertip touch events report width and height dimensions that can exceed 400 px² depending on angle of contact and screen calibration. Physical device testing is needed to calibrate this threshold or combine it with eccentricity / aspect ratio heuristics before making it strict.

---

## 3. Palm Rejection Architecture

```
                 Incoming Hardware Event (pointerdown)
                                 │
                                 ▼
                     Is event.pointerType == 'pen'?
                                 │
                 ┌───────────────┴───────────────┐
                 │ YES                           │ NO (touch / mouse)
                 ▼                               ▼
       ┌───────────────────┐          Is pointerType == 'touch'?
       │ Set Active Stylus │                     │
       │ Record Timestamp  │           ┌─────────┴─────────┐
       │ Accept & Draw Ink │           │ YES               │ NO (mouse)
       └───────────────────┘           ▼                   ▼
                          Is Stylus Active OR        Accept Mouse Event
                          Within Cooldown (<400ms)?
                                       │
                       ┌───────────────┴───────────────┐
                       │ YES                           │ NO
                       ▼                               ▼
             ┌───────────────────┐           Is Contact Area > 400px²?
             │ REJECT TOUCH      │           (Palm Heel Heuristic)
             │ Reason:           │                     │
             │ PALM_REJECTION    │             ┌───────┴───────┐
             └───────────────────┘             │ YES           │ NO
                                               ▼               ▼
                                     ┌───────────────────┐  Accept Touch
                                     │ REJECT TOUCH      │  (Fingertip)
                                     │ Reason:           │
                                     │ PALM_CONTACT_SIZE │
                                     └───────────────────┘
```

### Dual-Layer Filtering Mechanism:
1. **Temporal Cooldown Filter**: When a stylus lifts from the glass, an active cooldown window of **400 ms** is initiated. Any touch contact during this window (which almost invariably occurs when the user repositions their hand) is discarded.
2. **Contact Geometry Filter**: Modern touch digitizers report touch bounding geometry via `event.width` and `event.height`. Touch contact exceeding **400 px²** is classified as a resting palm heel and rejected.

---

## 4. Pressure Response Curve Mapping

Raw digitizer pressure ranges continuously from 0.0 to 1.0. To emulate physical pens while preventing grader muscular strain, `StylusInputManager` provides configurable transfer functions:

```
Pressure Output
  1.0 ┌───────────────────────────────┐
      │                  . - ' ' ' ─  │  Ease-Out (Default: √x) - Low effort
      │            . - '              │
      │        . '         /          │  Linear (x) - Proportional
      │     . '          /            │
      │   . '          /    . - '     │  Ease-In (x²) - Fine line precision
      │  /           /  . - '         │
  0.0 └────────────/──────────────────┘
     0.0                             1.0  Raw Pressure Input
```

1. **Ease-Out Curve ($P(x) = \sqrt{x}$) [Default]**:
   - Produces clear, readable annotation strokes with light touch pressure.
   - Designed to reduce hand strain during long grading sessions.
   - Coordinates with #361: uncalibrated zero pressure (`event.pressure === 0`) falls back to `0.5` so initial stylus contact produces visible ink.
2. **Linear Curve ($P(x) = x$)**:
   - Direct 1:1 proportionality with hardware force sensors.
3. **Ease-In Curve ($P(x) = x^2$)**:
   - Requires deliberate physical pressure to expand line thickness; suitable for fine numerical grading and marginal subscript annotations.
4. **Sigmoid Curve**:
   - S-curve with sharp acceleration around median pressure ($x = 0.5$).

---

## 5. Ergonomic Touch-Target Sizing

In accordance with **WCAG 2.1 AAA Target Size (Criterion 2.5.5)**:
- All interactive controls (pen tool, eraser tool, checkmark stamps, color pickers, score counters, question navigation) must occupy at least **44 × 44 CSS pixels**.
- Adjacent touch targets must maintain a minimum **8px margin spacing** to prevent unintended tool switches during rapid handheld grading.
- The `StylusInputManager.validateTouchTarget(w, h)` utility validates control dimensions in component unit tests.
