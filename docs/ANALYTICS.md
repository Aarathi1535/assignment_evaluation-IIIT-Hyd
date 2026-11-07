# Exam Analytics and Grade Export Architecture

## 1. Overview

This document describes the architecture, statistical methodologies, data pipeline, authorization boundaries, export workflows, and LMS integration for the **Assignment Evaluator** exam analytics system.

The analytics system provides professors and administrators with actionable pedagogical insights into student cohort performance, question-level difficulty, grader consistency, and secure grade export interfaces for external reporting and Learning Management System (LMS) synchronization.

---

## 2. Statistical Capabilities & Mathematical Foundations

All analytics calculations are implemented as pure, deterministic functions in [`src/lib/stats.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/stats.ts) and validated against independently verified, hand-computed fixtures ([`src/__tests__/fixtures/analyticsFixtures.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/fixtures/analyticsFixtures.ts)).

### 2.1 Class Descriptive Statistics

The system computes summary descriptive statistics over the set of finalized, released student scores $X = \{x_1, x_2, \dots, x_N\}$:

1. **Count ($N$)**: The number of valid, finite student scores. Non-finite values (`NaN`, $\pm\infty$, `null`, `undefined`) are filtered out prior to calculation.
2. **Mean ($\mu$)**:
   $$\mu = \frac{1}{N} \sum_{i=1}^{N} x_i$$
3. **Median ($M$)**:
   The midpoint of sorted scores $X_{\text{sorted}}$:
   $$M = \begin{cases} X_{\text{sorted}}\left[\lfloor N/2 \rfloor\right] & \text{if } N \text{ is odd} \\ \frac{X_{\text{sorted}}[N/2 - 1] + X_{\text{sorted}}[N/2]}{2} & \text{if } N \text{ is even} \end{cases}$$
4. **Standard Deviation ($\sigma$)**:
   The system calculates the **population standard deviation** because released grades represent the complete evaluated cohort (not an inferential sample drawn from a larger hypothetical population):
   $$\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_i - \mu)^2}$$
   *Methodology note:* The API response explicitly declares `"standardDeviationMethod": "population"` to eliminate ambiguity for instructors comparing with external software.
5. **Boundary Conditions**:
   - $N = 0$: Returns `count: 0`, `mean: null`, `median: null`, `standardDeviation: null`.
   - $N = 1$: Returns `count: 1`, `mean: x`, `median: x`, `standardDeviation: 0`.

### 2.2 Score Distribution (Histogram)

Scores are partitioned into percentage bins over the range $0\%$ to $100\%$ using a configurable number of bins (default: $K = 10$, step size $10\%$):

- **Bin Interval**: Each bin $k \in \{0, 1, \dots, K-1\}$ covers the interval:
  $$\left[\frac{k}{K} \times 100\%,\, \frac{k+1}{K} \times 100\%\right)$$
- **Score Normalization**:
  $$p_i = \left(\frac{\text{score}_i}{\text{maxMarks}_i}\right) \times 100$$
- **Bin Index Assignment & 100% Boundary Clamping**:
  $$\text{index} = \min\left(\left\lfloor \frac{p_i}{100 / K} \right\rfloor,\, K - 1\right)$$
  *Clamping note:* Scores of exactly $100\%$ ($p_i = 100$) are clamped into the highest bin (e.g., `90-100%`) rather than creating an invalid index $K$.
- **Validation**:
  - $K$ must be a safe integer between $1$ and $100$.
  - Observations with $\text{maxMarks} \le 0$, $\text{score} < 0$, $\text{score} > \text{maxMarks}$, or non-finite values are ignored.

### 2.3 Question-Level Performance & Difficulty Index

Each exam question is analyzed across all released answer scripts:

1. **Score Normalization**:
   Because rubric versions may vary or questions may have different point allocations, each score is normalized to a percentage of that question's own maximum marks:
   $$p_{i, q} = \left(\frac{\text{score}_{i, q}}{\text{maxMarks}_q}\right) \times 100$$
2. **Graded Count**: Total finalized grades for question $q$.
3. **Mean Score Percentage ($\mu_q$)**: Arithmetic average of $p_{i, q}$.
4. **Spread ($\sigma_q$)**: Population standard deviation of $p_{i, q}$ in percentage points.
5. **Difficulty Index ($D_q$)**:
   $$D_q = 100 - \mu_q$$
   *Interpretation:* Higher values denote harder questions ($0\%$ indicates all students received full marks; $100\%$ indicates no student earned points). Questions with 0 graded scripts yield `null` metrics.

### 2.4 TA Grading Consistency & Inter-Grader Drift

To help instructors monitor grading drift across Teaching Assistants, the platform computes the **Mean Absolute Deviation (MAD)** per grader:

