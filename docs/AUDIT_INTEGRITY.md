# Audit Trail Cryptographic Integrity & Verification Architecture (AE-208 / AE-338)

## 1. Overview

The **Assignment Evaluator** audit system provides an append-only, tamper-evident cryptographic audit log for all security-sensitive and grading-critical operations. The integrity subsystem guarantees sequence continuity, individual record authenticity, and chain unbrokenness across multi-instance concurrent deployments.

---

## 2. Integrity Architecture & Data Model

### 2.1 State Tracking (`AuditLogIntegrityState`)

A singleton collection document (`_id: 'global'`) tracks the high-water sequence mark and current chain head:

- `lastSequence`: The highest allocated sequence number.
- `cutoverSequence`: Sequence number marking the boundary between legacy unsealed/v1 records and chained v2 records.
- `cutoverDate`: Explicit timestamp threshold for cutover; records created after this timestamp must be sealed.
- `stateSealVersion`: Schema version of the state seal (`3` for current canonical payload).
- `lastRecordHmac`: The HMAC seal of the most recent committed record in the chain.
- `integritySeal`: HMAC signature binding `lastSequence`, `cutoverSequence`, `cutoverDate`, `lastRecordHmac`, and `keyId`.
- `integrityKeyId`: Active cryptographic key identifier (from `ORIGINAL_STORAGE_KEY_ID`).
- `leaseExpiresAt`, `allocationToken`: Distributed mutual-exclusion lease preventing split-brain sequence allocations.

### 2.2 Canonical State Seal Payloads

State seals use versioned canonical JSON payloads:

1. **Version 3 (Canonical)**:
   - Formatted as `{"version": 3, "lastSequence": N, "cutoverSequence": C, "cutoverDate": ISO_DATE, "lastRecordHmac": HMAC, "keyId": KEY_ID}`.
   - Binds `cutoverDate` directly into the HMAC seal to prevent tampering with the cutover timeline.
2. **Version 2 (Legacy Compatibility)**:
   - Formatted as `{"version": 2, "lastSequence": N, "cutoverSequence": C, "lastRecordHmac": HMAC, "keyId": KEY_ID}`.
   - Accepted only when `stateSealVersion` is `2` or undefined, ensuring seamless verification of legacy state documents without allowing downgrades.
3. **Version 1 (Pre-Cutover Legacy)**:
   - Valid only below `cutoverSequence` for historical unversioned records.

### 2.3 Record Sealing (`AuditLog`)

Every audit document is signed with HMAC-SHA256 over its canonical JSON representation:

1. **Version 1 (Legacy / Pre-Cutover)**:
   - Encodes `version: 1`, `sequence`, `keyId`, `user`, `action`, `outcome`, `entityId`, `entityType`, `details`, `ipAddress`, and `createdAt`.
   - **Pre-Cutover Records**: Sealed records below `cutoverSequence` are verified with `verifyAuditIntegritySeal(record, cutoverSequence)`, which accepts valid v1 seals. Records carrying a seal but lacking a valid `sequence` are flagged with `SEAL_INVALID`. Unsealed pre-cutover entries are counted as `UNSEALED_RECORD`.
2. **Version 2 (Chained Post-Cutover)**:
   - Encodes `version: 2`, `sequence`, `keyId`, `previousSeal`, `user`, `action`, `outcome`, `entityId`, `entityType`, `details`, `ipAddress`, and `createdAt`.
   - **Chain Requirement**: On every record after the cutover (`sequence > cutoverSequence`), `previousSeal` is **strictly required** and must match the preceding record's HMAC seal (`lastRecordHmac`). For the genesis record at `cutoverSequence`, `previousSeal` is `'GENESIS'`.

---

## 3. Verification Protocol (`AuditIntegrityService`)

The verification service traverses all audit records in ascending sequence order and enforces:

1. **State Existence and Missing State Handling**:
   - If the global `AuditLogIntegrityState` document is completely missing from the database, but individual records carry seals or sequence numbers, the verifier detects that the trail was previously sealed and reports `MISMATCH` with diagnostic `INTEGRITY_STATE_MISSING`. It does not report `UNSEALED`.
2. **Pre-Cutover & Unsealed Records**:
   - Sealed records below `cutoverSequence` are verified against legacy v1 seal rules.
   - Unsealed records created prior to cutover are classified as `UNSEALED_RECORD` (valid legacy history).
   - Any unsealed record created after `cutoverDate` is rejected with `UNSEALED_RECORD_AFTER_CUTOVER`.
3. **Strict Sequence Monotonicity**:
   - Detected gaps are flagged as `SEQUENCE_GAP`.
   - Decreasing or out-of-order sequences are flagged as `SEQUENCE_ORDER_INVALID`.
4. **Cryptographic Chaining (`previousSeal`)**:
   - Every record after `cutoverSequence` must possess a non-empty `previousSeal` equal to the preceding record's HMAC.
   - Any broken link or missing `previousSeal` is flagged as `CHAIN_BROKEN`.
5. **State Seal Validation**:
   - The global integrity state document is verified using `verifyAuditIntegrityStateSeal`. Mismatches with the highest recorded sequence or an invalid state HMAC trigger `INTEGRITY_STATE_INVALID`.

---

## 4. Threat Model & Limitations

### 4.1 Internal Tamper-Evidence
- **Direct Record Tampering**: Modifying any field (user, action, outcome, details, timestamp) invalidates the HMAC seal (`SEAL_INVALID`).
- **Record Deletion**: Deleting any intermediate record breaks the sequence continuity (`SEQUENCE_GAP`) and breaks the hash chain (`CHAIN_BROKEN`).
- **Tail Deletion / Rollback**: Deleting records from the end causes `highestSequence` to lag behind `AuditLogIntegrityState.lastSequence`, producing a sequence gap (`SEQUENCE_GAP`).
- **State Manipulation**: Modifying `lastSequence` or tampering with `cutoverDate` in a v3 state fails state verification (`INTEGRITY_STATE_INVALID`). Deleting the state document produces `MISMATCH` with `INTEGRITY_STATE_MISSING`.

### 4.2 Backup Restoration Limitation (External Anchor Requirement)

> [!IMPORTANT]
> **Backup Restoration Detection Boundary**:
> If an operator or attacker restores **both** the database records (`AuditLog` collection) and the state seal (`AuditLogIntegrityState` document) from a previously valid backup, the verification service will evaluate all cryptographic seals, sequences, and hash chains as fully consistent (`INTACT`).
>
> Therefore, **restoring both records and the state seal from a backup cannot be detected without an external anchor** (such as an external append-only ledger, a public timestamp authority, a transparency log, or cross-system block commitments).

### 4.3 Unsequenced Records with Forged Past Timestamps Limitation

> [!NOTE]
> **Heuristic for Unsequenced Records**:
> The verification service currently inspects `createdAt` against `cutoverDate` to detect unsealed records inserted after cutover (`UNSEALED_RECORD_AFTER_CUTOVER`).
>
> Consequently, if an attacker with direct database access crafts an unsequenced document with a forged backdated `createdAt` prior to `cutoverDate`, the document cannot be cryptographically distinguished from a genuine pre-cutover legacy record using database fields alone. Issue #338 tracks this limitation for future notary-backed anchoring.
