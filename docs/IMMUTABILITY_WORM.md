# Immutability and WORM Enforcement Architecture & Gap Analysis

**Document:** `docs/IMMUTABILITY_WORM.md`  
**Reference:** Week 12 · Day 2 — Security and Compliance (AE-227 / Issue #346 / PR #347)  
**Status:** Canonical Reference

---

## 1. Executive Summary

In academic examination grading, scan batches of handwritten answer sheets and published final evaluations constitute legal records of student performance. Any modification, silent truncation, or undetected tampering of original scanned scripts or published grades undermines academic integrity.

This document specifies the **Write-Once-Read-Many (WORM)** architecture, Mongoose model-level hooks, read-path cryptographic HMAC tamper-detection mechanism, and metadata-binding protocols implemented by the platform. It provides an honest **Gap Analysis** delineating the exact boundary between **application-level software guarantees** and **infrastructure-level hardware retention locks**.

---

## 2. Realistic Enforcement Boundaries: Software vs. Infrastructure WORM (Gap Analysis)

> [!IMPORTANT]
> **No Unsubstantiated Infrastructure Claims**  
> Software-level controls (Mongoose model hooks, POSIX `wx` flags, HMAC verification) protect against application bugs, rogue API calls, and accidental data deletion. However, software alone **cannot** prevent a privileged root system administrator, compromised database superuser, or raw disk operator from wiping or tampering with data directly at the hardware layer. True immutable WORM compliance requires cloud compliance retention locks.

| Dimension | Application-Level WORM (Enforced in Code) | Infrastructure-Level WORM (Cloud Compliance) |
| :--- | :--- | :--- |
| **Enforcement Mechanism** | `ImmutableStorageService` (POSIX `wx` / GCS `ifGenerationMatch: 0`) + Mongoose schema pre-hooks | GCS Bucket Lock / AWS S3 Object Lock (Compliance Mode) |
| **Overwrite Protection** | Throws HTTP `409 Conflict` if target file or object exists | Cloud storage API rejects overwrite regardless of credentials |
| **Deletion Protection** | Pre-delete hooks block deletion of sealed `Batch` and published `Exam` records | Cloud rejects object/bucket deletion until retention period expires (even by root/owner) |
| **File Mutation Protection** | Pre-update hooks block modification of sealed files in `Batch` or course/marks on published `Exam` | Underlying cloud objects cannot be modified or replaced |
| **Tamper Detection on Read** | Cryptographic HMAC-SHA256 seal verified on **every read** (`readOriginalContent`, `readOriginal`) | Storage backend immutability + client-side integrity validation |
| **Audit on Tampering** | Emits `INTEGRITY_MISMATCH` audit event with caller and file details | Cloud Audit Logs / S3 Server Access Logs record unauthorized API attempts |
| **Privileged Bypass Risk (Gap)** | **Vulnerable** to direct MongoDB shell commands or direct OS filesystem manipulation | **Immune**; cloud compliance locks cannot be bypassed or shortened even by project owners |
| **Current Platform Status** | **Fully Enforced in Code & Verified in CI** | **Architecture Config Option (Requires Cloud Bucket Retention Policy)** |

---

## 3. Model-Level WORM Immutability Hooks

To prevent application-level tampering or accidental deletion through admin interfaces or scripts, the platform implements pre-execution hooks in Mongoose:

### 3.1 Batch Model Hooks (`src/models/Batch.ts`)
1. **Deletion Guard (`deleteOne`, `deleteMany`, `findOneAndDelete`):**
   - Inspects target batches. If any batch contains sealed files (records with an `hmac` seal), deletion is blocked with:
     `Cannot delete batch "<batchId>" containing sealed original files (WORM immutability enforcement)`
2. **File Modification Guard (`updateOne`, `updateMany`, `findOneAndUpdate`):**
   - Blocks any update query attempting to `$set`, `$pull`, or `$push` the `files` array of a sealed batch, preserving original scan references.

### 3.2 Exam Model Hooks (`src/models/Exam.ts`)
1. **Deletion Guard (`deleteOne`, `deleteMany`, `findOneAndDelete`):**
   - If an exam has status `PUBLISHED`, deletion is rejected with:
     `Cannot delete published exam "<title>" (WORM immutability enforcement)`
2. **Core Parameter Guard (`updateOne`, `updateMany`, `findOneAndUpdate`):**
   - For published exams, alterations to `course` (preventing tenancy kidnapping) or `totalMarks` (preventing grade corruption) are rejected with:
     `Cannot alter course/totalMarks of published exam "<title>" (WORM immutability enforcement)`

---

## 4. Storage Pipeline & Read-Path Verification

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Ingestion Worker / Caller
    participant Storage as ImmutableStorageService
    participant HMAC as hmacStorage Utility
    participant FS as Storage Backend (Local / GCS)
    participant DB as MongoDB (Batch / Exam)
    participant Audit as AuditLog Service

    Staff->>Storage: readOriginalContent(storageKey) / readOriginal(storageKey)
    Storage->>FS: Fetch raw buffer from disk / GCS
    Storage->>DB: Query Batch containing storageKey
    alt Batch File has HMAC Seal & Metadata
        Storage->>HMAC: verifyHmacSeal(buffer, metadata, hmac, keyId)
        alt Tamper Detected (HMAC Mismatch)
            HMAC-->>Storage: Valid: false (tamper detected)
            Storage->>Audit: writeAuditLog("INTEGRITY_MISMATCH", FAILURE)
            Storage-->>Staff: 500 Original file integrity verification failed
        else Seal Valid
            HMAC-->>Storage: Valid: true
            Storage-->>Staff: Return verified buffer
        end
    else No Seal Recorded
        Storage-->>Staff: Return raw buffer
    end
```

---

## 5. Cryptographic HMAC Tamper Detection & Metadata Binding

### 5.1 Canonical Metadata Binding Protocol
To prevent "cut-and-paste" attacks where a valid page from Exam A is transplanted into Exam B without modifying the file bytes, the cryptographic HMAC seal covers **both raw content bytes and canonical binding metadata**:
$$\text{CanonicalMeta} = \texttt{"batchId="} \parallel \text{batchId} \parallel \texttt{"\&seq="} \parallel \text{seq} \parallel \texttt{"\&uploader="} \parallel \text{uploader} \parallel \texttt{"\&ts="} \parallel \text{timestamp}$$

### 5.2 Delimited HMAC Computation
$$\text{HMAC} = \operatorname{HMAC-SHA256}\Big(\text{Secret}_{K_{\text{id}}},\; \text{ContentBytes} \parallel \texttt{"\textbackslash x00--METADATA\_BINDING--\textbackslash x00"} \parallel \text{CanonicalMeta}\Big)$$

The null-byte delimiter (`\x00--METADATA_BINDING--\x00`) strictly separates raw file content from the metadata segment, eliminating ambiguity.

### 5.3 Key Rotation & Isolation
- **Active Key:** Configured via `ORIGINAL_STORAGE_KEY_ID` (default `v1`) and `ORIGINAL_STORAGE_HMAC_SECRET`.
- **Historical Keys:** Looked up via `ORIGINAL_STORAGE_HMAC_SECRET_<KEYID>`.
- **Strict Key Isolation:** The verifier **never** falls back to the active key if a historical key secret is missing. An unavailable key yields an explicit operational error.
- **Timing-Attack Resistance:** HMAC comparisons are evaluated using constant-time byte comparisons (`crypto.timingSafeEqual`).

---

## 6. Audit Trail & Verification Events

Every storage operation and verification failure generates a tamper-evident audit log:
- **`STORAGE_ORIGINAL_WRITTEN` (SUCCESS):** Logs user, `batchId`, `fileId`, `storageKey`, `size`, and `keyId`.
- **`STORAGE_ORIGINAL_WRITTEN` (FAILURE):** Logs failed write attempts, duplicate key conflicts, or disk errors.
- **`INTEGRITY_MISMATCH` (FAILURE):** Logged whenever `readOriginalContent` or `readOriginal` detects byte-level corruption or metadata mismatch on storage assets, recording the `storageKey`, `batchId`, `fileId`, and specific failure reason.
