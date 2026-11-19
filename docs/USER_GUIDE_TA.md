# Teaching Assistant (TA) User Guide: IIIT Hyderabad Assignment Evaluation Platform

Welcome to the Teaching Assistant Grading Manual. This guide provides comprehensive operational instructions for navigating your assigned grading queues, utilizing interactive canvas annotation tools, leveraging keyboard shortcuts, managing offline drafts, and escalating anomalous student submissions.

---

## 1. Accessing Your Assigned Grading Queue

1. Log in to the platform with your TA credentials at `https://eval.iiit.ac.in`.
2. Select your course from the dashboard and click **Grading Workspace** (`/grading/queue`).
3. Your assigned questions and pending answer booklets appear in the queue.
4. Click **Start Grading** on any assigned task.

> [!NOTE]
> Student identities and roll numbers are completely anonymized in the TA interface to eliminate unconscious grading bias.

---

## 2. Interactive Grading Canvas & Annotation Tools

The evaluation canvas displays high-resolution rendered exam pages with full hardware stylus, touch, and mouse support:

| Tool | Icon / Key | Functionality | Primary Use Case |
|------|------------|---------------|------------------|
| **Pen Tool** | `P` | Freehand digital ink drawing with hardware pressure sensitivity. | Underlining steps, circling errors, or writing numerical feedback. |
| **Eraser Tool** | `E` | Precision stroke eraser. Click or swipe over any annotation to delete it. | Correcting accidental marks. |
| **Checkmark Stamp**| `S` (Cycle) | Quick green checkmark (`✓`) stamp. | Acknowledging correct steps. |
| **Cross Stamp** | `S` (Cycle) | Quick red cross (`✗`) stamp. | Indicating incorrect derivations. |
| **Comment Tag** | `T` | Attaches a callout text feedback bubble at the clicked coordinate. | Detailed explanation of deductions. |
| **Pan & Zoom** | Two-finger pinch or Scroll wheel | Navigates across high-resolution pages without quality loss. | Inspecting compact handwriting or diagrams. |

---

## 3. High-Velocity Keyboard Shortcuts

To maximize grading speed and reduce physical mouse movements, the workspace provides single-key shortcuts:

```
[Tab] / [Shift+Tab] ────────► Move between rubric score criteria
[Up / Down Arrow]   ────────► Increment or decrement question marks by score step
[Enter]             ────────► Submit current page evaluation and advance to next script
[P]                 ────────► Activate Pen Tool
[E]                 ────────► Activate Eraser Tool
[S]                 ────────► Toggle between Stamp Tools (Check / Cross)
[N]                 ────────► Navigate to Next Page within the current script
[B]                 ────────► Navigate to Previous Page within the current script
[Esc]               ────────► Dismiss active comment modal or cancel drawing
```

---

## 4. Offline Drafts & Automatic Network Synchronization

Grading continuity is fully protected against campus Wi-Fi interruptions:
- **Local Storage Buffering**: Every annotation, rubric score selection, and feedback note is automatically saved in browser IndexedDB within **10 ms** of input.
- **Sync Status Indicators**:
  - 🟢 **Green ("Synced")**: All grades and annotations successfully committed to the database.
  - 🟡 **Yellow ("Syncing...")**: Submissions are actively syncing in the background.
  - 🔴 **Red ("Offline Draft")**: Internet connection lost. You may continue grading uninterrupted; all changes will sync automatically upon reconnection.

---

## 5. Flagging Anomalous or Illegible Scripts

If you encounter an issue that prevents fair evaluation:
1. Click the **Flag Script** button in the canvas toolbar (or press `Ctrl+F`).
2. Select the flag category:
   - **Illegible Handwriting / Dark Scan**: Pages cannot be deciphered.
   - **Suspected Malpractice**: Identical derivation patterns or unapproved notes.
   - **Missing / Out-of-Order Answers**: Question answers written in unconventional sections.
3. Enter explanatory notes detailing the observation.
4. Click **Submit Flag**. The script is routed to the Professor's review queue, and your grading session automatically advances to the next student.
