# AE-160: Grading UX Review & TA Workflow Benchmark

## 1. Objective
The objective of this usability review and benchmark is to evaluate the end-to-end Teaching Assistant (TA) grading experience in Assignment Evaluator compared to traditional physical paper-based evaluation. The evaluation assesses grading speed, error rates (corrections/recounts/recalculations), cognitive load, allocation lifecycle visibility, and friction points across both workflows.

---

## 2. Real-World TA Validation Status
- **Benchmark Infrastructure**: The benchmark infrastructure, workflow metrics framework, and automated verification test suites (AE-150 through AE-159) are fully implemented, integrated, and verified.
- **Session Execution**: The planned 5-paper vs. 5-system live evaluation session with a real Teaching Assistant could not be completed during this integration cycle.
- **Comparative Performance Reporting**: In strict adherence to experimental integrity, no timing values, correction counts, or comparative performance claims are fabricated, estimated, or reported.
- **Timing & Tracking Data**: The timing tables, quantitative metrics, and checklist entries remain intentionally blank pending completion of a live session with an independent TA evaluator.

---

## 3. Participants
- **Target Evaluators**: Real Teaching Assistants / Course Instructors with active course grading responsibilities.
- **Independence Principle**: Evaluation must **not** be performed solely by the feature author or system developers.
- **Zero-Prior-Knowledge Usability**: Evaluators should not require internal knowledge of code, API lifecycles, or database schemas to successfully complete grading.

---

## 4. Test Setup
- **Evaluation Rubric**: Identical multi-criterion rubric applied across both paper and digital evaluations.
- **Dataset**:
  - **5 Scripts (Group A)**: Evaluated using standard physical paper grading (printed answer scripts, manual pen annotation, manual score summation).
  - **5 Comparable Scripts (Group B)**: Evaluated using the Assignment Evaluator web workspace (canvas viewing/zooming/rotation, rubric sidebar, digital annotations, automated calculation).
- **Control Criteria**:
  - Same question complexity and distribution.
  - Same scoring criteria, step granularities, and max marks.
  - Same evaluator or counter-balanced evaluator rotation to mitigate learning effects.

---

## 5. Grading Workflows

### A. Paper-Based Workflow
1. Receive batch of physical answer scripts.
2. Open script and flip to relevant question section.
3. Review student's handwritten answer.
4. Manually cross-check answer against printed rubric criteria.
5. Write inline notes / ticks / deductions using physical pen.
6. Record sub-scores in the question margin.
7. Sum sub-scores on scratchpad / calculator to get question total.
8. Transcribe question total to front-page score summary grid.
9. Verify arithmetic across all question totals for the final script score.
10. Place script into the completed pile and pick up next script.

### B. System (Assignment Evaluator) Workflow
1. Navigate to TA Dashboard and open assigned allocation (`/grading?scriptId=...`).
2. Allocation transitions from `PENDING` to `IN_PROGRESS` upon opening / initial draft interaction.
3. Inspect student response on high-performance Canvas (pan, zoom, loupe magnifier, rotation if necessary).
4. Enter criterion marks in the `RubricSidebar` (validating bounds and granularity steps).
5. Add optional criterion or question feedback/remarks.
6. **Save Draft**: Saves work without locking; question remains editable and allocation remains `IN_PROGRESS`.
7. **Submit Final**: Locks question score once evaluation is complete.
8. If whole-script allocation: complete remaining questions in the rubric. Allocation remains `IN_PROGRESS` until all required questions are finalized.
9. On final question submission, allocation status transitions to `COMPLETED`.
10. **Auto-Advance (AE-157)**: System automatically prompts/advances to the next available `PENDING` or `IN_PROGRESS` allocation for the same exam.

---

## 6. Metrics & Measurement Framework

### Quantitative Metrics:
- **Individual Script Duration**: Time (in minutes/seconds) elapsed from opening/picking up a script to finalizing it.
- **Total Grading Time**: Cumulative duration across all 5 scripts per modality.
- **Average Time per Script**: Mean duration per script.
- **Score Corrections / Recounts**: Number of instances where marks had to be crossed out, recalculated, or corrected due to tallying or rubric misunderstanding.
- **Arithmetic Recalculations**: Number of times the evaluator had to re-add marks or check score totals.

### Qualitative Metrics:
- Clarity of allocation status (`PENDING`, `IN_PROGRESS`, `COMPLETED`).
- Clarity of Draft vs. Final state.
- Ease of canvas navigation vs. paper flipping.
- Feedback capture ergonomics.
- Recovery from validation errors.

---

## 7. Workflow Timing & Error Tracking Table

> **Real-World TA Validation Notice**: The planned 5-paper / 5-system real-TA session could not be completed during this integration cycle. In accordance with experimental data integrity standards, no timing, recount, or correction data has been fabricated or estimated. The timing table below remains intentionally blank pending a real TA session.

