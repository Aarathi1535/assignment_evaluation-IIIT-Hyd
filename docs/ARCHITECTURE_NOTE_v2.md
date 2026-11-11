# Architecture Note v2: Independent Product Architecture

**Document Version:** 2.2.0
**Date:** 2026-11-10
**Status:** REVISED DRAFT (Addressing Mentor Review Points 3–10 — Submitted for Sign-Off)
**Authors:** Learning Platform Engineering Team  
**Reviewers:** Laxmi Narayana Murthy Vemuri (Mentor), Prof. C.V. Jawahar (Lead Advisor)

---

## 1. Executive Summary & Purpose

Following architectural review feedback on PR #323, this document formalizes the target architecture for transitioning the IIIT Hyderabad Learning Platform from a monolithic assignment evaluation system into three decoupled, independently viable products accessible through a unified discovery experience:

1. **Assignment Evaluation (Product 1):** The core grading engine, rubric manager, handwritten script annotation, multi-grader allocations, regrading, and comprehensive analytics/export platform.
2. **Classroom Activity (Product 2):** A real-time classroom assessment and engagement system featuring timed physical handwritten answer-sheet image capture/verification alongside Mentimeter-inspired live participation polls.
3. **Personalised Learning (Product 3):** An adaptive diagnostic and question-bank system driving personalized daily practice and concept mastery tracking.

The platform is designed as **separate headless services** capable of operating independently and integrating with external institutional Learning Management Systems (LMS) such as Canvas, Moodle, and Blackboard via **LTI 1.3 Advantage**.

> [!IMPORTANT]
> **Mandatory Architecture Approval Gate**: Per mentor directives and project instructions, platform implementation (Step 5) remains strictly paused until Architecture Note v2 receives formal written review and sign-off from the mentor and Prof. Jawahar.

---

## 2. Git Integration Sequence & Release Pre-Requisites

To guarantee zero regression of Assignment Evaluation features (including AE-190 through AE-220) and clean integration into `main`, the engineering workflow follows this exact sequential execution:

```
[PR #321 (hotfix)] ──> [main] (MERGED at b5def10)
                          ▲
[PR #324 (AE-190─200)] ──> [feature/exam-eval-platform] (OPEN DRAFT at 24e88d0)
                          ▲
[Block 1: PR #325 (Regrade)] ──> [feature/exam-eval-platform] (OPEN DRAFT, head: AE-205)
                          ▲
[Block 2: PR #326 (Audit)]   ──> [feature/AE-205-reviewer-assignment] (OPEN DRAFT, head: AE-209)
                          ▲
[Block 3: PR #327 (Analytics)] ──> [feature/AE-209-audit-csv-export] (OPEN DRAFT, head: AE-213)
                          ▲
[Block 4: PR #328 (Export)]   ──> [feature/AE-213-question-level-analytics] (OPEN DRAFT, head: AE-220)
                          ▲
[Note v2 Sign-Off Gate] ───> [Decomposed PRs: AI, Classroom, Personalised, Auth, Deploy]
```

### 2.1 Git Sequence Steps & Current Verified Status

