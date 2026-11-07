# Architecture Note v2: Independent Product Architecture

**Document Version:** 2.1.0  
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

This note establishes the clarified dual-login strategy, headless microservice and API-first designs, LTI 1.3 grade passback specifications, student guest-join protocols, database isolation guarantees, AI privacy gates, and the step-by-step Git release sequence.

> [!IMPORTANT]
> **Implementation Sign-Off Gate**: Per mentor directives and project instructions, platform implementation work remains paused until Architecture Note v2 receives formal review and approval from the mentor and Prof. Jawahar.

---

## 2. Git Integration Sequence & Release Pre-Requisites

To guarantee zero regression of Assignment Evaluation features (including AE-202 through AE-220) and clean integration into `main`, the engineering workflow follows this exact sequential execution:

```
[PR #321 (hotfix)] ──> [main] (MERGED at b5def10)
                          ▲
[PR #324 (AE-190─200)] ──> [feature/exam-eval-platform] (OPEN DRAFT at 24e88d0)
                          ▲
[AE-202 ── AE-220] ───> [feature blocks: regrade, audit, analytics, export]
                          ▲
[Note v2 Sign-Off] ───> [Decomposed PRs: AI, Classroom, Personalised, Auth, Deploy]
```

### 2.1 Git Sequence Steps & Current Status

| Step | Action Item | Target / Destination | Current Status | Ownership / Blocker |
|---|---|---|---|---|
| **1** | Convert PR #323 to Draft | `refactor/independent-product-architecture` | **COMPLETED** | Draft mode active. Self-merge strictly prohibited. |
| **2** | Merge PR #321 (`hotfix/ingestion-summary-staff-auth`) | `main` | **COMPLETED** | Merged manually into `main` at commit `b5def10`. Verifies staff-only 403 on ingestion summary. |
| **3.1** | Land PRs #288–#299 into `feature/exam-eval-platform` | `feature/exam-eval-platform` | **COMPLETED** | Fast-forwarded to tip of stack (`docs/AE-200-student-portal` at `779f1e4`). |
| **3.2** | Merge `main` and open consolidated PR #324 | `main` | **COMPLETED** | PR #324 opened as Draft at commit `24e88d0`. All 73 focused tests and 181 comprehensive tests passing. |
| **3.3** | Review & Merge PR #324 into `main` | `main` | **PENDING MAINTAINER** | **External Action Required**: Maintainer/mentor review and merge of PR #324. |
| **3.4** | Upstream merge `main` into AE-202...AE-220 | Ticket branches | **HOLD UNTIL 3.3** | Single linear merge with no force-pushes, opening modular PRs per functional block (regrade, audit, analytics, export). |
| **4** | Review and Sign-Off on Architecture Note v2 | `docs/ARCHITECTURE_NOTE_v2.md` | **SUBMITTED FOR SIGN-OFF** | **External Action Required**: Review by mentor and Prof. Jawahar (including Guest-Join decision). |
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

### 3.1 Prototype Reality vs Target Architecture ("Working Towards")
As noted in the mentor review on PR #323, the initial prototype demonstrated high module reuse and passing unit tests, but true process, routing, and database isolation remain in a "Working Towards" state:
- All 36 business routes currently compile within the root Next.js build runtime.
- Database connections in the prototype shared the global Mongoose instance initialized by `instrumentation.ts`.
- Middleware rules in `proxy.ts` previously bypassed route-level role checks.
- Dockerfiles currently package the shared Next.js application image.

The decomposed roadmap in Section 10 systematically refactors these components into true standalone boundaries.

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

1. **Independent Product Accounts & Logins by Default:**
   - Products maintain separate, isolated user collections: `User` (Evaluation), `ClassroomUser` (Classroom), and `PersonalizedUser` (Personalised).
   - Passwords are encrypted independently using high-factor bcrypt (`12` rounds).
   - Each product handles its own registration and authentication lifecycle (`/login`, `/classroom/login`, `/personalized/login`).
2. **Optional Shared Platform Login (Explicitly Signed):**
   - When enabled, a shared platform token can authenticate a user across products without requiring separate logins.
   - The token must be cryptographically signed by the central platform identity provider and verified against `PLATFORM_SHARED_SECRET` or `PLATFORM_PUBLIC_KEY`.
   - **Independent Product Configuration:** Shared login must be independently toggleable per product (e.g., `CLASSROOM_ENABLE_SHARED_AUTH=true`, `PERSONALIZED_ENABLE_SHARED_AUTH=true`). A product with this disabled accepts only its native credentials.
