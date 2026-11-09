# LTI 1.3 Assignment and Grade Services (AGS 2.0) Grade Passback Architecture

## 1. Overview & Architectural Alignment

This document defines the architecture, data contracts, trust boundaries, and roadmap for integrating the Assignment Evaluator platform with Learning Management Systems (LMS) such as Canvas, Moodle, and Blackboard using the **IMS Global / 1EdTech LTI 1.3 (Learning Tools Interoperability)** specification and **Assignment and Grade Services (AGS) 2.0**.

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
       | 1. OIDC Launch Request (state, nonce, azp, deployment_id)        | 5. LTI AGS Score POST
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

2. **OIDC 1.0 Launch Verification**:
   - The Tool must strictly verify:
     - `iss` (Issuer identifier of the platform)
     - `aud` (OAuth 2.0 Client ID of the tool)
     - `azp` (Authorized Party claim: when present, must match the Tool's Client ID)
     - `https://purl.imsglobal.org/spec/lti/claim/deployment_id` (Deployment ID registered in the LMS)
     - `nonce` (Replay attack protection; checked against single-use session store)
     - `exp` (Token expiration timestamp)
     - `state` (OIDC state parameter verified against the initiator cookie to prevent CSRF)

3. **Outbound Score Dispatch (OAuth 2.0 Client Credentials Grant)**:
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
   - If the course is inactive, access is rejected with `409 Conflict`.
3. **Identifier Resolution (LTI `sub` Requirement)**:
   - In LTI 1.3 AGS 2.0, the `userId` in the Score payload **must be the platform user's immutable LTI `sub`** (subject identifier assigned by the LMS platform).
   - Internal roll numbers, emails, or MongoDB ObjectIds are **not** valid LTI platform `sub` identifiers.
   - **Mode A (External LMS Mapping)**: When the caller supplies `students` with explicit LMS student identifiers (`lmsStudentId` representing the platform `sub`), these are resolved to internal enrolled students via `src/lib/lmsMapping.ts`.
   - **Mode B (Roster Auto-Generation)**: When no external mapping is supplied, the platform does not currently persist the platform `sub` claim. Records in Mode B are marked as `SKIPPED` (not ready) rather than sending invalid roll numbers or emails that would be misassigned or rejected by a real LMS.
   - Only **finalized, published grades** (`isFinal: true` on identified, non-conflicting answer scripts) are selected.
4. **Payload Construction**:
   - Each mapped grade is translated into an LTI-AGS 2.0 `Score` JSON structure:
     ```json
     {
       "userId": "lms-platform-sub-identifier",
       "scoreGiven": 25.0,
       "scoreMaximum": 30.0,
       "comment": "Final published grade for Midterm Algorithms",
       "timestamp": "2026-11-09T16:00:00.000Z",
       "activityProgress": "Completed",
       "gradingProgress": "FullyGraded"
     }
     ```
   - `scoreMaximum` is derived from the exam's rubric total marks (the single source of truth matching evaluated student grades).
5. **Score Dispatch (Stub vs. Production)**:
   - **Stub Mode (AE-216)**: Validates payload schemas, enforces course and exam boundaries, attaches generated `Score` payloads, marks valid records as `NOT_SENT` (since no network socket is opened), and writes an audit log entry (`LTI_GRADE_PASSBACK_SIMULATED`) recording the simulation parameters.
   - **Production (Future)**: Dispatches scores to the platform's LineItem score URL (`${lineitemUrl}/scores`) via HTTPS with exponential backoff and idempotency keys.

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

## 5. Implementation Status & Production Roadmap

| Capability | Current Status in AE-216 | Production Requirement |
|---|---|---|
| **Data Contracts & Validation** | Complete (AGS 2.0 Score schema, HTTPS URL validation) | Production validation unchanged |
| **Outbound HTTP Client** | Stubbed (No network sockets opened; returns `NOT_SENT`) | Node.js `fetch` with TLS 1.3, connection pooling, and circuit breaker |
| **Audit Logging** | Implemented (`LTI_GRADE_PASSBACK_SIMULATED`) | Persistent audit record of live HTTP response codes and batch IDs |
| **RSA Key Management** | Architectural design defined (RS256 JWKS) | Cloud KMS or HSM-backed RS256 private key with automatic JWKS rotation |
| **OAuth 2.0 Token Caching**| Stubbed (No token requests made) | Distributed Redis-backed OAuth 2.0 token cache with TTL expiration |
| **LTI Platform Sub Storage**| Mode B marked NOT READY | Store platform `sub` from OIDC launch claims or NRPS roster synchronization |
| **LineItem Auto-Discovery** | Explicit LineItem URL accepted in options | Automatic LineItem discovery via LTI-AGS `GET /lineitems` query |
