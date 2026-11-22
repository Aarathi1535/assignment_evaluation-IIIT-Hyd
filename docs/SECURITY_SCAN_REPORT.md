# Security Scan & Dependency Audit Report

**Document:** `docs/SECURITY_SCAN_REPORT.md`  
**Reference:** Week 12 · Day 2 — Security and Compliance (AE-228 / Issue #348 / PR #349)  
**Status:** Canonical Reference

---

## 1. Executive Summary

A comprehensive security scan, package vulnerability upgrade, and git history secrets audit of the Exam Evaluation Platform was performed, covering:
1. **Third-Party Dependency Audit & Remediation:** Automated CVE/GHSA analysis across all direct and transitive production dependencies, followed by package upgrades to eliminate reported vulnerabilities.
2. **Secrets & Credential History Scan (Gitleaks):** Exhaustive repository-wide commit history scanning across all 639 commits using Gitleaks for exposed API keys, private keys, tokens, and database credentials.
3. **Environment Variable Configuration Validation:** Auditing runtime configuration schemas in `src/config/env.ts` and `.gitignore` file boundary enforcement.
4. **Application Data Sanitization Defenses:** Verifying real production sanitization mechanisms across audit logging, file validation, ingestion error handling, and spreadsheet export.
5. **Architectural Gap Analysis:** Correcting inaccurate assumptions regarding input validation strictness, body parser limits, and secret length rules.

**Key Results:**
- **Production Vulnerabilities (`--omit=dev`):** **0** (All critical and high vulnerabilities in `next`, `mongoose`, `zod`, and transitive dependencies resolved).
- **Git History Secrets Scan (Gitleaks):** Clean (0 live production secrets; identified template comments and test fixtures documented).
- **Environment Leakage Protection:** Fully enforced (`.env*` excluded by `.gitignore`).

---

## 2. Dependency Vulnerability Remediation (SBOM & npm Audit)

### 2.1 Upgraded Core Production Stack
All production packages with known advisories have been upgraded:

| Package | Previous Version | Upgraded Version | Resolved Advisories / CVEs |
| :--- | :---: | :---: | :--- |
| **`next`** | `16.2.12` | **`16.4.6`** | **Critical:** GHSA-p293-qw3h-jr36 (Windows RCE), GHSA-2xp9-vwfh-vxw4 (AVIF RCE), GHSA-2464-fhr4-w9xw (SVG RCE), GHSA-vcvr-r3jv-pc5j (ImageResponse RCE), GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r (DoS), GHSA-f3mh-rxg3-f5g2 (HttpOnly Cookie Leak). |
| **`mongoose`** | `9.9.0` | **`9.12.3`** | **Critical:** GHSA-gg4r-jv3p-qx3c (Connection-level sanitizeFilter), GHSA-pcrw-h46h-c93h (countDocuments filter injection), GHSA-wr5m-5jph-8m96 (Discriminator prototype bypass), GHSA-8332-j7wj-wjw4 (Inherited property DoS), GHSA-6972-9mcm-vhwj (Prototype pollution). |
| **`zod`** | `4.4.3` | **`4.6.7`** | **High:** GHSA-mrhx-c7xc-m3w5 (Memory exhaustion on oversized constrained collections). |
| **`@google-cloud/storage`** | `7.16.0` | **`7.22.0`** | Replaced vulnerable `fast-xml-parser` subdependency. |
| **`eslint-config-next`** | `16.2.12` | **`16.4.6`** | Aligned with Next.js 16.4.6 core runtime. |
| **`fast-uri`** (override) | `<3.1.9` | **`^3.1.9`** | **High:** GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf (SSRF / Host Confusion). |
| **`source-map-js`** (override) | `<1.2.4` | **`^1.2.4`** | **High:** GHSA-68fv-2mgg-jv7q (Event-loop denial of service). |
| **`uuid`** (override) | `<11.1.1` | **`^11.1.1`** | **Moderate:** GHSA-w5hq-g745-h8pq (Buffer bounds check in v3/v5/v6). |

### 2.2 Audit Verification
Running `npm audit --omit=dev` verifies the production dependency tree:
```bash
$ npm audit --omit=dev
found 0 vulnerabilities
```
All production-facing vulnerabilities have been eliminated. The remaining 14 advisories reported by a full `npm audit` reside exclusively in build-time and test-time `devDependencies` (`vite`, `vitest`, `eslint`, `jsdom`), which are never packaged or exposed in the Cloud Run production container.

---

## 3. Honest Architectural Gap Analysis

To maintain rigorous security integrity, this section transparently documents where previous claims exceeded actual code capabilities:

### 3.1 Input Validation Schema Strictness
- **Previous Claim:** Every API route handler passes requests through strict Zod schemas (`.strict()`) before constructing database queries.
- **Actual Reality:** `.strict()` is currently implemented on only 4 of 90 route handlers (e.g., student results, rubric updates). The remaining handlers validate typed fields against standard Zod schemas without the `.strict()` modifier.
- **Risk Assessment:** While standard Zod validation parses and types expected fields, extra unvalidated fields are not rejected automatically by non-strict schemas unless explicitly stripped before passing to database queries.
- **Action Item:** Incrementally adopt `.strict()` across remaining route schemas in future sprint tickets.

### 3.2 Request Body & Payload Limits
- **Previous Claim:** Maximum request payload is enforced at 10MB for scan uploads and 1MB for JSON API requests via application middleware.
- **Actual Reality:** There are no custom body-limit middleware wrappers in `src/`. The application relies on Next.js default App Router body parsing (4MB limit).
- **Risk Assessment:** Next.js protects against gigabyte-scale memory exhaustion out-of-the-box, but fine-grained limits (10MB for multipart batches, 1MB for API JSON) must be enforced at the reverse-proxy layer (Cloud Run max request size / Cloud Armor).
- **Action Item:** Configure Cloud Run / Cloud Armor ingress payload policies during infrastructure setup.

### 3.3 Secret Length Validation Rules
- **Previous Claim:** `NEXTAUTH_SECRET` and `ORIGINAL_STORAGE_HMAC_SECRET` enforce 32+ character entropy validation on application startup.
- **Actual Reality:** `src/config/env.ts` enforces `z.string().min(1)` (presence validation only).
- **Reason:** Existing CI workflows and test configurations pass short test values (e.g. `ci-test-secret`, length 14). Hardcoding `min(32)` unconditionally in `env.ts` breaks test fixtures and CI builds.
- **Action Item:** Introduce environment-aware secret length checks (e.g., enforce `min(32)` when `NODE_ENV === 'production'`) or validate secret entropy in production deployment scripts.

---

## 4. Git History Secrets Audit (Gitleaks)

An automated history scan was executed across all 639 commits in the repository using `gitleaks detect -v`.

### 4.1 Scan Summary
- **Commits Scanned:** 639 commits (~81.1 MB).
- **Total Pattern Matches:** 18 findings across historical commits.
- **Live Production Credentials Leaked:** **0**

### 4.2 Categorization of Historical Matches
1. **Template Comment Placeholder (`deploy/identity/.env.example` line 8):**
   - Matched: `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----`
   - Analysis: This is an example placeholder commented out in `.env.example` illustrating the expected RSA key format for asymmetric token signing. It is not an active or usable private key.
2. **Test Suite Mock Values (`GradingLifecycleAE178.test.ts`, `TaCreationAllocationFlow.test.ts`):**
   - Matched: `'test-assembly-approval-secret-32-chars'`, `'thumb-cs201-p1'`.
   - Analysis: Unit test fixtures used to verify cryptographic HMAC signing and thumbnail caching in MongoDB memory server.
3. **Vendor Extracted Chunks (`next_extracted/`):**
   - Matched: Obfuscated variable names in Next.js bundle analyzer chunks (e.g. `internalPropsKey=`, `remainingKeys=`). False positives from vendor JavaScript minification.

### 4.3 Git Boundary Enforcement
The root `.gitignore` enforces exclusion of real secrets:
```gitignore
# env files
.env*
!.env.example
*.pem
*.key
```
Confirmed via `git ls-files "*.env*"`: Only `.env.example` is tracked. No live `.env`, `.env.local`, or certificate key files exist in version control.

---

## 5. Application Data Sanitization Defenses

The codebase enforces active sanitization across operational data flows:

1. **Audit Log Sanitization (`src/lib/audit.ts`):**
   - `sanitizeAuditFeedback` traverses payload objects up to depth 6, replacing circular references and deep trees with safe placeholders.
   - Long comment fields exceeding 2,000 characters are safely truncated to prevent MongoDB memory bloat.
   - `sanitizeIpAddress` normalizes IPv4 and IPv6 addresses, stripping non-standard header formats.
2. **File Path Traversal Sanitization (`src/utils/fileValidation.ts`):**
   - `sanitizeDisplayFilename` removes control characters (`\x00-\x1f\x7f`), directory traversal sequences (`../`, `..\`), and limits filename length to 255 characters.
3. **Ingestion Error Sanitization (`src/validations/ingestionValidation.ts`):**
   - `sanitizeFailureReason` strips internal server file paths, raw Node.js stack traces, and whitespace noise before persisting to `IngestionJob.failureReason` or returning to API callers.
4. **CSV / Spreadsheet Injection Sanitization (`src/lib/gradeExport.ts`):**
   - `sanitizeSpreadsheetCell` prefixes cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote (`'`), preventing formula execution when opening exported CSVs in Microsoft Excel or Google Sheets.
