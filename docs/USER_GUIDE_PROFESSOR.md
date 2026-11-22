# Professor User Guide: IIIT Hyderabad Assignment Evaluation Platform

Welcome to the Course Professor User Guide. This manual details the operational procedures for managing courses, authoring exam rubrics, orchestrating Teaching Assistant (TA) grading allocations, publishing evaluated results, and arbitrating regrade requests.

---

## 1. Course Setup and Roster Management

### 1.1 Accessing Your Course Dashboard
1. Log in to the platform with your credentials at `/login`.
2. Navigate to the **Professor Dashboard** (`/professor`) or **Courses** (`/professor/courses`).
3. View your active courses for the current academic term.

### 1.2 Managing Examinations
1. In your exams menu (`/professor/exams`), click **Create New Exam** (`/professor/exams/create`).
2. Specify:
   - **Exam Title**: e.g., *Mid-Semester Examination 2026*.
   - **Course Selection**: Choose from assigned courses.
   - **Exam Date & Total Marks**: Scheduled date and maximum attainable points.
3. Click **Create Exam**.

---

## 2. Exam Creation & Rubric Authoring

### 2.1 Designing Scoring Rubrics
1. From the exam overview, navigate to **Configure Rubrics** (`/professor/exams/edit/[id]/rubric`).
2. For each question, define:
   - **Question Number & Title**.
   - **Maximum Marks**: Total marks allocated to this question.
   - **Score Step Granularity**: Incremental point steps (`0.5`, `1.0`, or `2.0`).
   - **Criteria & Deduction Rules**: Explicit checklist items describing point awards and common deductions.
3. Save rubric definitions. Rubrics are locked once grading commences to ensure consistent standards.

---

## 3. TA Grading Allocation & Progress Tracking

### 3.1 Allocation Strategies
Navigate to **Grading Allocations** (`/professor/exams/[id]/allocate`):
- **Question-Level Allocation**: Assign specific questions across all answer scripts to designated TAs (e.g., TA 1 evaluates Question 1; TA 2 evaluates Question 2). This maximizes evaluation consistency.
- **Script-Level Allocation**: Allocate subsets of student scripts across teaching assistants.

### 3.2 Real-Time Progress Monitoring
The **Exam Progress Monitor** (`/professor/exams/[id]/progress`) and **Analytics** (`/professor/exams/[id]/analytics`) provide:
- Real-time completion rates per question and per TA.
- Identification of stalled grading queues.
- Script re-allocation when a grader is unavailable.

---

## 4. Grade Publication & Result Management

### 4.1 Pre-Publication Audit
Before releasing results to students, ensure:
1. 100% of answer scripts have been evaluated across all rubric questions.
2. Flagged scripts in the **Flags Review Queue** (`/professor/flags`) are reviewed and cleared.
3. Overall score distributions and averages are verified.

### 4.2 Publishing Exam Results
1. Navigate to **Examinations** (`/professor/exams`).
2. Locate the completed exam and click **Publish**.
3. The **Publish Results Modal** opens, summarizing:
   - Enrolled student count and completed answer scripts.
   - Any incomplete evaluations or validation warnings.
4. Click **Publish Results**. The backend executes atomic updates, marks results as published, activates the student regrade appeal window, and logs an audited event.

---

## 5. Student Regrade Request Arbitration

### 5.1 Reviewing the Regrade Queue
1. Navigate to **Regrade Requests** (`/professor/regrade-requests`).
2. Filter requests by question, status (`PENDING`, `UNDER_REVIEW`, `RESOLVED`), or submission date.
3. Review student rationale alongside the annotated script pages and rubric breakdown.

### 5.2 Approving or Rejecting Appeals
- **Approve Regrade**: Update the question score with explanatory remarks. The student's total marks update immediately.
- **Reject Regrade**: Maintain original marks with constructive rationale explaining why the original evaluation stands.
- All decisions are immutably logged in the course audit record.