3. **Strict Account Isolation (Never Automatic Email Linking):**
   - Products must **never automatically link, merge, or grant cross-access** simply because email addresses match.
   - An account registered in Classroom Activity with `alice@iiit.ac.in` has zero implicit connection to `alice@iiit.ac.in` in Assignment Evaluation or Personalised Learning unless explicitly federated via the signed platform token.

### 4.2 Student Guest-Join & Session Security
In live classroom environments, students frequently join sessions via mobile devices scanning QR codes or entering 6-digit access codes:

1. **Session-Scoped Participant Token:**
   - When a student joins via `POST /api/v1/classroom/sessions/{code}/join`, the server validates the active session PIN, records participant registration, and issues an ephemeral, cryptographically signed `classroom_participant_token` containing `{ sessionId, participantId, studentIdentifier }`.
2. **Elimination of Anonymous Hijacking & Answer Overwriting:**
   - Form submissions to `POST /api/v1/classroom/submit` require the signed participant token (passed via cookie or `Authorization: Bearer <token>`). Submissions omitting the token or attempting to forge `participantId` are rejected with `401 Unauthorized`.
   - Duplicate name entries within the same live session require a disambiguating identifier (e.g. roll number) rather than silently returning an existing student's token and allowing answer overwriting.
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
Each independent service publishes a formal OpenAPI contract in `docs/openapi/`:
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

### 7.1 Multi-Database Connection Architecture
To guarantee genuine database isolation and prevent connection hijacking:
- `src/lib/classroomDb.ts`: Uses `mongoose.createConnection(process.env.MONGODB_CLASSROOM_URI)`. Models are compiled on this dedicated connection instance.
- `src/lib/personalizedDb.ts`: Uses `mongoose.createConnection(process.env.MONGODB_PERSONALIZED_URI)`. Models are compiled on this dedicated connection instance.
- `src/lib/db.ts`: Preserves the primary connection for Assignment Evaluation (`MONGODB_URI`).
- Standalone MongoDB topologies in development and replica set configurations in production are supported without connection crashes.

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

## 9. Questions & Decisions for Prof. Jawahar's Review & Sign-Off

To ensure exact alignment before proceeding to platform implementation, the following key architectural questions are submitted for Prof. Jawahar's direction:

### Decision 1: Guest Join vs Registered Student Role for Graded Submissions
- **Context:** Students can enter live classroom sessions quickly using a 6-digit PIN or QR code as an anonymous guest.
- **Question:** Should anonymous guest participants be permitted to upload physical handwritten answer sheets for formal grading, or should anonymous guest access be restricted strictly to Mentimeter-style live polling, requiring registered student accounts for graded answer-sheet submissions?
- **Engineering Recommendation:** 
  - Allow guest access for real-time engagement polls.
  - Require a registered student identity (or post-session claim with roll number) for long-form answer-sheet evaluation, ensuring results tie directly into academic records and grade passback.

### Decision 2: Human-in-the-Loop Review for AI Handwriting Evaluations
- **Context:** Automated OCR and rubric matching evaluate student handwriting images.
- **Question:** Should AI evaluations remain in `DRAFT_EVALUATED` state until explicitly approved by the professor/TA, or can simple objective questions (e.g. numeric answers, single formulas) auto-finalize if OCR confidence exceeds a threshold (e.g. 95%)?
- **Engineering Recommendation:** Enforce human-in-the-loop review for all handwritten submissions initially, marking results as draft until approved by staff.

### Decision 3: Shared Platform Login Rollout Schedule
- **Context:** Students and instructors may prefer a single set of credentials while each product remains technically independent.
- **Question:** Should we maintain completely separate logins during Phase 1 with the shared platform login introduced as an opt-in configuration in Phase 2?
- **Engineering Recommendation:** Implement independent product authentication first to guarantee system decoupling, followed by the optional signed platform token adapter.

---

## 10. Decomposed Implementation Roadmap (Post-Approval PR Blocks)

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
| **Prof. C.V. Jawahar** (Lead Advisor) | `PENDING REVIEW` | Waiting for review of guest-join decision, AI review gate, and poll/handwriting dual focus. |
| **Engineering Implementation Team** | `SIGNED` | Architecture Note v2.1 authored and ready for implementation upon sign-off. |
