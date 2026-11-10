# Student Portal

This guide describes the student-facing course, exam, results, answer-script, and regrade-request workflows currently implemented in the application.

## Courses and exams

The student dashboard loads:

- `GET /api/courses` for courses in which the signed-in student is enrolled.
- `GET /api/exams` for active, published exams assigned to that student through the exam mapping or course enrollment.

Both endpoints require the authenticated application session and course-view permission. Student exam responses are shaped for student use rather than returning the full exam document. The dashboard displays course and exam summaries and refreshes when the page regains focus or at its periodic refresh interval.

## Result visibility

The results page calls `GET /api/student/results`. It shows the student's own exam records and whether each result is `RELEASED` or `NOT_AVAILABLE`. Scores and script links are returned only when the exam is active and published, the script is active and correctly identified, all required grading is final, and grading allocations are complete. Unpublished exams are not presented as released results.

Newly raised open script flags (e.g. academic integrity, grading discrepancies) immediately hide the student's published result: `evaluateReleaseConditions` evaluates to unreleased (`NOT_AVAILABLE`), returning HTTP 404 on itemized feedback, page manifests, and image endpoints until all flags on the script are resolved or escalated by course staff.

The server-side `STUDENT_RESULTS_ENABLED` setting must be `true` for student result access. When the feature is disabled, result access returns a not-found response. The results list, detailed result, and viewer endpoints derive the student identity from the authenticated session; a client-supplied student ID is not an authorization input.

`GET /api/student/results/[scriptId]` returns itemized marks and feedback for an eligible result. Attempts to access a missing, unreleased, or another student's script are rejected rather than returning its result.

## Notifications

When a professor publishes an exam's results (`POST /api/exams/[id]/publish` via AE-190/AE-191):
- System notifications (`RESULTS_PUBLISHED`) and email alerts are queued and dispatched to enrolled students whose answer scripts have finalized grades with no open flags (AE-192).
- Notifications are deduplicated and recorded in the database, remaining accessible in the student's notification center.

## Regrade window configuration

Professors configure an exam-specific regrade request window (`regradeWindowOpensAt` and `regradeWindowClosesAt`) via `PUT /api/exams/[id]/regrade-window` (AE-197):
- The window dates require strict chronological ordering (`regradeWindowOpensAt < regradeWindowClosesAt`).
- All window configuration updates are logged to the audit log fail-closed.
- Window state is surfaced to students through `ItemizedResultDto` and `GET /api/exams/[id]/regrade-window`.

## Graded answer-script viewer

From a released result, the student can open the read-only graded answer-script viewer. The viewer obtains its page list from `GET /api/student/results/[scriptId]/pages`, page images from `GET /api/student/results/[scriptId]/pages/[pageId]/image`, and feedback annotations from `GET /api/student/results/[scriptId]/pages/[pageId]/annotations`.

The page list contains page identifiers, page numbers, and available dimensions; it does not include internal storage keys, file identifiers, or batch identifiers. The image endpoint verifies script ownership and page-to-script association, accepts only the expected derived-page storage namespace, and returns a watermarked image. Annotation responses use an allowlist and omit grader identities and internal metadata. These endpoints use private, non-cacheable responses and generic not-found responses for inaccessible resources.

The viewer is read-only. Watermarks discourage redistribution, but cannot prevent screenshots, screen recording, or saving content that is visible on screen.

## PDF download restrictions

The official PDF export endpoint is:

`GET /api/student/results/[scriptId]/export`

An exam's student download policy defaults to `DISABLED`. Export is available only when the policy is `WATERMARKED` and the authenticated student is authorized to view that released script. Missing or unknown policy values fail closed. Exported pages are watermarked, and the endpoint applies request limits, a page-count cap, and rendering capacity/deadline guards. The viewer remains watermarked regardless of PDF download policy.

Disabling export prevents the official PDF download; it does not prevent screenshots or other capture of the visible viewer.

## Regrade requests

The itemized result page always renders a request form for eligible rubric questions; when the exam's configured regrade window is closed or outside scheduled dates, the form displays the window dates and disables submission. The server validates the session, released script ownership, question membership, window, and request body; client-side checks are not an authorization boundary.

- `POST /api/student/regrade-requests` submits a request with the script ID, question number, and reason. The reason must contain 10–2000 characters after trimming. The server derives the student from the session and rejects duplicate active requests for the same student, exam, and question with HTTP 409 Conflict.
- `GET /api/student/regrade-requests` returns only the signed-in student's requests.
- The student status page at `/student/regrade-requests` displays the exam, question, reason, submission time, and request status (`open`, `reviewing`, `resolved`, or `rejected`). Note that transitions to `reviewing` and `resolved` are handled by professor/TA grading workflows scheduled for Week 11; student submissions initialize in the `open` state. The UI includes loading, empty, error, and retry states.

Both regrade endpoints require the request-regrade permission and return private, non-cacheable responses.

## Unpublishing and result revocation

When a professor unpublishes an exam (`POST /api/exams/[id]/unpublish` via AE-193):
- **Access Revocation**: Student result listings (`GET /api/student/results`) immediately revert the exam to unreleased (`NOT_AVAILABLE` or omitted). Itemized result details (`GET /api/student/results/[scriptId]`), page manifests, and watermarked page image streams return HTTP 404 Not Found.
- **Regrade Submissions Blocked**: Students cannot submit new regrade requests for an unpublished exam.
- **Preserved Records**: Previously delivered publication notifications in the student inbox and previously submitted regrade request status records remain visible for tracking and auditing purposes.
- **Local Artifacts**: Previously exported or downloaded watermarked PDFs stored locally on student devices cannot be revoked or recalled over the network.

## Deployment prerequisites

Before enabling the student results portal in production, the following environment variables and secrets must be configured:
- `STUDENT_RESULTS_ENABLED=true`: Server-side gate guarding student results, feedback, and regrade endpoints.
- `NEXT_PUBLIC_STUDENT_RESULTS_ENABLED=true`: Client-side UI gate enabling navigation and dashboard action links.
- `WATERMARK_HMAC_SECRET`: Cryptographic key used to sign and verify dynamic watermark tokens. If missing or unset, watermarked page image streaming and PDF exports fail closed.

## Authentication and authorization summary

Student APIs require an authenticated application session. Student-only routes verify that the account is active and has the student role. Script and page routes check that the requested resources belong to the authenticated student and that results are eligible for release. Altered, malformed, missing, or cross-student identifiers fail closed. API responses and client payloads omit internal storage keys, upload paths, and file references.

## Related tests

The student portal behavior, audit workflows, and access boundaries are covered by:

- `src/__tests__/ExamPublishAE190.test.ts`
- `src/__tests__/PublishPreviewModalAE191.test.tsx`
- `src/__tests__/ExamPublishNotificationAE192.test.ts`
- `src/__tests__/ExamUnpublishAE193.test.ts`
- `src/__tests__/StudentResultsAE182.test.ts`
- `src/__tests__/StudentReadOnlyViewerAE183.test.ts`
- `src/__tests__/StudentItemizedFeedbackAE184.test.ts`
- `src/__tests__/DynamicWatermarkAE186.test.ts`
- `src/__tests__/StudentPdfExportAE187.test.ts`
- `src/__tests__/ExamRegradeWindowAE197.test.ts`
- `src/__tests__/RegradeRequestsAE195.test.ts`
- `src/__tests__/RegradeRequestFormAE194.test.tsx`
- `src/__tests__/StudentRegradeRequestsAE196.test.tsx`
- `src/__tests__/PublishRegradeWorkflowAE198.test.ts`
- `src/__tests__/StudentViewerSecurityAE199.test.ts`
