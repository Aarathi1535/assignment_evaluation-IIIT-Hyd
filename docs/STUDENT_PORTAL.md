# Student Portal

This guide describes the student-facing course, exam, results, answer-script, and regrade-request workflows currently implemented in the application.

## Courses and exams

The student dashboard loads:

- `GET /api/courses` for courses in which the signed-in student is enrolled.
- `GET /api/exams` for active, published exams assigned to that student through the exam mapping or course enrollment.

Both endpoints require the authenticated application session and course-view permission. Student exam responses are shaped for student use rather than returning the full exam document. The dashboard displays course and exam summaries and refreshes when the page regains focus or at its periodic refresh interval.

## Result visibility

The results page calls `GET /api/student/results`. It shows the student's own exam records and whether each result is `RELEASED` or `NOT_AVAILABLE`. Scores and script links are returned only when the exam is active and published, the script is active and correctly identified, all required grading is final, and grading allocations are complete. Unpublished exams are not presented as released results.

The server-side `STUDENT_RESULTS_ENABLED` setting must be `true` for student result access. When the feature is disabled, result access returns a not-found response. The results list, detailed result, and viewer endpoints derive the student identity from the authenticated session; a client-supplied student ID is not an authorization input.

`GET /api/student/results/[scriptId]` returns itemized marks and feedback for an eligible result. Attempts to access a missing, unreleased, or another student's script are rejected rather than returning its result.

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

The itemized result page presents a request form for eligible rubric questions while the exam's configured regrade window is open. The server validates the session, released script ownership, question membership, window, and request body; client-side checks are not an authorization boundary.

- `POST /api/student/regrade-requests` submits a request with the script ID, question number, and reason. The reason must contain 10–2000 characters after trimming. The server derives the student from the session and rejects duplicate active requests for the same student, exam, and question.
- `GET /api/student/regrade-requests` returns only the signed-in student's requests.
- The student status page at `/student/regrade-requests` displays the exam, question, reason, submission time, and `open`, `reviewing`, or `resolved` status. It includes loading, empty, error, and retry states.

Both regrade endpoints require the request-regrade permission and return private, non-cacheable responses.

## Authentication and authorization summary

Student APIs require an authenticated application session. Student-only routes verify that the account is active and has the student role. Script and page routes check that the requested resources belong to the authenticated student and that results are eligible for release. Altered, malformed, missing, or cross-student identifiers do not grant access. Do not expose original upload URLs, storage paths, or internal file references to the browser.

## Related tests

The student portal behavior and access boundaries are covered by:

- `src/__tests__/StudentResultsAE182.test.ts`
- `src/__tests__/StudentReadOnlyViewerAE183.test.ts`
- `src/__tests__/StudentItemizedFeedbackAE184.test.ts`
- `src/__tests__/DynamicWatermarkAE186.test.ts`
- `src/__tests__/StudentPdfExportAE187.test.ts`
- `src/__tests__/RegradeRequestsAE195.test.ts`
- `src/__tests__/RegradeRequestFormAE194.test.tsx`
- `src/__tests__/StudentRegradeRequestsAE196.test.tsx`
- `src/__tests__/PublishRegradeWorkflowAE198.test.ts`