| Step | Action Item | Target / Destination | Current Status | Ownership / Details |
|---|---|---|---|---|
| **1** | Convert PR #323 to Draft | `refactor/independent-product-architecture` | **COMPLETED** | Draft mode active. Self-merge strictly prohibited. |
| **2** | Merge PR #321 (`hotfix/ingestion-summary-staff-auth`) | `main` | **COMPLETED** | Merged manually into `main` at commit `b5def10`. Verifies staff-only 403 on ingestion summary. |
| **3.1** | Land PRs #288–#299 into `feature/exam-eval-platform` | `feature/exam-eval-platform` | **COMPLETED** | Fast-forwarded to tip of stack (`docs/AE-200-student-portal` at `779f1e4`). |
| **3.2** | Merge `main` and open consolidated PR #324 | `main` | **COMPLETED** | PR #324 opened as Draft at commit `24e88d0`. All 73 focused tests and 181 comprehensive tests passing. |
| **3.3** | Upstream merge `feature/exam-eval-platform` into AE-202...AE-220 | Ticket branches | **COMPLETED** | Merged cleanly once through stack with zero force-pushes (`805643e` -> `c399d89` -> `77dfdff` -> `d1af2ce` -> `60cb4c4`). |
| **3.4** | Open reviewable PRs per functional block | Stacked PRs | **COMPLETED** | PR #325 (Regrade), PR #326 (Audit), PR #327 (Analytics), PR #328 (Export) opened as Drafts. |
| **4** | Review and Sign-Off on Architecture Note v2 | `docs/ARCHITECTURE_NOTE_v2.md` | **SUBMITTED FOR SIGN-OFF** | **External Action Required**: Review by mentor and Prof. Jawahar. |
| **5** | Implement Modular Multi-Product PRs | Dedicated feature branches | **ON HOLD (Gated on Step 4)** | Decomposed PRs to be submitted in order once approved. |

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
   │ DB: MONGODB_URI      │  │ DB: MONGODB_         │  │ DB: MONGODB_         │
   │                      │  │     CLASSROOM_URI    │  │     PERSONALIZED_URI │
   │ Auth: NextAuth (IdP) │  │ Auth: Classroom JWT  │  │ Auth: Personal JWT   │
   │ Storage: GCS Bucket  │  │ Storage: GCS Bucket  │  │ Storage: GCS Bucket  │
   │   gs://iiit-eval-    │  │   gs://iiit-class-   │  │   gs://iiit-pers-    │
   │        platform-prod │  │        room-prod     │  │        onalized-prod │
   │ IAM: sa-eval@...     │  │ IAM: sa-class@...    │  │ IAM: sa-pers@...     │
   │ APIs: /api/v1/eval   │  │ APIs: /api/v1/class  │  │ APIs: /api/v1/pers   │
   └──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

### 3.1 Cloud Storage Isolation & IAM Service Accounts
In accordance with mentor directives, physical file and image storage is isolated per product using dedicated Google Cloud Storage buckets and service accounts:
- **Assignment Evaluation:** `gs://iiit-eval-platform-prod` accessed exclusively via service account `sa-eval@iiit-eval-platform.iam.gserviceaccount.com`.
- **Classroom Activity:** `gs://iiit-classroom-prod` accessed exclusively via service account `sa-class@iiit-eval-platform.iam.gserviceaccount.com`.
- **Personalised Learning:** `gs://iiit-personalized-prod` accessed exclusively via service account `sa-pers@iiit-eval-platform.iam.gserviceaccount.com`.

Local directory paths (`eval-data/`, `class-data/`, `pers-data/`) are used strictly as local development fallbacks; production deployments enforce strict bucket-level IAM policies preventing any service from reading or modifying another product's artifacts.

### 3.2 Prototype Reality vs Target Architecture ("Working Towards")
As noted in the mentor review on PR #323, the initial prototype demonstrated high module reuse and passing unit tests, but true process, routing, and database isolation remain in a "Working Towards" state:
- All 36 business routes currently compile within the root Next.js build runtime.
- Database connections in the prototype shared the global Mongoose instance initialized by `instrumentation.ts`.
- Middleware rules in `proxy.ts` previously bypassed route-level role checks.
- Dockerfiles currently package the shared Next.js application image.

The decomposed roadmap in Section 12 systematically refactors these components into true standalone boundaries.

---

## 4. Authentication & Identity Strategy (The Clarified Login Decision)

### 4.1 Dual Authentication Model & Asymmetric Platform Signing
In accordance with mentor review directives (Point 3), the platform architecture strictly separates local product credentials from optional federated identity and mandates **asymmetric cryptographic signing**:

