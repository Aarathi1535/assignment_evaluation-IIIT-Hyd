# IIIT Hyderabad Learning Platform — API Conventions Specification

**Version:** 1.0.0  
**Date:** 2026-11-07  
**Status:** DRAFT (Submitted with Architecture Note v2)  
**Applies to:** Assignment Evaluation (`/api/v1/evaluation`), Classroom Activity (`/api/v1/classroom`), Personalised Learning (`/api/v1/personalized`)

---

## 1. Overview & Core Principles

All independent products and microservices across the IIIT Hyderabad Learning Platform adhere to a strict **API-First** design methodology. Services are decoupled from frontend UI frameworks (Next.js server-side pages) and operate as headless, contract-governed REST services capable of external institutional LMS integration (Canvas, Moodle, Blackboard) via LTI 1.3 and standalone client applications.

The foundational design principles are:
1. **Explicit Versioning:** All public endpoints reside under the `/v1` namespace (e.g., `/api/v1/classroom/*`).
2. **Predictable Envelopes:** Uniform JSON payloads for success, collections, and errors.
3. **Strict Authentication Boundaries:** Independent token validation per product with zero implicit cross-product trust.
4. **Resilient Idempotency:** Guaranteed safe retries for mutating operations (submissions, decisions, evaluations).
5. **Contract Truth:** Every endpoint is formally defined in OpenAPI 3.1 specifications under `docs/openapi/`.

---

## 2. URL Namespace & Versioning Conventions

### 2.1 URI Structure
All service endpoints adhere to the following URI format:
```
/api/v1/{product}/{resource}[/{id}][/{sub-resource}]
```

| Product | Path Prefix | Dedicated Port (Independent Mode) | Scope / Responsibility |
|---|---|---|---|
| **Assignment Evaluation** | `/api/v1/evaluation` | `3000` | Ingestion, rubrics, annotations, grading, regrading, analytics, exports |
| **Classroom Activity** | `/api/v1/classroom` | `3001` | Live sessions, PIN/QR guest joins, timed answer-sheet uploads, polls, live distributions |
| **Personalised Learning** | `/api/v1/personalized` | `3002` | Syllabus taxonomy, question bank, daily diagnostic practice, student mastery tracking |

> [!NOTE]
> Backward-compatible routes (e.g., `/api/exams/*`, `/api/grading/*`) are maintained during the transition period with deprecation notices header (`Deprecation: true`, `Sunset: Sun, 01 Jun 2027 00:00:00 GMT`).

---

## 3. Standard Request & Response Payloads

### 3.1 Success Response Envelope (Single Entity)
```json
{
  "success": true,
  "data": {
    "id": "672cd50172e27b4e9f7a9d01",
    "title": "Data Structures Midterm",
    "createdAt": "2026-11-07T12:00:00.000Z"
  },
  "meta": {
    "timestamp": "2026-11-07T12:00:01.120Z",
    "requestId": "req_01h7c9b0e1g2"
  }
}
```

### 3.2 Collection & Paginated Response Envelope
All list queries support standardized pagination parameters and return comprehensive cursor/offset metadata:

**Query Parameters:**
- `page`: 1-based page index (integer, default: `1`).
- `limit`: Items per page (integer, default: `20`, maximum: `100`).
- `sort`: Sort field name (string, e.g. `createdAt`, `title`).
- `order`: Sort direction (`asc` | `desc`, default: `desc`).

**Response Format:**
```json
{
  "success": true,
  "data": [
    {
      "id": "672cd50172e27b4e9f7a9d01",
      "sessionCode": "482910",
      "status": "ACTIVE"
    }
  ],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalCount": 42,
      "totalPages": 3,
      "hasNextPage": true,
      "hasPrevPage": false
    },
    "timestamp": "2026-11-07T12:00:01.120Z",
    "requestId": "req_01h7c9b0e1g3"
  }
}
```

### 3.3 Error Response Envelope
All error responses adhere to a standardized application JSON error envelope, returning a deterministic structure with machine-readable error codes and contextual debugging details:

```json
{
  "success": false,
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "The classroom session closed at 2026-11-07T11:45:00.000Z and no longer accepts submissions.",
    "details": {
      "sessionId": "672cd50172e27b4e9f7a9d01",
      "closedAt": "2026-11-07T11:45:00.000Z"
    }
  },
  "meta": {
    "timestamp": "2026-11-07T12:00:01.120Z",
    "requestId": "req_01h7c9b0e1g4"
  }
}
```

---

## 4. Standard HTTP Status Codes

Services return exact semantic HTTP status codes. Status code must match the internal error classification:

| Code | Meaning | Usage across Learning Platform APIs |
|---|---|---|
| `200 OK` | Request succeeded | `GET`, `PATCH`, `PUT` queries and safe operational triggers. |
| `201 Created` | Resource created | `POST` creation (e.g. create session, join session, submit answer sheet). Includes `Location` header. |
| `204 No Content` | Succeeded with no body | `DELETE` operations or acknowledgement commands. |
| `400 Bad Request` | Malformed request body | Validation failure, invalid date formatting, unparseable JSON. |
| `401 Unauthorized` | Missing / invalid credentials | Expired JWT, missing Bearer header, unverified guest token. |
| `403 Forbidden` | Authenticated but unauthorized | Student attempting professor action; student not enrolled in course. |
| `404 Not Found` | Resource does not exist | Invalid ID, unknown course, deleted exam. |
| `409 Conflict` | State transition disallowed | Duplicate active regrade request, session code already active, publishing unpublished exam. |
| `422 Unprocessable` | Semantic validation failed | Out-of-bounds score step, chronological inversion (`opensAt >= closesAt`). |
| `429 Too Many Requests` | Rate limit exceeded | Brute-force protection triggered (>5 failed logins in 15m), burst join limits. |
| `500 Internal Error` | Unhandled server error | Database down, uncaught exception (never leaks stack traces to client). |
| `503 Unavailable` | External dependency failure | Gemini LLM timeout, OCR worker temporarily unavailable. |

