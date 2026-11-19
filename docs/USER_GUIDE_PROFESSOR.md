# Professor User Guide: IIIT Hyderabad Assignment Evaluation Platform

Welcome to the Course Professor User Guide. This manual details the operational procedures for managing courses, authoring exam rubrics, orchestrating Teaching Assistant (TA) grading allocations, publishing evaluated results, and arbitrating regrade requests.

---

## 1. Course Setup and Roster Management

### 1.1 Accessing Your Course Dashboard
1. Log in to the platform with your faculty credentials at `https://eval.iiit.ac.in`.
2. Select your course from the **Instructor Dashboard** (`/courses`).
3. Verify that the current academic term and course code (e.g. `CS101`) are active.

### 1.2 Importing Student Rosters
1. Navigate to **Course Settings > Student Roster**.
2. Click **Import Roster (CSV)**.
3. Upload a standard UTF-8 CSV file containing the following header structure:
   ```csv
   studentId,email,name,rollNumber
   2026101001,student1@students.iiit.ac.in,Aarav Sharma,2026101001
   2026101002,student2@students.iiit.ac.in,Ananya Patel,2026101002
   ```
4. Confirm the preview count and click **Finalize Import**.

### 1.3 Assigning Teaching Assistants
1. Navigate to **Course Settings > Teaching Assistants**.
2. Search for registered TA accounts by email.
3. Click **Add to Course Staff**. Assigned TAs will immediately gain access to grading allocations for this course.

---

## 2. Exam Creation & Rubric Authoring

### 2.1 Creating an Examination
1. In your course menu, select **Examinations > Create New Exam**.
2. Complete the configuration parameters:
   - **Exam Name**: e.g., *Mid-Semester Examination 2026*.
   - **Total Marks**: Combined maximum marks across all questions.
   - **Number of Questions**: Total discrete questions.
   - **Regrade Window (Days)**: Number of days students may submit regrade appeals after results publication (default: `7` days).
3. Click **Create Exam**.

### 2.2 Designing Scoring Rubrics
1. Select the exam and click **Configure Rubrics** (`/exams/[id]/rubrics`).
2. For each question, define:
   - **Maximum Marks**: Points allocated to this question.
   - **Score Step Granularity**: Incremental point steps (`0.5`, `1.0`, or `2.0`).
   - **Grading Criteria Checklist**: Explicit checklist items describing point awards and common deductions.
3. Save rubric definitions. Rubrics are locked once active grading begins.

---

## 3. TA Grading Allocation & Progress Tracking

### 3.1 Allocation Strategies
Navigate to **Examinations > Grading Allocations**:
- **Question-Level Allocation (Recommended)**: Assign specific questions across all students to designated TAs (e.g., TA 1 grades Question 1; TA 2 grades Question 2). This maximizes grading consistency.
- **Batch-Level Allocation**: Assign complete answer scripts of student subsets to designated TAs.

### 3.2 Real-Time Velocity Monitoring
The **Allocation Monitor** dashboard provides:
- Real-time percentage completion per question and per TA.
- Identification of stalled queues or grading discrepancies.
- Ability to reallocate uncompleted scripts if a TA becomes unavailable.

---

## 4. Grade Publication & Result Management

### 4.1 Pre-Publication Audit Checklist
Before publishing results to students, confirm:
- [ ] 100% of answer scripts have been completely evaluated across all questions.
- [ ] Any student scripts flagged by TAs (e.g. suspected malpractice, illegible pages) have been reviewed and resolved.
- [ ] Score distributions and grade averages match academic department benchmarks.

### 4.2 Publication Preview & Release
1. Open the exam dashboard and click **Publish Results**.
2. The platform displays a **Publication Preview Modal** showing total evaluated scripts, average score, and grade percentiles.
3. Enter your faculty confirmation phrase and click **Confirm & Publish**.
4. The system executes atomic database updates, logs a cryptographically sealed audit event, and dispatches email notifications to enrolled students.

### 4.3 Audited Unpublishing (Emergency Recovery)
If a critical scoring discrepancy or rubric recalculation is identified post-publication:
1. Click **Unpublish Results**.
2. Enter the mandatory **Audit Justification Reason** explaining the unpublish decision.
3. Student access to scripts is temporarily suspended while corrections are applied.

---

## 5. Student Regrade Request Arbitration

### 5.1 Reviewing the Regrade Queue
1. Navigate to **Examinations > Regrade Requests** (`/exams/[id]/regrades`).
2. Filter requests by question, status (`PENDING`, `UNDER_REVIEW`, `RESOLVED`), or submission date.
3. Inspect student rationale alongside the annotated answer script and original rubric scores.

### 5.2 Approving or Rejecting Appeals
- **Approve Regrade**:
  - Enter the corrected mark for the disputed question.
  - Provide explanatory feedback notes for the student.
  - The platform updates the final exam mark and notifies the student.
- **Reject Regrade**:
  - Maintain original marks.
  - Enter comprehensive feedback explaining why the original evaluation stands.
  - Rejection is recorded immutably in the course audit log.