```
                  ┌──────────────────────────────────────────────┐
                  │    Identity Provider (IdP): NextAuth (Eval)  │
                  │       (Future Target: IIIT CAS / Keycloak)   │
                  └──────────────────────┬───────────────────────┘
                                         │ Asymmetrically signed Token (RS256 / EdDSA)
                                         │ Claims: iss, aud, sub, exp, jti
                                         │ Private key: PLATFORM_PRIVATE_KEY (IdP only)
                                         │ Public key: PLATFORM_PUBLIC_KEY (on consumers)
                                         ▼
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

1. **Independent Product Accounts & Logins by Default (Phase 1):**
   - Products maintain separate, isolated user collections: `User` (Evaluation), `ClassroomUser` (Classroom), and `PersonalizedUser` (Personalised) managed across dedicated database connections.
   - Passwords are **hashed** independently using salted bcrypt with cost factor `12` (never stored in plaintext or reversibly encrypted).
   - Each product handles its own registration, credential verification, and session lifecycle (`/login`, `/classroom/login`, `/personalized/login`).
2. **Optional Shared Platform Login via Asymmetric Signing (Phase 2):**
   - When enabled, a shared platform token can authenticate a user across products without requiring multiple logins.
   - **Asymmetric Signing Only (`RS256` or `EdDSA`):** The central Identity Provider holds the private key (`PLATFORM_PRIVATE_KEY`) to sign platform tokens. Consumer services hold only the public key (`PLATFORM_PUBLIC_KEY` or JWKS endpoint) for verification. Symmetric HMAC shared secrets (`PLATFORM_SHARED_SECRET`) are strictly forbidden, ensuring that a compromise of any consuming service does not allow token forgery for other services.
   - **Identity Provider Identity:** The Assignment Evaluation NextAuth service functions as the initial OAuth2/OIDC Identity Provider, structured to allow a seamless drop-in transition to institutional IIIT CAS or Keycloak SSO.
   - **Mandatory Claims Enforcement:**
     - `iss`: Canonical issuer URL (e.g. `https://eval.iiit.ac.in/auth`).
     - `aud`: Explicit target audience (e.g. `classroom-service`, `personalized-service`). Consuming products MUST validate that `aud` matches their specific service identifier; mismatched tokens must be rejected with `403 Forbidden` to prevent token replay across product boundaries.
     - `sub`: Unique platform user identity.
     - `exp`: Short-lived expiration (maximum 15 minutes, with sliding refresh).
     - `jti`: Unique cryptographically random JWT ID recorded to enable instant token revocation and replay protection.
   - **Independent Product Configuration:** Shared login must be independently configurable per product via environment flags (`CLASSROOM_ENABLE_SHARED_AUTH=false`, `PERSONALIZED_ENABLE_SHARED_AUTH=false`). When disabled (default in Phase 1), products accept only their native credentials.
3. **Strict Account Isolation & Explicit Federation Link Table:**
   - Products must **never automatically link, merge, or grant cross-access** simply because email addresses match.
   - Linking a local product account with a platform identity requires an explicit entry in a dedicated federation mapping table (`UserFederationLink`: `{ platformUserId, localUserId, product, linkedAt, linkedBy }`), created only by a deliberate action while the user is actively signed in to both accounts, never by matching emails.

### 4.2 Student Guest-Join & Session Security
In live classroom environments, students enter sessions via mobile devices scanning QR codes or entering 6-digit access codes:

1. **Endpoint & 6-Digit PIN Brute-Force Rate Limiting:**
   - Students join via `POST /api/v1/classroom/join/{code}` (returning `201 Created`).
   - The join endpoint implements strict rate limiting (maximum 10 join attempts per minute per IP, with exponential backoff on repeated failures) to prevent brute-force guessing of active 6-digit session PINs.
2. **Participant Token for Live Polls:**
   - Upon valid PIN entry, the server issues an ephemeral, cryptographically signed `classroom_participant_token` containing `{ sessionId, participantId, studentIdentifier }`.
   - Anonymous guest access is permitted **strictly for real-time engagement polls** (Mentimeter-style).
3. **Signed-in Student Requirement for Graded Submissions:**
   - Graded handwritten answer-sheet uploads (`POST /api/v1/classroom/submissions/upload-sheet`) require an authenticated student account.
   - Unverified post-session roll-number claims are dropped to eliminate identity spoofing and accidental grade misattribution.
4. **No Cross-Product Leakage:**
   - Ephemeral classroom participant tokens are strictly rejected by Assignment Evaluation and Personalised Learning APIs (`403 Forbidden`).

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
     │   Pillar 1: Primary   │                       │  Pillar 2: Engagement │
     │   Handwritten Uploads │                       │  Live Classroom Polls │
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
   - Using the mobile interface, students capture clear photos of their answer sheets and upload them via `/api/v1/classroom/submissions/upload-sheet`.