---

## 5. Authentication & Authorization Conventions

### 5.1 Token Delivery & Headers
Clients authenticate via standard HTTP Authorization headers:
```http
Authorization: Bearer <JWT_TOKEN>
```
For web browser clients operating within product subdomains, HTTP-only, SameSite=Lax secure cookies are supported:
- Assignment Evaluation: `next-auth.session-token`
- Classroom Activity: `classroom_token` (staff/students), `classroom_participant_token` (session guest)
- Personalised Learning: `personalized_token`

### 5.2 Session-Scoped Guest Participant Token
Guest joins (`POST /api/v1/classroom/join/{code}`) return an ephemeral, session-bound JWT:
```json
{
  "sub": "part_9f82a10b",
  "sessionId": "672cd50172e27b4e9f7a9d01",
  "sessionCode": "482910",
  "displayName": "Alice",
  "disambiguator": "2024101001",
  "role": "GUEST_PARTICIPANT",
  "iat": 1793961600,
  "exp": 1793976000
}
```
**Enforcement Rules:**
1. A guest participant token is valid ONLY for the designated `sessionId`.
2. Any call to another session ID using this token is rejected with `403 Forbidden`.
3. Guest tokens are rejected immediately with `403 Forbidden` across Assignment Evaluation and Personalised Learning routes.
4. Anonymous overwrite protection: If two students enter the same display name in a live session, the system requires a unique identifier (roll number) to prevent token collisions or answer overwrites.

### 5.3 Service-to-Service Authentication
When services communicate internally (e.g. Classroom Activity querying Course allocation from Evaluation Service):
- Authentication uses mTLS or an explicit signed inter-service token.
- Headers:
  ```http
  X-Internal-Service: classroom-service
  X-Internal-Signature: <HMAC_SHA256_SIGNATURE>
  X-Internal-Timestamp: 1793961600
  ```
- Signatures exceeding clock-skew tolerance (30 seconds) are rejected to prevent replay attacks.

---

## 6. Idempotency Conventions

Mutating operations that may be re-sent due to network retries (e.g., student answer uploads, poll response submissions, exam publication) support an `Idempotency-Key` header:
```http
Idempotency-Key: 7b864d42-0f18-4b72-881b-5136814d8b67
```

**Implementation Rules:**
1. Server records the idempotency key along with hash of the request body and user ID in Redis/MongoDB with an expiration TTL of 24 hours.
2. If an identical request with the same key arrives while the initial request is processing, the server returns `409 Conflict` or waits for the lock.
3. If the initial request succeeded, subsequent requests with the same key return the cached original response (`200 OK` or `201 Created`) with header `Idempotent-Replayed: true`.
4. If a request arrives with the same key but a *different* request body, the server rejects it with `422 Unprocessable Entity` (`IDEMPOTENCY_MISMATCH`).

---

## 7. Real-Time Streaming Conventions (SSE)

Real-time classroom activity features (live poll distributions, participation tallies) use **Server-Sent Events (SSE)** over standard HTTP/2 or HTTP/1.1:
- Endpoint: `GET /api/v1/classroom/sessions/{id}/events`
- Headers:
  ```http
  Content-Type: text/event-stream
  Cache-Control: no-cache, no-transform
  Connection: keep-alive
  ```

**Event Message Structure:**
```
event: poll_distribution_update
id: evt_109283
data: {"pollId":"672cd50172e27b4e9f7a9d09","totalResponses":48,"options":[{"index":0,"count":32,"percentage":66.7},{"index":1,"count":16,"percentage":33.3}]}

event: participation_tally
id: evt_109284
data: {"activeParticipants":52,"submittedAnswers":48}
```
- Heartbeat: A comment line `: ping\n\n` is transmitted every 15 seconds to prevent intermediate proxy connection timeouts.
- Reconnection: Clients use `Last-Event-ID` header to resume interrupted streams without missing critical state transitions.

---

## 8. Security & Privacy Gating

### 8.1 Sensitive Field Stripping
Student-facing endpoints MUST strip reference answers, grading rubrics, correct options, and competitor scores:
- `PersonalizedQuestion`: Remove `referenceAnswer`, `correctOptionIndex`, `generationPrompt`, and model rationale when returning payloads to students.
- `ClassroomQuestion`: Hide correct answer key until instructor explicitly triggers "reveal" state.

### 8.2 AI Data Leak Prevention Gate
Before any handwriting image or student text is transmitted to an external LLM (Gemini):
1. Check `isRealStudentData` flag (defaults to `true`).
2. When `true`, reject external transmission unless explicit institutional PII anonymization / pseudonymization is verified.
3. Keep results in `DRAFT_EVALUATED` state until human staff approves.
