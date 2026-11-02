# Week 10 Demo: Result Publication and Regrade Workflow

This checklist covers the implemented professor and student flows for publishing exam results, viewing graded work, and submitting and tracking regrade requests. It is a demo guide and retrospective, not a video recording; the demo video will be recorded separately.

## Demo preparation

- Use a non-production environment with a professor, two enrolled students, one exam, a rubric, a completed grade, and an identified answer script for the first student.
- Set server-side `STUDENT_RESULTS_ENABLED=true`.
- Configure a regrade window that is currently open for the exam.
- Use a released-result fixture whose student-download policy is `DISABLED` if demonstrating that official PDF export can be disabled while the watermarked viewer remains available.
- Keep the second student's script and any original uploaded files separate from the first student's session.
- Ensure all changes shown are in the test/demo environment; do not use production records.

## Demo checklist

1. **Before publication**
   - Sign in as the student with the exam script.
   - Open **My Exam Results** and confirm the result is not shown as released.
   - If using the professor publish screen first, show that the exam is ready for publication.

2. **Professor publishes results**
   - Sign in as the authorized professor and publish the exam's results.
   - Confirm the publication action succeeds. The action records the publishing actor and time and writes an audit event.

3. **Student sees the released result**
   - Return to the first student's session and refresh **My Exam Results**.
   - Confirm the released exam and score are shown and the graded answer script can be opened.

4. **Read-only answer-script viewer**
   - Open the result's graded script.
   - Navigate pages and show the feedback annotations.
   - Point out the visible watermark. If PDF export is disabled, show that the official download is unavailable while in-app viewing continues.

5. **Submit and track a regrade request**
   - Open a question in the released result while its regrade window is open.
   - Submit a reason of at least 10 characters and confirm the request is accepted.
   - Open **Track Regrade Requests** and confirm the exam, question, reason, and current status are listed.

6. **Cross-student authorization**
   - Sign in as the second student and attempt to open the first student's result/script identifier.
   - Confirm the other student's result and request are not returned. Use test accounts only.

## Recorded verification results

Results below are from local runs and GitHub push workflows for the implementation branches in this stack. The PRs remain open; no implementation PR was merged as part of this work.

| Area | Verification |
|---|---|
| Publish-to-request workflow (AE-198) | Full local suite: 2,249 tests passed across 172 files; ESLint, `npx tsc --noEmit`, and production build passed. GitHub CI run [41480325381](https://github.com/Aarathi1535/assignment_evaluation-IIIT-Hyd/actions/runs/41480325381) passed tests, lint, type-check, and build. |
| Student viewer security (AE-199) | Full local suite: 2,250 tests passed across 172 files; ESLint, `npx tsc --noEmit`, and production build passed. GitHub CI run [41484555197](https://github.com/Aarathi1535/assignment_evaluation-IIIT-Hyd/actions/runs/41484555197) passed tests, lint, type-check, and build. |
| Student portal documentation (AE-200) | Full local suite: 2,250 tests passed across 172 files; ESLint, `npx tsc --noEmit`, and production build passed. GitHub CI run [41487678006](https://github.com/Aarathi1535/assignment_evaluation-IIIT-Hyd/actions/runs/41487678006) passed tests, lint, type-check, and build. |

Full ESLint runs reported 11 existing warnings and no errors. Production builds emitted existing warnings about the derived-storage directory pattern matching many files; builds completed successfully.

Relevant regression tests include `ExamPublishAE190.test.ts`, `ExamUnpublishAE193.test.ts`, `StudentResultsAE182.test.ts`, `StudentReadOnlyViewerAE183.test.ts`, `StudentPdfExportAE187.test.ts`, `RegradeRequestsAE195.test.ts`, `StudentRegradeRequestsAE196.test.tsx`, and `PublishRegradeWorkflowAE198.test.ts`.

## Retrospective

### What worked well

- Result release is gated by publication and grading completion, and the publication action records an audit event.
- Student routes derive identity from the authenticated session and reject cross-student script access.
- The viewer renders watermarked images from derived pages and does not expose internal storage references.
- The end-to-end route test exercises the key path from an unpublished result through request-status retrieval and cross-student denial.

### Known limitations

- The application has student request submission and own-request listing, but no staff-facing regrade triage or status-update endpoint/UI in this workflow. The demonstrated request therefore remains in its persisted status unless handled by a separate administrative process.
- PDF export is disabled by default; enabling it requires the exam's `WATERMARKED` download policy. A watermark cannot prevent screenshots or screen recording of visible content.
- Student result access depends on the server-side `STUDENT_RESULTS_ENABLED` setting and an active regrade window for submissions.
- A demo recording is not included in this repository change; it will be recorded separately.

### Follow-up work

- Add a permission-protected professor workflow to review, transition, and resolve regrade requests, with audit history and regression tests.
- Define and seed a repeatable, non-production demo dataset so the checklist can be replayed consistently.
- Keep the result publication, viewer, and regrade authorization regression suites in CI as these flows evolve.