2. **AI-Assisted Draft Verification (Human-in-the-Loop):**
   - Uploaded answer sheets are processed through handwriting OCR and rubrics to generate draft scores.
   - **Crucial Rule:** AI evaluations are strictly marked as `STATUS: DRAFT_EVALUATED`. No grade is finalized or released to students until the professor/TA inspects the extracted text, verifies accuracy, and clicks "Approve Evaluation".
3. **Removal of Test Backdoors:**
   - All test hooks (such as `answerText` injection or PNG `tEXt` chunk auto-marking) are completely removed from production services.

### 5.2 Pillar 2: Mentimeter-Inspired Live Classroom Engagement
1. **Interactive Participation Prompts:**
   - Professors can dispatch quick multiple-choice polls, opinion checks, or conceptual temperature-checks during lectures.
2. **Real-Time Visualization:**
   - Live responses stream via Server-Sent Events (`/api/v1/classroom/sessions/{id}/events`).
   - The instructor display renders dynamic response distribution charts showing aggregate engagement in real time without disclosing individual student names prematurely.

---

## 6. AI Evaluation Pipeline & Human-in-the-Loop Governance

The platform establishes four strictly separated stages for automated processing:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     Stage 1     │     │     Stage 2     │     │     Stage 3     │     │     Stage 4     │
│ OCR Extraction  │ ──> │ AI Draft Score  │ ──> │ Human Staff     │ ──> │ Finalized Grade │
│                 │     │                 │     │ Verification    │     │                 │
│ (Raw text/math) │     │ (Status: DRAFT) │     │ (Audit log: OK) │     │ (Released/LMS)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **Stage 1 — OCR & Text Extraction:**
   - Ingests student handwriting image, applies perspective correction, contrast enhancement, and OCR extraction.
   - Outputs extracted text, math expressions, and segmentation confidence scores.
2. **Stage 2 — AI-Assisted Evaluation (Draft State):**
   - Evaluates extracted text against question rubrics and reference criteria.
   - Outputs recommended scores and diagnostic feedback.
   - **State Invariant:** Stored with status `DRAFT_EVALUATED`. Never surfaces to students or gradebooks in this state.
3. **Stage 3 — Human Verification & Approval Gate:**
   - Course staff (Professor/TA) inspects original image side-by-side with extracted text and AI score recommendation.
   - Staff confirms or overrides scores via `PATCH /api/v1/classroom/submissions/{id}/approve`.
   - Generates an immutable audit trail entry (`EVALUATION_APPROVED`).
4. **Stage 4 — Finalized Results & Passback:**
   - Transition to `APPROVED`. Scores become visible in student results and eligible for LTI 1.3 LMS grade passback.

### 6.1 AI Privacy Policy & Handwriting Pipeline Contradiction Resolution
As highlighted in mentor review (Point 5), a blanket ban on real student data (`isRealStudentData = true`) creates an operational contradiction with the handwriting evaluation pipeline, which inherently requires processing handwritten answer images. To resolve this contradiction without compromising student privacy or institutional compliance, the architecture establishes four concrete safeguards:

1. **Enterprise Vertex AI in Institute GCP Tenant:**
   - All AI handwriting OCR and evaluation requests are routed exclusively through Google Cloud Vertex AI provisioned within the institute's dedicated Google Cloud project.
   - Enterprise Vertex AI contracts provide strict **Zero Data Retention (ZDR)** guarantees: student handwriting images, extracted text, and prompt inputs are never stored by Google for model training or foundation model improvement.
2. **Per-Course Student Data Consent:**
   - During course registration or session onboarding, students provide affirmative consent for their handwritten submissions to be processed by the institute's private AI evaluation pipeline.
3. **Strict 30-Day Raw Image Retention Policy:**
   - Student handwriting images uploaded to Cloud Storage (`gs://iiit-classroom-prod/submissions/...`) are automatically purged after **30 days** via Cloud Storage Object Lifecycle Management.
   - Only verified textual annotations, finalized rubric grades, and audit trail records are retained permanently in the institutional database.
4. **Model Parameterization & Deprecation Governance:**
   - Google Gemini models do **not** follow an LTS (Long-Term Support) release designation.
   - The active model version is pinned explicitly via configuration to `gemini-2.0-flash` (governed by the `GEMINI_MODEL` environment variable, with `gemini-1.5-pro` as optional secondary fallback).
   - Upstream model lifecycle dates are tracked proactively, and model upgrades require running the regression evaluation harness against calibrated baseline test scripts before production adoption.

