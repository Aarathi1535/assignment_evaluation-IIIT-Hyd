# Architecture Note v2: Independent Product Architecture

**Document Version:** 2.0.0  
**Date:** 2026-11-07  
**Status:** DRAFT (Submitted for Mentor & Stakeholder Sign-Off)  
**Authors:** Learning Platform Engineering Team  
**Reviewers:** Laxmi Narayana Murthy Vemuri (Mentor), Prof. C.V. Jawahar (Lead Advisor)

---

## 1. Executive Summary & Purpose

Following architectural review feedback on PR #323, this document formalizes the target architecture for transitioning the IIIT Hyderabad Learning Platform from a monolithic assignment evaluation system into three decoupled, independently viable products accessible through a unified discovery experience:

1. **Assignment Evaluation (Product 1):** The core grading engine, rubric manager, script annotation, grading consistency, regrading, and analytics platform.
2. **Classroom Activity (Product 2):** A real-time classroom assessment and engagement system featuring timed handwritten answer-sheet image capture/verification and Mentimeter-inspired live participation polls.
3. **Personalised Learning (Product 3):** An adaptive diagnostic and question-bank system driving personalized daily practice and concept mastery tracking.

This note incorporates the clarified login strategy, headless microservice and API-first designs, LTI 1.3 grade passback specifications, student guest-join protocols, database isolation guarantees, AI privacy gates, and the step-by-step Git release sequence.

> [!IMPORTANT]
> **Implementation Sign-Off Gate**: Per mentor directives and project instructions, platform implementation work remains paused until Architecture Note v2 receives formal review and approval.

---

## 2. Git Integration Sequence & Release Pre-Requisites

To guarantee zero regression of Assignment Evaluation features (including AE-202 through AE-220) and clean integration into `main`, the engineering workflow follows this exact sequential execution:

```
[PR #321 (hotfix)] ──> [main]
                          ▲
[PRs #288─#299] ──────> [feature/exam-eval-platform]
                          ▲
[AE-202 ── AE-220] ───> [feature blocks: regrade, audit, analytics, export]
                          ▲
[Note v2 Sign-Off] ───> [Decomposed PRs: AI, Classroom, Personalised, Auth, Deploy]
```

### 2.1 Git Sequence Steps

| Step | Action Item | Target / Destination | Current Status | Ownership / Blocker |
|---|---|---|---|---|
| **1** | Convert PR #323 to Draft | `refactor/independent-product-architecture` | **COMPLETED** (Draft state active) | Self-merge strictly prohibited. |
| **2** | Merge PR #321 (`hotfix/ingestion-summary-staff-auth`) | `main` | **OPEN / READY** | **External Action Required**: Needs mentor/maintainer merge to `main`. (Fixes data leak; verified 403). |
| **3.1** | Land PRs #288–#299 | `feature/exam-eval-platform` | **OPEN / STACKED** | Stacked branches #288–#299 to be merged into `feature/exam-eval-platform`. |
| **3.2** | Open PR `feature/exam-eval-platform` -> `main` | `main` | **PENDING 3.1** | Creates canonical base on `main`. |
| **3.3** | Upstream merge into AE-202...AE-220 | Ticket branches | **PENDING 3.2** | Single linear merge with no force-pushes, resolving 18 conflicting files cleanly. |
| **3.4** | Open reviewable PRs per functional block | `feature/exam-eval-platform` / `main` | **PENDING 3.3** | Modular PRs: (a) Regrade, (b) Audit log hardening, (c) Analytics, (d) Grade export. |
| **4** | Review and Sign-Off on Architecture Note v2 | `docs/ARCHITECTURE_NOTE_v2.md` | **SUBMITTED FOR SIGN-OFF** | **External Action Required**: Mentor & Prof. Jawahar approval. |
| **5** | Implement Modular Multi-Product PRs | Dedicated feature branches | **ON HOLD (Gated on Step 4)** | Decomposed PRs to be submitted in order. |

---

## 3. Product Architecture & Service Boundaries

