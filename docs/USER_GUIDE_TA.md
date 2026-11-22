# Teaching Assistant (TA) User Guide: IIIT Hyderabad Assignment Evaluation Platform

Welcome to the Teaching Assistant Grading Manual. This guide provides comprehensive operational instructions for navigating your assigned grading queues, utilizing interactive canvas annotation tools, leveraging keyboard shortcuts, managing offline drafts, and escalating anomalous student submissions.

---

## 1. Accessing Your Assigned Grading Queue

1. Log in to the platform with your credentials at `/login`.
2. Navigate to the **TA Dashboard** (`/ta`).
3. Your assigned examination questions and pending script allocations will be displayed.
4. Click on an allocated script to enter the **Grading Canvas Workspace** (`/grading/[scriptId]`).

> [!NOTE]
> Student identities and roll numbers are completely anonymized in the TA interface to eliminate unconscious grading bias.

---

## 2. Interactive Grading Canvas & Annotation Tools

The evaluation canvas displays high-resolution rendered exam pages with full hardware stylus, touch, and mouse support:

| Tool | Hotkey | Functionality | Primary Use Case |
|------|--------|---------------|------------------|
| **Pen Tool** | `P` | Freehand digital ink drawing with hardware pressure sensitivity. | Underlining steps, circling errors, or writing handwritten feedback. |
| **Eraser Tool** | `E` | Precision stroke eraser. Click or drag over any annotation to delete it. | Removing accidental pen strokes. |
| **Check Stamp** | `C` | Quick green checkmark (`✓`) stamp. | Acknowledging correct steps. |
| **Cross Stamp** | `X` | Quick red cross (`✗`) stamp. | Indicating incorrect derivations. |
| **Highlighter** | `H` | Semi-transparent yellow highlight box. | Highlighting important text sections. |
| **Text Note** | `T` | Attaches a typed sticky comment callout bubble. | Detailed rubric feedback explanations. |
| **Select Tool** | `V` / `S` | Select, move, or delete canvas annotations. | Repositioning stamps or notes. |
| **Magnifier Loupe** | `M` / `L` | Toggle interactive floating magnifier loupe. | Inspecting compact handwriting or diagrams. |

---

## 3. High-Velocity Keyboard Shortcuts

To maximize grading efficiency, the canvas provides single-key shortcuts from the authoritative shortcut map:

```
[Enter]             ────────► Save current question marks and feedback as draft
[Ctrl+Enter]        ────────► Finalize and submit evaluation for the current question
[P]                 ────────► Activate Pen Tool
[E]                 ────────► Activate Eraser Tool
[C]                 ────────► Activate Check Stamp (✓)
[X]                 ────────► Activate Cross Stamp (✗)
[H]                 ────────► Activate Highlighter Tool
[T]                 ────────► Activate Text Note Tool
[V] / [S]           ────────► Activate Select Tool
[M] / [L]           ────────► Toggle Magnifier Loupe
[Alt + Down] / [J]  ────────► Navigate to Next Page within the script
[Alt + Up] / [K]    ────────► Navigate to Previous Page within the script
[Q]                 ────────► Advance to Next Question
[Shift + Q]         ────────► Return to Previous Question
[+] / [-]           ────────► Zoom In / Zoom Out
[0]                 ────────► Reset Zoom to Fit
[R] / [Shift + R]   ────────► Rotate Canvas Clockwise / Counter-Clockwise
[Alt + R]           ────────► Reset all view transforms (pan, zoom, rotation)
[O]                 ────────► Toggle annotation overlay visibility
[?]                 ────────► Open keyboard shortcuts help overlay
[Ctrl + Z]          ────────► Undo last annotation
[Ctrl + Y]          ────────► Redo last annotation
```

---

## 4. Offline Drafts & Automatic Network Synchronization

Grading continuity is protected against campus Wi-Fi interruptions:
- **Local Storage Buffering**: Every annotation stroke, rubric score selection, and feedback note is automatically persisted to `localStorage` with in-memory fallback.
- **Sync Status Indicators**:
  - 🟢 **Synced**: All grades and annotations successfully committed to the database.
  - 🟡 **Syncing...**: Submissions are actively uploading in the background.
  - 🔴 **Offline Draft**: Internet connection interrupted. You may continue grading uninterrupted; all changes will synchronize automatically once reconnected.

---

## 5. Flagging Anomalous or Illegible Scripts

If you encounter an issue that prevents fair evaluation:
1. Click the **Flag Script** button in the canvas toolbar.
2. Select the flag category:
   - **Illegible Handwriting / Dark Scan**: Pages cannot be deciphered.
   - **Suspected Malpractice**: Identical derivation patterns or unapproved notes.
   - **Missing / Out-of-Order Answers**: Question answers written in unconventional sections.
3. Enter explanatory notes detailing the observation.
4. Submit the flag. The script is routed to the Professor's review queue (`/professor/flags`), and your grading workspace advances to the next script.