---

## 7. Headless Services & API-First Architecture

To satisfy Prof. Jawahar's requirement that services operate independently and integrate with other institutional Learning Management Systems:

### 7.1 Versioned `/v1` Endpoints
All products expose clean, versioned headless REST APIs decoupled from Next.js server-side page rendering:
- **Assignment Evaluation:** `/api/v1/evaluation/*` (with `/api/exams/*` and `/api/grading/*` maintained for backward compatibility).
- **Classroom Activity:** `/api/v1/classroom/*` (sessions, `/join/{code}`, `/sessions/{id}/submissions/review-queue`, `/submissions/{id}/reject`, `/polls/{id}/close`, stream).
- **Personalised Learning:** `/api/v1/personalized/*` (daily, questions, schedules, evaluate).

For complete payload structures, pagination rules, error envelopes, and idempotency conventions, see [API Conventions Specification](./API_CONVENTIONS.md).

### 7.2 OpenAPI 3.1 Specifications
Each independent service publishes a formal OpenAPI contract in `docs/openapi/`:
- `docs/openapi/classroom-service.v1.yaml` (Drafted, contract gaps resolved, and verified clean with `redocly lint` in Step 4)
- `docs/openapi/evaluation-v1.yaml` (Scheduled for Step 5)
- `docs/openapi/personalized-v1.yaml` (Scheduled for Step 5)

These definitions allow external developers and LMS teams to generate client SDKs and validate payloads independently of our frontend UI.

---

## 8. LTI 1.3 Advantage Integration Architecture

Expanding on the design in `AE-216` (`docs/LTI_1_3_GRADE_PASSBACK.md`):

1. **IMS LTI 1.3 Core:**
   - OAuth 2.0 / OIDC stateful launch flow (`/api/lti/login`, `/api/lti/launch`).
   - Secure verification of platform tool registration, platform public keys (JWKS), and signed JWT state.
2. **Assignment and Grade Services (AGS v2p0):**
   - Headless grade passback publishing finalized student marks directly to LMS gradebooks (Moodle, Canvas) via outbound HTTPS REST calls sending JSON-LD payloads to the LMS platform's LineItem URL. (Note: LTI grade synchronization uses standard outbound HTTPS REST requests, not network sockets).
   - **Current Implementation State:** Safe stub mode (`LTI_STUB_MODE=true`) verifies token structures, request formatting, and payload validation in CI/staging without requiring live outbound network connectivity to an LMS server. Production outbound HTTPS dispatch is scheduled for post-architecture deployment.
3. **Names and Role Provisioning Services (NRPS v2p0):**
   - Headless roster synchronization mapping LMS student IDs (`sub`, `lis_person_sourcedid`) to internal student identities.

---

## 9. Database Isolation & Connection Architecture

### 9.1 Multi-Database Connection Architecture
To guarantee genuine database isolation and prevent connection hijacking across services:
- `src/lib/classroomDb.ts`: Uses `mongoose.createConnection(process.env.MONGODB_CLASSROOM_URI)`. Models are compiled on this dedicated connection instance.
- `src/lib/personalizedDb.ts`: Uses `mongoose.createConnection(process.env.MONGODB_PERSONALIZED_URI)`. Models are compiled on this dedicated connection instance.
- `src/lib/db.ts`: Preserves the primary connection for Assignment Evaluation (`MONGODB_URI`).
- Standalone MongoDB topologies in development and replica set configurations in production are supported without connection crashes.

---

## 10. Security, Authorization & Vulnerability Remediation

> [!NOTE]
> Several baseline vulnerabilities listed below (including open registration role elevation and lack of brute-force rate limiting) were preexisting defects inherited from the `main` branch baseline, tracked under issue `AE-257`.

