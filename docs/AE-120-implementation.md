# AE-120: Accessibility Pass on Dashboards Implementation Report

## Objective
Perform an accessibility audit and hardening pass across the professor and TA dashboard interfaces in accordance with WCAG 2.1 AA standards, ensuring full keyboard navigation, logical focus management, meaningful accessible names, semantic HTML structure, and assistive technology support without redesigning dashboard layouts or modifying backend/API behavior.

---

## Existing Dashboard Architecture Preserved
The accessibility pass preserved all previous completed features and behaviors without modification:
- **AE-106**: Professor per-TA live grading progress, timing metadata, SSE stream parsing, and visual progress bars.
- **AE-107**: Overall grading summary metrics, completion ratios, and naive ETA calculations.
- **AE-108**: TA workload drill-down view and script-level timing stats.
- **AE-109**: Production hardening states (loading, empty, error, degraded mode alert banners).
- **AE-110 / AE-112 / AE-113**: Reassignment modal and controls, restriction to pending scripts, and audit history.
- **AE-111 / AE-117**: TA notifications, unread badges, mark-as-read/mark-all-as-read actions, and templates.
- **AE-116**: Professor activity feed.
- **AE-118**: 20-TA load test stability.
- **AE-119**: Allocation bug hardening.

---

## Accessibility Audit Summary & Areas Reviewed

| Area / Component | File | Issues Identified | Resolution Applied |
| :--- | :--- | :--- | :--- |
| **Global Dashboard Layout** | `src/app/(dashboard)/layout.tsx` | 1. No skip-to-main-content mechanism.<br>2. Missing target `id="main-content"` on `<main>`.<br>3. Mobile menu button and drawer needed dialog semantics and focus outlines. | 1. Added skip-to-main-content link (`sr-only` until focused).<br>2. Added `id="main-content"` and `tabIndex={-1}` to `<main>`.<br>3. Added `role="dialog"`, `aria-modal="true"`, and `aria-label="Mobile Navigation"` to mobile drawer. |
| **Loading Spinner** | `src/components/ui/LoadingSpinner.tsx` | Lacked `role="status"` and visually hidden descriptive text for screen readers. | Added `role="status"`, `aria-hidden="true"` on SVG icon, and `<span className="sr-only">Loading...</span>`. |
| **TA Live Progress View** | `src/components/TaLiveProgressView.tsx` | 1. Per-TA drill-down cards used `onClick` on non-interactive `<Card>` without keyboard support.<br>2. Table headers lacked `scope="col"`.<br>3. Status alerts lacked explicit live region announcements. | 1. Added `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space), focus ring, and descriptive `aria-label`.<br>2. Added `scope="col"` to all `<th>` elements.<br>3. Added `aria-live="polite"` on status updates and `aria-live="assertive"` on error alerts. |
| **Notification Panel** | `src/components/NotificationPanel.tsx` | 1. Modal backdrop lacked keyboard `Escape` dismissal.<br>2. Unread notification counts lacked screen-reader clarity. | 1. Added `useEffect` keydown listener for `Escape` key to dismiss modal.<br>2. Added aria-labels and descriptive text for actions and close buttons. |
| **Reassign Modal** | `src/components/ReassignModal.tsx` | Modal dialog could not be dismissed using the `Escape` key. | Added `useEffect` keydown listener for `Escape` key dismissing dialog cleanly when not submitting. |
| **TA Work Queue Page** | `src/app/(dashboard)/ta/page.tsx` | 1. Table headers lacked `scope="col"`.<br>2. Unread notification badge lacked accessible description. | 1. Added `scope="col"` to all table headers.<br>2. Added `aria-label` to notifications button indicating unread counts. |
| **Allocation Configuration** | `src/components/AllocationView.tsx` | 1. Method selector buttons lacked radio semantics.<br>2. TA selector buttons lacked checkbox semantics.<br>3. Preview tables lacked `scope="col"`. | 1. Added `role="radiogroup"` container with `role="radio"` and `aria-checked`.<br>2. Added `role="group"` container with `role="checkbox"` and `aria-checked`.<br>3. Added `scope="col"` to preview table headers and reused shared `LoadingSpinner`. |
| **Professor Exams Page** | `src/app/(dashboard)/professor/exams/page.tsx` | 1. Delete button was icon-only without accessible name.<br>2. Delete confirmation dialog lacked `Escape` key listener and dialog attributes. | 1. Added `aria-label="Delete exam [title]"` and `aria-hidden="true"` on trash icon.<br>2. Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and `Escape` key dismissal. |

---

## Keyboard Navigation & Focus Results
- **Skip Navigation**: Keyboard users pressing `Tab` upon landing on any dashboard page immediately receive focus on "Skip to main content", allowing them to bypass the sidebar navigation links.
- **Interactive Cards**: Per-TA progress cards can be focused via `Tab` and activated using `Enter` or `Space` to inspect workload details.
- **Modal Dialogs**: `NotificationPanel`, `ReassignModal`, and Delete confirmation dialogs can be opened, navigated, and dismissed cleanly using `Escape` or the close button without creating keyboard traps.
- **Focus Rings**: Visual focus indicators (`focus:ring-2`, `focus:outline-none`) have been added to all custom interactive controls and buttons.

---

## Semantic Structure & Accessible Names
- Used native HTML `<button>`, `<a>`, and `<main>` semantics wherever possible.
- Added `scope="col"` across all data tables (`ta-scripts-table`, `TA Work Queue`, `Counts per TA`, `Exclusion Summary`).
- Added meaningful `aria-label` attributes to icon-only buttons (delete, close, menu toggle, notifications badge).
- Implemented `role="radiogroup"` / `role="radio"` for allocation rules and `role="checkbox"` for TA selection list.
- Applied `aria-live="polite"` and `aria-live="assertive"` for dynamic feedback banners.

---

## Automated & Regression Tests
Added test suite: `src/__tests__/DashboardAccessibilityAE120.test.ts`
- Verifies accessible TA progress label formatting (`"TA name — graded / total"`).
- Verifies percentage calculations bounded between 0% and 100%.
- Verifies overall grading summary metrics formatting.
- Verifies accessible ETA description outputs for all valid and degraded states.
- Verifies script timing calculations and human-friendly duration formatting.
- Verifies replacement TA filtering logic and eligibility rules.
- Verifies reassignable status checks (only `PENDING`).
- Verifies screen-reader friendly reassignment scope and success messages.

Validation command results:
- `npx vitest run src/__tests__/DashboardAccessibilityAE120.test.ts src/__tests__/TaLiveProgressUI.test.ts src/__tests__/TaWorkQueueUI.test.ts src/__tests__/AllocationReassignmentUI.test.ts`: **41 tests passed (100% pass rate)**.
- `npx tsc --noEmit`: **0 errors**.
- `npm run lint`: **0 errors**.
- `git diff --check`: **Clean (0 errors)**.

---

## Remaining Limitations / Scope Boundaries
- **No Backend Changes**: As constrained by AE-120, backend API schemas and SSE data structures remained completely untouched.
- **Browser Native Controls**: Standard form select elements and inputs retain native browser keyboard behavior and styling consistent with the existing brand tokens.