```
                         ┌────────────────────────────────────────────────────────┐
                         │   Unified Discovery Portal (src/app/page.tsx)          │
                         │   Landing Hub & Entry Point (Independent Contexts)     │
                         └──────────────┬──────────────────┬──────────────────────┘
                                        │                  │
              ┌─────────────────────────┼──────────────────┼─────────────────────────┐
              │                         │                  │                         │
              ▼                         ▼                  ▼                         ▼
   ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
   │ Product 1: Evaluation│  │ Product 2: Classroom │  │ Product 3: Personal  │
   ├──────────────────────┤  ├──────────────────────┤  ├──────────────────────┤
   │ Port: 3000           │  │ Port: 3001           │  │ Port: 3002           │
   │ DB: MONGODB_URI      │  │ DB: CLASSROOM_URI    │  │ DB: PERSONALIZED_URI │
   │ Auth: NextAuth       │  │ Auth: Classroom JWT  │  │ Auth: Personal JWT   │
   │ Storage: eval-data/  │  │ Storage: class-data/ │  │ Storage: pers-data/  │
   │ APIs: /api/v1/eval   │  │ APIs: /api/v1/class  │  │ APIs: /api/v1/pers   │
   └──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

### 3.1 Product 1: Assignment Evaluation
- **Mission:** Preserved core examination grading, multi-grader allocations, rubric-based script grading, re-grading workflows, statistical analytics, and authorized CSV/XLSX exports.
- **Runtime Port:** `3000`
- **Database:** `MONGODB_URI` (`connectDB()`) using isolated Mongoose client.
- **Identity & Auth:** NextAuth session cookie (`next-auth.session-token`).
- **Access Endpoints:** `/login`, `/admin`, `/professor`, `/ta`, `/student`, `/api/grading/*`, `/api/exams/*`, `/api/analytics/*`, `/api/export/*`.

### 3.2 Product 2: Classroom Activity
- **Mission:** Real-time classroom assessment blending timed handwritten answer-sheet uploads with Mentimeter-inspired live engagement polling.
- **Runtime Port:** `3001`
- **Database:** `MONGODB_CLASSROOM_URI` (`connectClassroomDB()`) using isolated connection instance.
- **Identity & Auth:**
  - Instructor/TA: Independent HMAC-SHA256 JWT (`classroom_token`).
  - Student / Guest: Ephemeral session-scoped participant token (`classroom_participant_token`).
- **Access Endpoints:** `/classroom`, `/classroom/login`, `/classroom/register`, `/classroom/join`, `/api/v1/classroom/*`.

### 3.3 Product 3: Personalised Learning
- **Mission:** Diagnostic knowledge mastery, adaptive daily practice scheduling, curriculum syllabus taxonomy, and AI question generation.
- **Runtime Port:** `3002`
- **Database:** `MONGODB_PERSONALIZED_URI` (`connectPersonalizedDB()`) using isolated connection instance.
- **Identity & Auth:** Independent HMAC-SHA256 JWT (`personalized_token`).
- **Access Endpoints:** `/personalized`, `/personalized/login`, `/personalized/register`, `/personalized/today`, `/api/v1/personalized/*`.

---

## 4. Authentication & Identity Strategy (The Clarified Login Decision)

### 4.1 Dual Authentication Model
In accordance with mentor instructions, the platform supports both **independent local credentials** and an **optional shared platform identity**:

```
                  ┌──────────────────────────────────────────────┐
                  │          Identity Provider (IdP)             │
                  │   Central / Shared Platform Identity Server  │
                  └──────────────────────┬───────────────────────┘
                                         │ Explicitly signed Platform Token
                                         ▼ (HMAC/RSA with PLATFORM_PUBLIC_KEY)
         ┌───────────────────────────────┼───────────────────────────────┐
         │ (Configurable via env)        │ (Configurable via env)        │ (Configurable via env)
         ▼                               ▼                               ▼
┌──────────────────┐            ┌──────────────────┐            ┌──────────────────┐
│ Product 1 Auth   │            │ Product 2 Auth   │            │ Product 3 Auth   │
├──────────────────┤            ├──────────────────┤            ├──────────────────┤
│ NextAuth Local   │            │ Classroom Local  │            │ Personalized     │
│       OR         │            │       OR         │            │ Local    OR      │
│ Shared Platform  │            │ Shared Platform  │            │ Shared Platform  │
└──────────────────┘            └──────────────────┘            └──────────────────┘
```

1. **Independent Account Registries:**
   - Products maintain isolated user collections: `User` (Evaluation), `ClassroomUser` (Classroom), and `PersonalizedUser` (Personalised).
   - Passwords are encrypted independently with high-factor bcrypt.
2. **Explicit Shared Platform Login:**
   - A shared platform token can be accepted by each product when enabled via `ENABLE_SHARED_PLATFORM_AUTH=true`.
   - The token is cryptographically verified against `PLATFORM_SHARED_SECRET` / `PLATFORM_PUBLIC_KEY`.
   - Products validate the signed claims (e.g., `sub`, `email`, `role`, `authorized_products`).
3. **Strict Account Isolation (No Email Linking):**
   - Accounts are **never automatically linked or merged** just because email addresses match across products.
   - An account in Classroom Activity remains entirely separate from an account with the same email in Personalised Learning unless explicitly federated through the shared platform identity provider.

### 4.2 Student Guest-Join & Session Security (Decision for Prof. Jawahar)
In live classroom environments, students frequently join sessions on mobile devices via QR codes or 6-digit access codes. The protocol must prevent impersonation, answer hijacking, and unauthorized grading access:

1. **Session-Scoped Participant Token:**
   - When a student joins via `POST /api/v1/classroom/sessions/{code}/join`, the server verifies the active session PIN, creates or validates a participant entry, and issues an ephemeral, cryptographically signed `classroom_participant_token` containing `{ sessionId, participantId, studentIdentifier }`.
2. **Elimination of Anonymous Hijacking:**
   - Form submissions to `POST /api/v1/classroom/submit` require the signed participant token (passed via cookie or `Authorization: Bearer <token>`). Submissions omitting the token or attempting to forge `participantId` are rejected with `401 Unauthorized`.
   - Duplicate name entries within the same live session prompt the user for an disambiguating identifier (e.g. roll number) rather than silently returning an existing student's token and overwriting previous answers.
3. **No Cross-Product Leakage:**
   - Guest participant tokens are strictly rejected by Assignment Evaluation and Personalised Learning APIs (`403 Forbidden`).

---

## 5. Classroom Activity: Core Functional Pillars

As clarified by Prof. Jawahar and the student team, live polls are an **engagement mechanism** and do **not** replace handwritten answer-sheet evaluation. Classroom Activity delivers two complementary capabilities:

```
                                Classroom Activity
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼                                               ▼
     ┌───────────────────────┐                       ┌───────────────────────┐
     │   Pillar 1: Timed     │                       │  Pillar 2: Real-Time  │
     │   Handwritten Uploads │                       │  Engagement Polls     │
     ├───────────────────────┤                       ├───────────────────────┤
     │ - Physical paper write│                       │ - Mentimeter-style    │
     │ - Mobile photo capture│                       │ - Live question push  │
     │ - Strict time window  │                       │ - Instant aggregate   │
     │ - OCR & AI draft score│                       │   distribution graphs │
     │ - Professor audit &   │                       │ - Participation stats │
     │   final verification  │                       │ - Live SSE broadcast  │
     └───────────────────────┘                       └───────────────────────┘
```

### 5.1 Pillar 1: Timed Handwritten Answer-Sheet Submission & Verification
1. **Physical Writing & Image Submission:**
   - Students write detailed, long-form solutions on paper within the timed classroom window.
   - Using the mobile interface, students capture clear photos of their answer sheets and upload them via `/api/v1/classroom/upload-sheet`.
2. **AI-Assisted Draft Verification (Human-in-the-Loop):**
   - Uploaded answer sheets are processed through handwriting OCR and rubrics to generate draft scores.
   - **Crucial Rule:** AI evaluations are strictly marked as `STATUS: DRAFT_EVALUATED`. No grade is finalized or released to students until the professor/TA inspects the extracted text, verifies accuracy, and clicks "Approve Evaluation".
3. **Removal of Test Backdoors:**
   - All test hooks (such as `answerText` injection or PNG `tEXt` chunk auto-marking) are completely removed from production services.

### 5.2 Pillar 2: Mentimeter-Inspired Live Classroom Engagement
1. **Interactive Participation Prompts:**
   - Professors can dispatch quick multiple-choice polls, opinion checks, or conceptual temperature-checks during lectures.
2. **Real-Time Visualization:**
   - Live responses stream via Server-Sent Events (`/api/v1/classroom/events`).
   - The instructor display renders dynamic response distribution charts showing aggregate engagement in real time without disclosing individual student names prematurely.

---

## 6. Headless Independent Services & API-First Architecture

To satisfy Prof. Jawahar's requirement that services operate independently and integrate with other institutional Learning Management Systems (Canvas, Moodle, Blackboard):

### 6.1 Versioned `/v1` Service Contracts
All products expose clean, versioned headless APIs decoupled from Next.js server-side page rendering:

- **Assignment Evaluation:** `/api/v1/evaluation/*` (with `/api/exams/*` and `/api/grading/*` maintained for backward compatibility).
- **Classroom Activity:** `/api/v1/classroom/*` (sessions, join, submit, poll, review, stream).
- **Personalised Learning:** `/api/v1/personalized/*` (daily, questions, schedules, evaluate).

### 6.2 OpenAPI 3.1 Specifications
Each independent service provides a formal OpenAPI contract in `docs/openapi/`:
- `docs/openapi/evaluation-v1.yaml`
- `docs/openapi/classroom-v1.yaml`
- `docs/openapi/personalized-v1.yaml`

These definitions allow external developers and LMS teams to generate client SDKs and validate payloads independently of our frontend UI.

### 6.3 LTI 1.3 Advantage Integration Architecture
Expanding on the design in `AE-216` (`docs/LTI_1_3_GRADE_PASSBACK.md`):
- **IMS LTI 1.3 Core:** OAuth 2.0 / OIDC stateful launch flow (`/api/lti/login`, `/api/lti/launch`).
- **Assignment and Grade Services (AGS v2p0):** Headless grade passback publishing finalized student marks directly to LMS gradebooks (Moodle, Canvas) using JSON-LD payloads.
- **Names and Role Provisioning Services (NRPS v2p0):** Headless roster synchronization mapping LMS student IDs to internal student identities.

---

## 7. Database Isolation & Connection Architecture

### 7.1 Root Cause Analysis of Connection Leaking
In the initial prototype, setting `MONGODB_CLASSROOM_URI` to a separate host was ineffective because `instrumentation.ts` initialized the default Mongoose connection on server start, and `classroomDb.ts` reused `mongoose.connection` if `readyState === 1`. Consequently, all classroom collections were placed in the Evaluation database.

### 7.2 Independent Connection Pools
The database connection managers are refactored to use isolated Mongoose connections:

```typescript
// src/lib/classroomDb.ts
import mongoose, { Connection } from 'mongoose';

let classroomConn: Connection | null = null;

export async function connectClassroomDB(): Promise<Connection> {
  if (classroomConn && classroomConn.readyState === 1) {
    return classroomConn;
  }
  const uri = process.env.MONGODB_CLASSROOM_URI || process.env.MONGODB_URI!;
  classroomConn = await mongoose.createConnection(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  }).asPromise();
  return classroomConn;
}
```

- Models are bound directly to their respective connections via `conn.model(...)` rather than the global `mongoose.model(...)`.
- The system handles standalone MongoDB instances in development and replica sets in production with uniform transaction fallbacks.

---

## 8. Security, AI Privacy & Vulnerability Remediation

| Vulnerability / Defect | Root Cause | Remediation in Target Implementation |
|---|---|---|
| **Default PROFESSOR Role on Register** | Open registration accepted any role parameter or defaulted to PROFESSOR. | Public registration strictly creates `STUDENT` accounts. `PROFESSOR` and `TA` roles require an authenticated admin invitation code or domain whitelist check. |
| **Weak Password & Brute-Force** | Single-character passwords allowed; zero login rate limiting. | Minimum 8 characters with complexity checks. Exponential backoff and maximum 5 failed attempts per 15-minute window per IP/user. |
| **Inactive User Authentication** | `isActive` flag ignored during credential validation. | Explicit check `if (!user.isActive) throw new UnauthorizedException('Account disabled')`. |
| **Hard-coded Secret Fallbacks** | Secret fallbacks (`dev-secret`) enabled token cross-use across products. | Removal of all hardcoded literals. System throws configuration errors at boot if `CLASSROOM_JWT_SECRET`, `PERSONALIZED_JWT_SECRET`, or `NEXTAUTH_SECRET` are unset. |
| **Session Bleed in Middleware** | Evaluation session was accepted by product endpoints without role checks. | Product tokens verified independently; Evaluation sessions must possess explicit permissions (`VIEW_COURSES`, `MANAGE_EXAMS`) to access administrative product paths. |
| **Unenrolled Question Access** | Endpoint `/api/personalized/questions` returned reference answers and answer keys to unenrolled students. | Strip `referenceAnswer`, `correctOptionIndex`, and rubric grading criteria from student payloads. Enforce course enrollment checks. |
| **Cross-Professor Generation** | Professor could trigger question generation on unassigned course IDs. | Validate professor course allocation before initiating Gemini question generation. |
| **AI Student Data Leak** | Real handwriting images sent to LLM without gating. | Enforce `isRealStudentData` flag. Default to `true`. Mask student PII and reject LLM transmission unless explicit consent/anonymization is applied. |
| **Deprecated Gemini Model** | Hardcoded `gemini-1.5-flash` / `gemini-2.5-flash`. | Model names parameterized via `GEMINI_MODEL` environment variable, defaulting to current LTS models. |

---

## 9. HTTP-Level Verification & Testing Framework

To ensure that `proxy.ts`, authentication cookies, and API contracts work reliably in production, real route-level HTTP tests will be added:

```
[HTTP Test Suite] ──> [Next.js Request Pipeline] ──> [proxy.ts Router] ──> [Isolated API Route]
```

### Planned HTTP-Level Tests:
1. **Classroom Auth & Session Cycle:**
   - Register new user via `POST /api/classroom/auth/register` (verifies `STUDENT` default role).
   - Log in via `POST /api/classroom/auth/login` (receives signed `classroom_token`).
   - Call `GET /api/classroom/sessions` with cookie (verifies HTTP 200).
   - Call without cookie (verifies HTTP 401).
2. **Personalised Auth & Today Route:**
   - Register & log in via `POST /api/personalized/auth/login`.
   - Call `GET /api/personalized/today` with cookie (verifies HTTP 200).
   - Call with Classroom token (verifies HTTP 401/403).
3. **Guest Join & Hijack Prevention:**
   - Join session via `POST /api/classroom/sessions/{code}/join`.
   - Submit answers with participant token (verifies HTTP 200).
   - Attempt submission with forged name or missing token (verifies HTTP 401).
4. **Data Isolation Test:**
   - Verify that inserts into `ClassroomUser` do not appear in `User` or touch the Assignment Evaluation database.

---

## 10. Implementation Roadmap (Post-Approval PR Blocks)

Following mentor and stakeholder approval of this document, implementation will be executed in targeted, reviewable pull requests:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 4: Architecture Note v2 Review & Sign-Off (Current Step)         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 5.1: Core AI Privacy & Model Parameterization PR                 │
│ - isRealStudentData gating, GEMINI_MODEL env, DRAFT evaluation status  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 5.2: Classroom Core & Live Polling PR                            │
│ - Mentimeter-style live polling, SSE distribution stream               │
│ - Retain handwriting submission pipeline (clean of test backdoors)     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 5.3: Personalised Learning Question Bank & Security PR           │
│ - Strip answer keys from student payloads, course allocation check     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 5.4: Identity, Auth Hardening & Database Isolation PR            │
│ - Dual login model, no email auto-linking, separate mongoose pools     │
│ - Role hardening (no default PROFESSOR), brute-force protection        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 5.5: Unified Landing Page, Proxy Routing & HTTP E2E Tests PR     │
│ - Keep logged-in user redirects, proxy rule hardening, HTTP test suite │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 5.6: Independent Container Deployment PR                         │
│ - Validated Dockerfiles & docker-compose.products.yml per product      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Sign-Off & Approvals

| Stakeholder / Role | Status | Notes / Signature |
|---|---|---|
| **Laxmi Narayana Murthy Vemuri** (Mentor) | `PENDING REVIEW` | Waiting for review of dual-login, Git sequence, and isolation design. |
| **Prof. C.V. Jawahar** (Lead Advisor) | `PENDING REVIEW` | Waiting for review of guest-join security and poll/handwriting dual focus. |
| **Engineering Implementation Team** | `SIGNED` | Architecture Note v2 authored and ready for implementation upon sign-off. |