| Vulnerability / Defect | Root Cause | Remediation in Target Implementation |
|---|---|---|
| **Default PROFESSOR Role on Register** | Open registration accepted any role parameter or defaulted to PROFESSOR (`AE-257`). | Public registration strictly creates `STUDENT` accounts. `PROFESSOR` and `TA` roles require an authenticated admin invitation code or domain whitelist check. |
| **Weak Password & Brute-Force** | Single-character passwords allowed; zero login rate limiting (`AE-257`). | Minimum 8 characters with complexity checks. Exponential backoff and maximum 5 failed attempts per 15-minute window per IP/user. |
| **Inactive User Authentication** | `isActive` flag ignored during credential validation. | Explicit check returning `NextResponse.json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is deactivated' } }, { status: 401 })`. |
| **Hard-coded Secret Fallbacks** | Secret fallbacks (`dev-secret`) enabled token cross-use across products. | Removal of all hardcoded literals. System throws configuration errors at boot if `CLASSROOM_JWT_SECRET`, `PERSONALIZED_JWT_SECRET`, or `NEXTAUTH_SECRET` are unset. |
| **Session Bleed in Middleware** | Evaluation session was accepted by product endpoints without role checks. | Product tokens verified independently; Evaluation sessions must possess explicit permissions (`VIEW_COURSES`, `MANAGE_EXAMS`) to access administrative product paths. |
| **Unenrolled Question Access** | Endpoint `/api/personalized/questions` returned reference answers and answer keys to unenrolled students. | Strip `referenceAnswer`, `correctOptionIndex`, and rubric grading criteria from student payloads. Enforce course enrollment checks. |
| **Cross-Professor Generation** | Professor could trigger question generation on unassigned course IDs. | Validate professor course allocation before initiating Gemini question generation. |
| **AI Student Data Leak** | Real handwriting images sent to LLM without gating. | Enforce Vertex AI enterprise boundary with zero data retention, 30-day raw image purging, and course consent. |
| **Deprecated Gemini Model** | Hardcoded `gemini-1.5-flash` / `gemini-2.5-flash`. | Model names parameterized via `GEMINI_MODEL` environment variable, defaulting to `gemini-2.0-flash` with scheduled retirement tracking. |

---

## 11. Decisions Submitted for Prof. Jawahar's Review & Sign-Off

To ensure exact alignment before proceeding to platform implementation, the following six key architectural decisions are submitted for Prof. Jawahar's direction:

### Decision 1: Guest Access Policy for Graded Submissions
- **Context:** Students can enter live classroom sessions quickly using a 6-digit PIN or QR code.
- **Question:** Should anonymous guest participants be permitted to upload physical handwritten answer sheets for formal grading, or should anonymous guest access be restricted strictly to Mentimeter-style live polling, requiring registered, authenticated student accounts for graded answer-sheet submissions?
- **Engineering Recommendation:** 
  - Restrict anonymous guest access strictly to real-time engagement polls.
  - Require authenticated student accounts for graded handwritten answer-sheet submissions (dropping unverified post-session roll-number claims) to prevent grade misattribution and preserve academic integrity.
  - Protect the 6-digit PIN join endpoint with IP-based rate limiting to prevent brute-force session guessing.

### Decision 2: Human-in-the-Loop Review for AI Handwriting Evaluations
- **Context:** Automated OCR and rubric matching evaluate student handwriting images.
- **Question:** Should AI evaluations remain in `DRAFT_EVALUATED` state until explicitly approved by the professor/TA, or can simple objective questions (e.g. numeric answers, single formulas) auto-finalize if OCR confidence exceeds a threshold (e.g. 95%)?
- **Engineering Recommendation:** Enforce human-in-the-loop review for all handwritten submissions initially, marking results as draft until approved by staff.

### Decision 3: Shared Platform Login Rollout Schedule
- **Context:** Students and instructors benefit from single sign-on across products, but products must remain technically decoupled.
- **Question:** What is the rollout order for authentication? Should we implement independent product authentication first (Phase 1) and introduce the shared-login adapter in PR 5 behind a per-product feature flag (Phase 2), disabled by default?
- **Engineering Recommendation:** Implement independent product authentication first to guarantee system decoupling, followed by the optional asymmetric signed platform token adapter in Phase 2 behind per-product flags (`CLASSROOM_ENABLE_SHARED_AUTH`, `PERSONALIZED_ENABLE_SHARED_AUTH`), default off.

