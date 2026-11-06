# LTI 1.3 Assignment and Grade Services (AGS 2.0) Grade Passback Architecture

## 1. Overview & Mentor Architectural Alignment

This document defines the architecture and trust boundaries for integrating the Assignment Evaluator platform with Learning Management Systems (LMS) such as Canvas, Moodle, and Blackboard using the **IMS Global / 1EdTech LTI 1.3 (Learning Tools Interoperability)** specification and **Assignment and Grade Services (AGS) 2.0**.

As agreed with project leadership and mentors:
- The Assignment Evaluator platform maintains **headless services and decoupled REST APIs**.
- External LMS integration is performed via standard LTI 1.3 protocols rather than proprietary LMS-specific SDKs.
- In **AE-216**, the system establishes the **design, data contracts, security model, and a safe backend stub** without opening live outbound network sockets or claiming live LMS synchronization.

---

## 2. LTI 1.3 Trust Boundaries & Authentication

```
+-----------------------------------------------------------------------------------------+
|                                    LMS Platform (Canvas / Moodle)                       |
+-----------------------------------------------------------------------------------------+
       |                                                                   ^
       | 1. OIDC Launch Request (state, nonce)                            | 5. LTI AGS Score POST
       v                                                                   |    Bearer Token (RS256 JWT)
+--------------------------------------------------------------------------|--------------+
|                              Trust Boundary (Public Internet)            |              |
+--------------------------------------------------------------------------|--------------+
       v                                                                   |
+-----------------------------------------------------------------------------------------+
|                              Assignment Evaluator (LTI 1.3 Tool)                        |
|                                                                                         |
|  +--------------------+        +-------------------------+       +-------------------+  |
|  | LTI Launch Handler | -----> | Student ID Mapping      | ----> | LTI Grade         |  |
|  | (RS256 JWT Verify) |        | (AE-215 Course Scoped)  |       | Passback Service  |  |
|  +--------------------+        +-------------------------+       +-------------------+  |
|                                             |                                           |
|                                             v                                           |
|                                +-------------------------+                              |
|                                | Published Grades (DB)   |                              |
|                                +-------------------------+                              |
+-----------------------------------------------------------------------------------------+
```

### 2.1 Security & Cryptographic Handshake
1. **Asymmetric Key Exchange (RS256)**:
   - The LMS Platform and Assignment Evaluator maintain distinct RSA key pairs (minimum 2048-bit).
   - Public keys are exposed via standard JWKS endpoints (`/.well-known/jwks.json`).
   - Token assertions and LTI launches must be signed using RS256 and verified against the platform's JWKS.
2. **Launch & Token Acquisition (OIDC 1.0 + OAuth 2.0)**:
   - Tool verifies `iss` (Issuer), `aud` (Client ID), `nonce` (replay protection), and expiration (`exp`).
   - Outbound score submission authenticates using the **OAuth 2.0 Client Credentials Grant** with JWT Client Assertion (`urn:ietf:params:oauth:client-assertion-type:jwt-bearer`).
   - Requested scope: `https://purl.imsglobal.org/spec/lti-ags/scope/score`.

---

## 3. Grade Passback Flow (LTI-AGS 2.0)

### 3.1 Step-by-Step Flow
1. **Instructor Trigger**:
   - An authorized Professor or Administrator triggers grade passback for a published exam.
   - The trigger can be performed via the API (`POST /api/analytics/exams/[id]/lti/passback`) or UI.
2. **Authorization & Scope Verification**:
   - The user session is authenticated.
   - Role is verified (`PROFESSOR` or `ADMIN`). Non-owners are denied access (`404 Not Found`).
   - Exam must be `PUBLISHED` (`409 Conflict` if unpublished or still in draft).
   - The course boundary is verified: only grades for students enrolled in the exam's course can be passed back.
3. **Identifier Resolution (AE-215 Integration)**:
   - LMS identifiers (`sub` claim, `lis_person_sourcedid`, or course roll numbers) are resolved to internal student records using [`mapLmsStudentIdsToGrades`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/lmsMapping.ts).
   - Only **finalized, published grades** (`isFinal: true` on identified, non-conflicting answer scripts) are selected.
   - Missing, unmapped, or duplicate identifiers are handled gracefully without aborting the batch.
4. **Payload Construction**:
   - Each grade is translated into an LTI-AGS 2.0 `Score` JSON structure:
     ```json
     {
       "userId": "lms-student-identifier",
       "scoreGiven": 25.0,
       "scoreMaximum": 30.0,
       "comment": "Final exam grade from Assignment Evaluator",
       "timestamp": "2026-11-06T12:00:00.000Z",
       "activityProgress": "Completed",
       "gradingProgress": "FullyGraded"
     }
     ```
5. **Score Dispatch (Stub vs. Production)**:
   - **Stub Mode (AE-216)**: Validates payloads, checks trust boundaries, logs structured passback items, and records the simulated batch with `stubMode: true`. No external network socket is opened.
   - **Production (Future)**: Dispatches scores to the platform's LineItem score URL (`${lineitemUrl}/scores`) with exponential backoff and idempotency keys.

---

## 4. Cross-Course & Cross-Student Isolation

To strictly prevent data leakage between courses and students:
1. **Course Scoping**:
   - All student lookups require `course.enrolledStudents.includes(student._id)`.
   - Even if a student exists in the database with a matching email or roll number, if they are not in the current course's roster, their grade is **never exposed or passed back**.
2. **Duplicate Protection**:
   - If an input payload contains duplicate LMS IDs or maps multiple LMS IDs to the same internal student, the system marks the entries as `DUPLICATE_LMS_ID` or `DUPLICATE_STUDENT` and blocks score submission for those records.
3. **Grade Boundary Validation**:
   - Score must satisfy: `0 <= scoreGiven <= scoreMaximum`.
   - Scores outside bounds or `NaN`/infinite values are rejected with `INVALID_GRADE`.

---

## 5. Deferred Implementation Requirements (Roadmap to Production)

The following items are deliberately deferred to future deployment milestones when a dedicated LMS testing sandbox is provisioned:

| Component | Status in AE-216 | Production Requirement |
|---|---|---|
| **Outbound HTTP Client** | Stubbed (No network sockets) | Node.js `fetch` with TLS 1.3, connection pooling, and circuit breaker |
| **RSA Key Management** | Interfaces defined | Cloud KMS or HSM-backed RS256 private key with automatic JWKS rotation |
| **LMS Token Caching** | Memory stub cache interface | Redis-backed distributed OAuth 2.0 token cache with TTL expiration |
| **LineItem Auto-Discovery** | LineItem URL accepted in options | Automatic LineItem creation via LTI-AGS `GET /lineitems` query |
| **Retry & Dead Letter Queue**| In-memory error reporting | Background worker with exponential backoff and persistent retry queue |

