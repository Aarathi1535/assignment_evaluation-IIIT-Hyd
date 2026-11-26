# Rate Limiting & Input Validation Architecture

**Document:** `docs/RATE_LIMITING_VALIDATION.md`  
**Reference:** Week 12 · Day 2 — Security and Compliance (AE-229 / Issue #350 / PR #351)  
**Status:** Canonical Reference

---

## 1. Executive Summary

This document specifies the platform's sliding-window rate limiting engine, client IP resolution model, memory management bounds, input validation schemas, and magic byte file inspection rules. It provides an honest **Gap Analysis** contrasting node-local in-memory sliding windows with distributed cloud rate limiting (Cloud Armor / Redis).

---

## 2. Multi-Tiered Rate Limiting Policies

The platform defines sliding-window rate limiting policies via `src/lib/rateLimit.ts`. Route-level enforcement is phased: authentication registration and password reset links are actively enforced, while login, token reset, and higher-tier operations are distinguished below.

```mermaid
flowchart TD
    Client["Incoming HTTP Request"] --> Proxy["Reverse Proxy / Ingress Gateway"]
    Proxy --> HeaderExtract["IP Resolution (x-real-ip / rightmost x-forwarded-for)"]
    HeaderExtract --> RouteCheck{"Target Endpoint"}

    RouteCheck -->|POST /api/auth/register| AuthLimit["Enforced: 5 req / 1 min per IP"]
    RouteCheck -->|POST /api/auth/reset| ResetLinkLimit["Enforced: 5 req / 1 min per IP"]
    RouteCheck -->|POST /api/auth/reset-password| NotLimited1["Not Currently Rate Limited"]
    RouteCheck -->|NextAuth authorize (Login)| NotLimited2["Not Currently Rate Limited"]
    RouteCheck -->|Batch Upload| ConfiguredOnly1["Upload Tier: Configured, Not Enforced in Route"]
    RouteCheck -->|PDF Export| ConfiguredOnly2["Export Tier: Configured, Not Enforced in Route"]
    RouteCheck -->|Regrade Submission| ConfiguredOnly3["Regrade Tier: Configured, Not Enforced in Route"]

    AuthLimit --> CheckLimit{"Within Quota?"}
    ResetLinkLimit --> CheckLimit

    CheckLimit -->|Yes| Allow["200/201 Success (Record Timestamp)"]
    CheckLimit -->|No| Reject["429 Too Many Requests (Retry-After Header)"]
```

### 2.1 Configuration Tiers & Enforcement Status

| Tier | Window | Max Quota | Key Namespace | Route Enforcement Status | Target Risk |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **`AUTH`** | 1 minute | 5 requests | `auth:register:ip:<ip>`, `auth:reset:ip:<ip>` | **Enforced** on `/api/auth/register` and `/api/auth/reset`.<br>*(Note: `/api/auth/reset-password` and NextAuth credentials `authorize` are **not currently rate limited**)* | Registration flooding, reset-link spamming |
| **`UPLOAD`** | 1 hour | 10 uploads | `upload:user:<userId>` | **Configured only** in `RATE_LIMIT_TIERS.UPLOAD`; not yet enforced in upload routes | Storage backend flooding, disk exhaustion |
| **`STUDENT_EXPORT`** | 1 hour | 5 exports | `export:user:<studentId>` | **Configured only** in `RATE_LIMIT_TIERS.STUDENT_EXPORT`; not yet enforced in export routes | Rendering CPU exhaustion, buffer starvation |
| **`REGRADE_REQUEST`** | 24 hours | 10 requests | `regrade:user:<studentId>` | **Configured only** in `RATE_LIMIT_TIERS.REGRADE_REQUEST`; not yet enforced in regrade routes | Evaluation queue spamming |

---

## 3. Architecture & Gap Analysis: In-Memory vs. Distributed Cloud Limiting

### 3.1 Node-Local In-Memory Scope & Enforcement Status
- **Mechanism:** In-process sliding-window bucket store (`Map<string, number[]>`) in `src/lib/rateLimit.ts`.
- **Currently Enforced Endpoints:**
  - `POST /api/auth/register` (5 attempts / 60s per IP)
  - `POST /api/auth/reset` (5 attempts / 60s per IP for password reset-link requests)
- **Endpoints Not Currently Rate Limited:**
  - `POST /api/auth/reset-password` (password reset completion with token — currently unenforced)
  - NextAuth credentials `authorize` (primary user login / credential authentication — currently unenforced)
- **Tiers Configured but Not Enforced in Routes:**
  - Batch upload routes (`UPLOAD` tier defined, not wired to route handlers)
  - Student export routes (`STUDENT_EXPORT` tier defined, not wired to route handlers)
  - Regrade request routes (`REGRADE_REQUEST` tier defined, not wired to route handlers)
- **Single-Instance Guarantee:** On a single server instance or local container, bursts exceeding the threshold on enforced endpoints are immediately rejected with `429 Too Many Requests`.

### 3.2 Horizontal Scaling Limitation (Cloud Run Multi-Instance)
> [!IMPORTANT]
> **Cloud Run Multi-Instance Gap Analysis**  
> In serverless environments like Google Cloud Run, requests are distributed across multiple ephemeral container instances. An in-memory store in Container A cannot observe requests hitting Container B. A distributed attacker whose requests round-robin across 5 instances could theoretically make up to $5 \times 5 = 25$ attempts before individual containers saturate.

### 3.3 Target Cloud Architecture
For true cluster-wide rate limiting across horizontal Cloud Run instances:
1. **Google Cloud Armor (Recommended at Ingress):**
   - Configured on Google Cloud HTTP(S) Load Balancer.
   - Throttles malicious IP ranges and credential stuffing before traffic ever reaches Cloud Run containers, saving compute resources.
2. **Centralized Redis Store (Memorystore):**
   - Cloud Run instances connect via Serverless VPC Access to a managed Redis instance.
   - Atomic Redis commands (`ZADD`, `ZREMRANGEBYSCORE`, `ZCARD`) provide cluster-synchronized sliding windows.
3. **MongoDB Token Bucket (Low Traffic Alternative):**
   - Atomic `$inc` and TTL index document updates directly in MongoDB collections.

---

## 4. Safe Client IP Resolution & Memory Management

### 4.1 Client-Controlled `X-Forwarded-For` Vulnerability Defense
- **The Vulnerability:** An attacker can craft requests with `X-Forwarded-For: 1.1.1.1`. If an application blindly reads `x-forwarded-for.split(',')[0]`, the attacker can rotate the header value on every request to bypass rate limiting completely.
- **The Defense:** `getClientIdentifier` in `src/lib/rateLimit.ts`:
  1. Checks `x-real-ip` first (set directly by the authoritative edge reverse-proxy).
  2. If using `x-forwarded-for`, reads the **rightmost** (last) entry appended by the trusted ingress reverse proxy (`parts[parts.length - 1]`), ensuring client-injected headers cannot bypass quota tracking.
  3. Falls back to user identifier (`user:<userId>`) for authenticated student/instructor routes.

### 4.2 Memory Management & Pruning Behavior
- **Pruning Trigger Threshold:** The store triggers a cleanup sweep when `rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES` (10,000 entries) upon encountering an unregistered key.
- **Active Timestamp Pruning:** On each request check, timestamps older than the configured tier window are filtered out for the queried key.
- **Retention Sweep:** `pruneRateLimitStore()` iterates over store entries and deletes only buckets whose timestamps are completely older than 24 hours (`maxRetention = 24 * 60 * 60 * 1000`).
- **Pruning Limitation (Not a Guaranteed Hard Cap):**
  > [!WARNING]
  > `MAX_RATE_LIMIT_ENTRIES = 10,000` is **not a guaranteed hard cap**. Because `pruneRateLimitStore` only removes inactive keys whose timestamps are older than 24 hours, if 10,000 or more distinct keys remain active within the 24-hour window, the pruning sweep removes 0 entries. Since the current implementation does not implement an eviction policy (such as LRU or FIFO) or a fail-closed rejection policy when full, `rateLimitStore.set(key, activeTimestamps)` continues to add new keys and the in-memory map will grow past 10,000 entries. Enforcing a strict memory cap requires an agreed architectural decision on eviction/rejection or moving to an external store (e.g. Redis).

---

## 5. Standard HTTP 429 Response & Headers

When quota is exceeded, the server returns `HTTP 429 Too Many Requests` with standard RFC headers:
```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 48
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1700000060
Cache-Control: no-store, private

{
  "success": false,
  "message": "Too many registration attempts. Please try again later.",
  "data": {
    "retryAfterSeconds": 48
  }
}
```

---

## 6. Input Validation & Magic Byte Defense

1. **Magic Byte Inspection (`src/utils/fileValidation.ts`):**
   - PDF: `%PDF-` (`0x25 0x50 0x44 0x46`)
   - JPEG: `0xFF 0xD8 0xFF`
   - PNG: `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`
   - WebP: `RIFF` + `WEBP`
   - TIFF: `II*\0` (LE) or `MM\0*` (BE)
2. **Batch & Resource Limits:**
   - Single file size: 50MB
   - Total batch size: 200MB
   - Files per batch: 20
   - PDF page count: 200 pages
3. **Identifier Sanitization:**
   - 24-character hexadecimal MongoDB ObjectIds strictly validated before database queries.