1. **Comparable Groups**:
   Scores are grouped into comparable grading cohorts identified by rubric and question: `${rubricId}:${questionNumber}` (or `${rubricId}:whole` for whole-script evaluations).
2. **Single-Grader Group Exclusion**:
   Groups where fewer than two distinct graders evaluated scripts are excluded, as single-grader groups cannot measure inter-grader variance.
3. **Cohort Mean**:
   For each comparable group $g$, the pooled percentage score across all graders is:
   $$\bar{P}_g = \frac{1}{|g|} \sum_{s \in g} p_s$$
4. **Mean Absolute Deviation (MAD)**:
   For grader $r$ across all comparable observations:
   $$\text{MAD}_r = \frac{1}{M_r} \sum_{i \in \text{Obs}_r} |p_i - \bar{P}_{g(i)}|$$
5. **Sample Size Sufficiency**:
   A minimum of 5 comparisons (`MIN_GRADER_CONSISTENCY_SAMPLE_SIZE = 5`) is required:
   $$\text{status} = \begin{cases} \text{SUFFICIENT} & \text{if } M_r \ge 5 \\ \text{INSUFFICIENT} & \text{if } M_r < 5 \end{cases}$$
6. **Limitation**:
   This metric is a **grading drift proxy** across comparable student groups. It does not constitute formal double-blind inter-rater reliability (such as Cohen's Kappa) because student scripts are not double-graded in standard workflows.

---

## 3. Data Pipeline & Grade Inclusion Rules

Analytics metrics are computed strictly from released student results via [`StudentResultService.getPublishedExamScores`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/services/StudentResultService.ts).

```
+-----------------------------------------------------------------------------+
|                                Exam Document                                |
|             (isActive: true, status: ExamStatus.PUBLISHED)                  |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                           AnswerScript Documents                            |
|        (isActive: true, identificationStatus: IDENTIFIED, student: ID)       |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                               User Document                                 |
|                  (isActive: true, role: UserRole.STUDENT)                   |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                     Grading Finality & Completeness                         |
|   - All grades have isFinal === true                                        |
|   - Every required rubric question has a finalized grade                    |
|   - All allocations (question-wise or whole-script) are COMPLETED           |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                            Released Score Cohort                            |
|             (Input to Descriptive Stats, Histogram & Exports)               |
+-----------------------------------------------------------------------------+
```

### 3.1 Inclusion Criteria
A student script score is included in analytics and grade exports if and only if:
1. **Exam Status**: Exam is active and `status === ExamStatus.PUBLISHED`.
2. **Student Identity**: Student user exists, has `isActive: true`, and role `STUDENT`.
3. **Enrollment**: Student is enrolled in the course or mapped to the exam via `StudentMapping`.
4. **Script Validity**: `AnswerScript` is active, has `identificationStatus === IdentificationStatus.IDENTIFIED`, `needsManualId === false`, and `hasIdentificationConflict === false`.
5. **Grading Finality**: All grades on the script have `isFinal === true`.
6. **Rubric Coverage**: Every question in the referenced rubric version has a finalized grade.
7. **Allocation Policy**: If TA grading allocations exist for the script, all allocations must have `status === AllocationStatus.COMPLETED`.

### 3.2 Exclusion Rules
The following are excluded:
- Draft or unreleased exams (`DRAFT`, `REVIEW_PENDING`, `READY_FOR_REVIEW`).
- Deactivated or soft-deleted student accounts.
- Unidentified or conflicting answer scripts (`UNIDENTIFIED`, `needsManualId: true`).
- Scripts with unfinalized (`isFinal: false`) or pending grading work.
- Incomplete grading allocations (`PENDING`, `IN_PROGRESS`).
- Foreign submissions from other courses or other exams.

---

## 4. Export Workflows & Formats

Grade export is available via `GET /api/analytics/exams/[id]/export` and the professor UI ([`ExamExportPanel.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/analytics/ExamExportPanel.tsx)).

### 4.1 Supported Export Formats

| Format Parameter | File Extension | Content-Type | Description |
| :--- | :--- | :--- | :--- |
| `format=csv` | `.csv` | `text/csv; charset=utf-8` | RFC 4180 compliant CSV of student grades |
| `format=xlsx` | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | Native OpenXML Excel spreadsheet |
| `format=lms` | `.csv` | `text/csv; charset=utf-8` | Standard LMS gradebook mapping CSV |
| `format=canvas` | `.csv` | `text/csv; charset=utf-8` | Canvas LMS Gradebook upload CSV |

### 4.2 Standard Grade Export (CSV / XLSX)

- **Headers**:
  `Student ID`, `Roll Number`, `Student Name`, `Email`, `Anonymous ID`, `Q1`, `Q2`, ..., `Total Score`, `Max Marks`, `Percentage`
- **Sorting**: Natural numeric sort by Roll Number if present, otherwise alphabetical by Student Name.
- **Headless XLSX Engine**: Built without third-party dependencies using native OpenXML PKZIP 2.0 generation ([`buildXlsx` in `src/lib/gradeExport.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/gradeExport.ts)).

### 4.3 Spreadsheet Formula Injection Protection
To prevent CSV Formula Injection (CSV Command Injection / CWE-1236), all cell values in CSV and XLSX exports are sanitized via [`sanitizeSpreadsheetCell`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/gradeExport.ts):
- Any cell value beginning with `=`, `+`, `-`, `@`, `\t` (tab), or `\r` (carriage return) is automatically escaped by prefixing an apostrophe (`'`).
- In CSV output, fields containing quotes or commas are enclosed in double quotes according to RFC 4180.

### 4.4 LMS Student-ID Mapping & Canvas Format
Implemented via [`mapLmsStudentIdsToGrades` in `src/lib/lmsMapping.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/lmsMapping.ts):

- **Standard LMS Schema**:
  `LMS Student ID`, `Student Name`, `Email`, `Roll Number`, `Grade`, `Max Grade`, `Status`, `Validation Notes`
- **Canvas LMS Schema**:
  - Row 1: `Student`, `ID`, `SIS User ID`, `SIS Login ID`, `Section`, `<Exam Title>`
  - Row 2: `Points Possible`, ``, ``, ``, ``, `<totalMarks>`
  - Row 3+: Student records
- **Mapping Statuses**:
  - `MAPPED`: Successfully mapped and verified within course roster.
  - `UNMAPPED`: Student has no registered LMS ID or mapping entry.
  - `MISSING_IN_COURSE`: Identifier corresponds to a user not enrolled in this course.
  - `DUPLICATE_LMS_ID` / `DUPLICATE_STUDENT`: Ambiguous identifier collision.
  - `INVALID_IDENTIFIER`: Malformed identifier string.
  - `INVALID_GRADE`: Score out of bounds ($< 0$ or $> \text{maxMarks}$).

### 4.5 LTI 1.3 Grade Passback Architecture & Stub
- **Design & Contract**: Full LTI 1.3 Assignment and Grade Services (AGS 2.0) architecture defined in [`docs/LTI_1_3_GRADE_PASSBACK.md`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/LTI_1_3_GRADE_PASSBACK.md).
- **Endpoint**: `POST /api/analytics/exams/[id]/lti/passback`
- **Stub Mode**: Operates in safe stub mode (`stubMode: true`). It verifies permissions, validates identifiers via `mapLmsStudentIdsToGrades`, shapes AGS 2.0 JSON score payloads, and records simulated dispatch without opening outbound network sockets.

---

## 5. Professor Export UI Workflow

The professor export panel is integrated directly into the exam analytics page:

- **Location**: [`src/components/analytics/ExamExportPanel.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/analytics/ExamExportPanel.tsx) rendered on `/professor/exams/[id]/analytics`.
- **Format Selection**: Segmented format radio options (CSV, XLSX, Standard LMS, Canvas LMS).
- **Interactive States**:
  - **Idle**: Format selector and "Download Export" button.
  - **Downloading**: Spinner animation, disabled button, and active progress status.
  - **Success**: Confirmation message with filename and timestamp.
  - **Error**: Dismissible error banner displaying the server's error message with retry capability.
- **Client-Side Trigger**: Uses `window.URL.createObjectURL(blob)` and an invisible download anchor to trigger file download while maintaining security headers.

---

## 6. Regrading Effects on Analytics & Exports

When a student submits a regrade request and a professor or TA approves the request with a revised score via `PATCH /api/professor/regrade-requests/[id]`:

1. **Grade Document Update**:
   [`Grade.findOneAndUpdate`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/app/api/professor/regrade-requests/[id]/route.ts) updates the question grade document with the revised total score and proportionately adjusted criterion marks.
2. **Audit Event**:
   An immutable audit log entry (`REGRADE_DECIDED`) is written recording the student ID, exam ID, question number, outcome, original score, and revised score.
3. **Immediate Analytics Recalculation**:
   Because `StudentResultService.getPublishedExamScores` re-evaluates database grades dynamically:
   - **Class Mean, Median, and Standard Deviation** immediately update to incorporate the new score.
   - **Question Performance** immediately updates the question's mean percentage and difficulty index.
   - **Score Distribution** dynamically shifts the student into the appropriate histogram bin.
   - **Exports** immediately generate spreadsheets containing the revised question score and updated exam total.
4. **Lifecycle State Transition**:
   Assigning a reviewer transitions request status from `OPEN` to `REVIEWING`. Unassigning reverts status to `OPEN`. Resolving transitions status to `RESOLVED` (`isOpen: false`).

---

## 7. API Endpoints Reference

### 7.1 Exam Analytics
- **Route**: `GET /api/analytics/exams/[id]`
- **Permission**: `Permission.VIEW_ALL_SUBMISSIONS` (Roles: `PROFESSOR`, `ADMIN`)
- **Query Scoping**: Exam must be created by the acting user OR belong to a course where the user is the course professor.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "exam": {
        "id": "672b1234567890abcdef1234",
        "title": "Midterm Examination",
        "maxMarks": 100
      },
      "classStatistics": {
        "count": 45,
        "mean": 78.4,
        "median": 80.0,
        "standardDeviation": 12.35,
        "standardDeviationMethod": "population"
      },
      "scoreDistribution": [
        { "startPercentage": 0, "endPercentage": 10, "label": "0-10%", "count": 1 },
        { "startPercentage": 90, "endPercentage": 100, "label": "90-100%", "count": 12 }
      ],
      "questionStatistics": [
        {
          "questionNumber": 1,
          "maxMarks": 20,
          "gradedCount": 45,
          "meanScorePercentage": 82.5,
          "standardDeviationPercentagePoints": 14.2,
          "difficultyIndexPercentage": 17.5
        }
      ],
      "questionMetric": {
        "scoreNormalization": "Each final score is divided by the question maximum from the rubric version used for that grade.",
        "spread": "Population standard deviation of normalized scores, in percentage points.",
        "difficultyFormula": "Difficulty index = 100 - mean score percentage; higher values indicate a harder question."
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Invalid exam ID format.
  - `401 Unauthorized`: Unauthenticated session.
  - `403 Forbidden`: User lacks professor/admin role.
  - `404 Not Found`: Exam does not exist or user is not authorized for this course.
  - `409 Conflict`: Exam is not in `PUBLISHED` status.

### 7.2 Exam Grade Export
- **Route**: `GET /api/analytics/exams/[id]/export`
- **Query Parameters**:
  - `format`: `csv` (default), `xlsx`, `lms`, or `canvas`
- **Headers**:
  - Content-Disposition: `attachment; filename="exam-[id]-grades.[ext]"`
  - Cache-Control: `private, no-store`
  - X-Content-Type-Options: `nosniff`
- **Success Response (200 OK)**: Binary stream (`.xlsx`) or text stream (`.csv`).

### 7.3 TA Grading Consistency
- **Route**: `GET /api/analytics/exams/[id]/graders`
- **Permission**: `Permission.VIEW_ALL_SUBMISSIONS` (Roles: `PROFESSOR`, `ADMIN`)
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "exam": { "id": "...", "title": "..." },
      "metric": {
        "name": "Mean absolute deviation from comparable question cohort mean",
        "unit": "percentage_points",
        "direction": "lower_is_closer_to_cohort_mean",
        "minimumSampleSize": 5
      },
      "graders": [
        {
          "graderId": "672b...",
          "name": "Teaching Assistant Alpha",
          "comparisonCount": 8,
          "meanAbsoluteDeviationPercentagePoints": 4.25,
          "sampleSizeStatus": "SUFFICIENT"
        }
      ]
    }
  }
  ```

### 7.4 LTI Grade Passback Stub
- **Route**: `POST /api/analytics/exams/[id]/lti/passback`
- **Permission**: `Permission.VIEW_ALL_SUBMISSIONS` (Roles: `PROFESSOR`, `ADMIN`)
- **Success Response (200 OK)**: Returns passback summary with `stubMode: true`.

---

## 8. Authorization & Security Architecture

1. **Course-Level Scoping**:
   - Access to exam analytics and exports is governed by [`ExamRepository.getExamById`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/repositories/ExamRepository.ts).
   - Professors may only access exams they created (`createdBy: user.id`) OR exams belonging to courses where they are the designated instructor (`course.professor: user.id`).
   - Unauthorized attempts by professors teaching different courses fail closed with `404 Not Found` to prevent revealing the existence of other course exams.
2. **Student Privacy**:
   - Students cannot access the analytics API or export endpoints.
   - Student results are only queryable individually through authenticated student routes (`/api/student/results`) and do not disclose cohort distributions, class averages, or peer scores.
3. **HTTP Cache Control**:
   - All analytics, grader consistency, export, and regrade endpoints enforce `Cache-Control: private, no-store` to prevent caching on shared intermediate proxies.

---

## 9. Configuration & Operational Considerations

- **`STUDENT_RESULTS_ENABLED`**: Environment variable flag (`true` / `false`). Must be enabled for student results evaluation.
- **Histogram Bins**: Default is 10 bins. Must be between 1 and 100.
- **Allocations**: When TA grading allocations exist for an exam, answer scripts must have all allocations marked `COMPLETED` before inclusion in analytics.
- **Database Indexing**: Analytics aggregations rely on indexes on `AnswerScript.exam`, `Grade.answerScript`, and `StudentMapping.exam`.