### Decision 4: LTI 1.3 Integration Expectations
- **Context:** Integration with institutional LMS (Canvas, Moodle).
- **Question:** Should Phase 1 platform implementation deliver the verified safe stub mode with AGS/NRPS payload contracts, followed by live LMS outbound HTTPS certification in Phase 2?
- **Engineering Recommendation:** Deliver verified stub mode with OpenAPI schemas in Phase 1; conduct live Moodle/Canvas HTTPS passback validation once testbed credentials are provisioned.

### Decision 5: Independent Service & Deployment Boundaries
- **Context:** Operating products as standalone microservice containers.
- **Question:** Should we deploy independent container images (`docker-compose.products.yml`) on separate ports (3000, 3001, 3002) with dedicated database instances, while retaining the root proxy for unified discovery?
- **Engineering Recommendation:** Approve the independent container architecture, ensuring each product has isolated secrets, databases, and runtime processes.

### Decision 6: Enterprise AI Privacy Policy & Retention for Handwriting Pipeline
- **Context:** Automated handwriting OCR and scoring require processing student handwriting images, which conflicts with a naive blanket ban on student data.
- **Question:** Does Prof. Jawahar approve deploying Vertex AI in the institute's Google Cloud project (with zero data retention for training), requiring per-course student consent, enforcing a 30-day raw handwriting image purge in Cloud Storage, and pinning `gemini-2.0-flash` with scheduled retirement tracking?
- **Engineering Recommendation:** Approve Decision 6 to enable handwriting OCR and AI-assisted scoring safely under institutional compliance.

---

## 12. Decomposed Implementation Roadmap (Step 5 PR Sequence)

Following mentor and stakeholder approval of this document, implementation will be executed in targeted, independently reviewable pull requests in the exact order below:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 4: Architecture Note v2 Review & Sign-Off (Current Gate)         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PR 1: AI Service Boundary                                              │
│ - Centralized model-provider integration outside business logic        │
│ - Gating with isRealStudentData, GEMINI_MODEL env, DRAFT review state  │
│ - Cost and usage instrumentation, no client-side API keys              │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PR 2: Classroom Polls Core                                             │
│ - Live classroom participation capability, 6-digit PIN & QR links      │
│ - Live response distributions & participation stats (SSE stream)       │
│ - Session isolation, guest participant token, brute-force protection   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PR 3: Handwriting Pipeline (Subject to Decision 1 & 2 Approval)        │
│ - Timed handwritten answer-sheet upload, image validation & storage    │
│ - OCR extraction, AI draft evaluation, staff approval gate             │
│ - Complete removal of test backdoors                                   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PR 4: Personalised Learning Question Bank                              │
│ - Course-based organization, taxonomy, difficulty metadata             │
│ - Strip answer keys/rubrics from student payloads, course allocation   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PR 5: Identity & Dual Login Model                                      │
│ - Separate product login and account management by default             │
│ - Optional signed platform login, configurable per product             │
│ - No email auto-linking, separate Mongoose connection pools            │
│ - Role hardening (no default PROFESSOR), brute-force rate limiting     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PR 6: Landing Page & Proxy Routing                                     │
│ - Preserve logged-in user redirects (/professor, /student)             │
│ - Feature flag gating on discovery hub, proxy middleware hardening     │
│ - HTTP-level E2E tests for registration and authenticated product usage│
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PR 7: Independent Container Deployment                                 │
│ - Standalone Dockerfiles and docker-compose.products.yml per product   │
│ - Isolated env variables and secrets, independent health checks        │
│ - Verified deployment tests proving zero cross-product secret leakage  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 13. Sign-Off & Approvals Status

| Stakeholder / Role | Status | Notes / Signature |
|---|---|---|
| **Laxmi Narayana Murthy Vemuri** (Mentor) | `PENDING REVIEW` | Reviewing dual-login asymmetric signing, Git sequence, OpenAPI specs, and service isolation design. |
| **Prof. C.V. Jawahar** (Lead Advisor) | `PENDING REVIEW` | Reviewing 6 key decisions (guest policy, AI review gate, dual login rollout, LTI expectations, deployment boundaries, enterprise AI privacy policy). |
| **Engineering Implementation Team** | `SIGNED (v2.2.0)` | Architecture Note v2.2 revised and submitted for sign-off. |
