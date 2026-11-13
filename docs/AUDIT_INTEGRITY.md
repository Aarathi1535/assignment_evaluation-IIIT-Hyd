# Audit Trail Cryptographic Integrity & Verification Architecture (AE-208)

## 1. Overview

The **Assignment Evaluator** audit system provides an append-only, tamper-evident cryptographic audit log for all security-sensitive and grading-critical operations. The integrity subsystem (AE-208) guarantees sequence continuity, individual record authenticity, and chain unbrokenness across multi-instance concurrent deployments.

---

## 2. Integrity Architecture & Data Model

### 2.1 State Tracking (`AuditLogIntegrityState`)

A singleton collection document (`_id: 'global'`) tracks the high-water sequence mark and current chain head:

- `lastSequence`: The highest allocated sequence number.
- `cutoverSequence`: Sequence number marking the boundary between legacy unsealed/v1 records and chained v2 records.
- `lastRecordHmac`: The HMAC seal of the most recent committed record in the chain.
- `integritySeal`: HMAC signature binding `lastSequence`, `cutoverSequence`, `lastRecordHmac`, and `keyId`.
- `integrityKeyId`: Active cryptographic key identifier (from `ORIGINAL_STORAGE_KEY_ID`).
- `leaseExpiresAt`, `allocationToken`: Distributed mutual-exclusion lease preventing split-brain sequence allocations.

### 2.2 Record Sealing (`AuditLog`)

Every audit document is signed with HMAC-SHA256 over its canonical JSON representation:

1. **Version 1 (Legacy / Pre-Cutover)**:
   - Encodes `version: 1`, `sequence`, `keyId`, `user`, `action`, `outcome`, `entityId`, `entityType`, `details`, `ipAddress`, and `createdAt`.
   - **Cutover Policy**: The verifier accepts v1 seals **only below `cutoverSequence`**. At or above `cutoverSequence`, v1 seals are rejected.
2. **Version 2 (Chained Post-Cutover)**:
   - Encodes `version: 2`, `sequence`, `keyId`, `previousSeal`, `user`, `action`, `outcome`, `entityId`, `entityType`, `details`, `ipAddress`, and `createdAt`.
   - **Chain Requirement**: On every record after the cutover (`sequence > cutoverSequence`), `previousSeal` is **strictly required** and must match the preceding record's HMAC seal (`lastRecordHmac`). For the genesis record at `cutoverSequence`, `previousSeal` is `'GENESIS'`.

---

## 3. Verification Protocol (`AuditIntegrityService`)

The verification service traverses all audit records in ascending sequence order and enforces:

1. **Unsealed Records After Cutover**:
   - Any record with `sequence < cutoverSequence` created prior to cutover is marked `UNSEALED_RECORD` (valid for legacy history).
   - Any unsealed record created after `cutoverDate` is rejected with `UNSEALED_RECORD_AFTER_CUTOVER`.
2. **Strict Sequence Monotonicity**:
   - Detected gaps are flagged as `SEQUENCE_GAP`.
   - Decreasing or out-of-order sequences are flagged as `SEQUENCE_ORDER_INVALID`.
3. **Cryptographic Chaining (`previousSeal`)**:
   - Every record after `cutoverSequence` must possess a non-empty `previousSeal` equal to the preceding record's HMAC.
   - Any broken link or missing `previousSeal` is flagged as `CHAIN_BROKEN`.
4. **State Seal Validation**:
   - The global integrity state document is verified. Mismatches with the highest recorded sequence or an invalid state HMAC trigger `INTEGRITY_STATE_INVALID`.

---

## 4. Threat Model & Limitations

### 4.1 Internal Tamper-Evidence
- **Direct Record Tampering**: Modifying any field (user, action, outcome, details, timestamp) invalidates the HMAC seal (`SEAL_INVALID`).
- **Record Deletion**: Deleting any intermediate record breaks the sequence continuity (`SEQUENCE_GAP`) and breaks the hash chain (`CHAIN_BROKEN`).
- **Tail Deletion / Rollback**: Deleting records from the end causes `highestSequence` to lag behind `AuditLogIntegrityState.lastSequence` (`INTEGRITY_STATE_INVALID`).
- **State Manipulation**: Modifying `lastSequence` without the secret HMAC key fails state verification.

### 4.2 Backup Restoration Limitation (External Anchor Requirement)

> [!IMPORTANT]
> **Backup Restoration Detection Boundary**:
> If an operator or attacker restores **both** the database records (`AuditLog` collection) and the state seal (`AuditLogIntegrityState` document) from a previously valid backup, the verification service will evaluate all cryptographic seals, sequences, and hash chains as fully consistent (`INTACT`).
>
> Therefore, **restoring both records and the state seal from a backup cannot be detected without an external anchor** (such as an external append-only ledger, a public timestamp authority, a transparency log, or cross-system block commitments).
>
> This design boundary is explicitly documented and accepted for the current system architecture. Future releases will integrate external notary anchors for cross-system tamper verification.