| Script # | Paper Time (mm:ss) | System Time (mm:ss) | Paper Corrections / Recounts | System Corrections / Recounts | Notes & Observations |
|:--------:|:------------------:|:-------------------:|:----------------------------:|:-----------------------------:|:--------------------:|
| **1**    |                    |                     |                              |                               |                      |
| **2**    |                    |                     |                              |                               |                      |
| **3**    |                    |                     |                              |                               |                      |
| **4**    |                    |                     |                              |                               |                      |
| **5**    |                    |                     |                              |                               |                      |

### Summary Aggregates
- **Total Paper Time**: `___m ___s`
- **Total System Time**: `___m ___s`
- **Average Paper Time per Script**: `___m ___s`
- **Average System Time per Script**: `___m ___s`
- **Total Paper Recounts/Corrections**: `___`
- **Total System Recounts/Corrections**: `___`

---

## 8. Lifecycle Visibility & Usability Checklist

Verify the following lifecycle visibility checkpoints during live system evaluation:

| # | Usability & Lifecycle Checkpoint | Status (Pass / Fail / Partial) | TA Evaluator Observations |
|---|----------------------------------|:------------------------------:|---------------------------|
| 1 | **Allocation Identification**: TA can immediately identify which script, student pseudonym, and question they are grading. | `[ ]` | |
| 2 | **Draft State Visibility**: Clear visual feedback when marks are saved as Draft vs. Submitted as Final. | `[ ]` | |
| 3 | **Draft Editability**: Saved drafts remain fully editable without locking inputs prematurely. | `[ ]` | |
| 4 | **Question Finality**: Finalized questions clearly indicate "Submitted / Final" state in the sidebar. | `[ ]` | |
| 5 | **Whole-Script Progress Invariant**: Whole-script allocations visibly stay `IN_PROGRESS` when only a subset of questions are finalized (never premature `COMPLETED`). | `[ ]` | |
| 6 | **Completion Indicator**: Clear confirmation banner/modal when the entire script allocation reaches `COMPLETED`. | `[ ]` | |
| 7 | **Next-Script Navigation**: Next-script advance triggers only after genuine allocation completion, selecting the next `PENDING`/`IN_PROGRESS` script without skipping. | `[ ]` | |
| 8 | **Validation Error Recovery**: Invalid marks (out-of-bounds or non-standard step) display helpful inline error messages without wiping entered data. | `[ ]` | |
| 9 | **Automated Score Tallying**: Score totals calculate automatically in real-time matching rubric constraints, eliminating manual recount errors. | `[ ]` | |

---

## 9. Critical UX Review Questions

1. **Can the TA tell which allocation they are currently grading?**
   - *Review*: The header displays the exam name, anonymized student/script identifier, and active question number.
   - *Verification Task*: Ask the TA to name the current script/question without checking URL query parameters.

2. **Can they tell whether work is saved as draft?**
   - *Review*: "Save Draft" updates local and server state while keeping fields editable. A status badge reflects "Draft Saved".
   - *Verification Task*: TA saves draft, navigates briefly, and verifies draft persistence.

3. **Can they tell whether a question is final?**
   - *Review*: Finalized questions display a "Finalized" badge with disabled/locked inputs or explicit unlock permissions.

4. **Can they understand why a whole-script allocation is still `IN_PROGRESS`?**
   - *Review*: Question navigation tab list highlights incomplete questions (e.g., Q1: Final, Q2: Draft, Q3: Pending).
   - *Verification Task*: Finalize Q1 of a 3-question script and verify TA understands that Q2 and Q3 are remaining.

5. **Can they tell when the entire script is `COMPLETED`?**
   - *Review*: When all questions are finalized, allocation status badge updates to `COMPLETED` and the completion/next dialog appears.

6. **Does next-script navigation happen only after actual allocation completion?**
   - *Review*: Auto-advance triggers via AE-157 upon final required question submission or explicit completion action.

7. **Can the TA recover from validation errors without losing work?**
   - *Review*: Validation errors (e.g. score > maxMarks or invalid score step) produce red helper text under the input while retaining the user's typed value for easy correction.

8. **Are score totals visibly consistent with the rubric?**
   - *Review*: The rubric sidebar shows live criterion sub-totals, max marks per criterion, and sum total matching the server-computed authoritative total.

---

## 10. TA Qualitative Feedback & Observations
*(To be populated during TA benchmark session)*

- **Canvas & Annotation Ergonomics**:
  - *Feedback*:
- **Rubric & Score Entry Flow**:
  - *Feedback*:
- **Navigation & Shortcuts (AE-154/AE-155/AE-156)**:
  - *Feedback*:
- **Points of Confusion / Cognitive Friction**:
  - *Feedback*:

---

## 11. Findings, Issues Observed & Follow-up Actions

| Issue ID | Description | Severity | Recommended Follow-up Action | Status |
|----------|-------------|:--------:|------------------------------|:------:|
| *OBS-01* | *(Template entry: document any UI confusion during live trial)* | Minor | | Open |
