# Final Bug Fixes, Regression Hardening, and Resilience Guards (AE-240)

This document establishes the comprehensive regression hardening audit, boundary edge-case mitigations, and defensive resilience utilities across all five operational lifecycles of the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Executive Summary & Audit Scope

Prior to final demonstration and institutional handover, a comprehensive regression hardening audit was conducted across every subsystem:
1. **Ingestion & Preprocessing**: PDF ingestion, page segmentation, magic byte verification, blank detection.
2. **Allocation & Concurrency**: TA allocation queues, simultaneous grading locks, replica set transactions.
3. **Canvas & Offline Grading**: Multi-tab draft synchronization, hardware stylus pressure, digitizer smoothing.
4. **Publication & Regrades**: Regrade appeal window boundaries, mark sanitization, score step snapping.
5. **Security & Storage**: WORM immutability, HMAC cryptographic seals, rate limiting, and RBAC matrix.

---

## 2. Phase-by-Phase Vulnerability & Hardening Matrix

| Operational Phase | Vulnerability / Edge Case | Failure Mode Without Guard | Implemented Hardening Guard |
|-------------------|---------------------------|----------------------------|-----------------------------|
| **1. Ingestion** | Spoofed MIME-type upload (e.g. `.exe` renamed to `.pdf`) | Ingestion worker crash or buffer overflow | `detectFileTypeByMagicBytes` inspects binary headers; `validatePayloadSize` caps memory allocation at 15 MB. |
| **2. Concurrency**| Concurrent TA grading on same student script | Silent overwrite of marks and annotations | MongoDB replica set transactions with version locks; second write fails with conflict status. |
| **3. Offline Sync**| TA opens grading workspace in multiple browser tabs | Outdated tab overwrites newer annotations | `resolveDraftConflict` evaluates monotonic version vectors; higher version wins deterministically. |
| **4. Regrades** | Submission at the exact closing second of the 7-day window | Client/server clock skew causes false 403 rejection | `isRegradeWindowOpen` incorporates a 5,000 ms clock-skew grace period at the closing boundary. |
| **4. Scoring** | Manual input of negative marks, `NaN`, or non-step fractions | Database corruption or score calculation anomalies | `sanitizeMark` strictly validates numeric bounds `[0, maxMarks]` and snaps to rubric score step (e.g. 0.5). |
| **5. Storage** | Tampering with stored physical scans or audit records | Academic dispute or grading audit failure | SHA-256 HMAC cryptographic seals verified via `verifyIntegrity.ts`; GCS WORM object locks prevent deletion. |

---

## 3. Boundary Condition Specifications

### 3.1 Regrade Window Closing Boundary
```
[Day 0: Results Published] ──────────────────────────────────────────► [Day 7: Window Closes]
                                                                                │
                                                                                ├─► Within closing second: ACCEPTED
                                                                                ├─► Up to +5000ms (Clock Skew): ACCEPTED
                                                                                └─► > +5001ms: REJECTED (HTTP 403 EXPIRED)
```
- **Clock Skew Compensation**: Evaluates `isRegradeWindowOpen(start, end, now, toleranceMs = 5000)`.
- Eliminates student frustration caused by NTP drift between campus client devices and cloud server instances.

### 3.2 Offline Draft Conflict Resolution
When an evaluator edits an exam question across multiple devices or browser tabs:
1. Every draft modification increments a local `version` counter.
2. When synchronizing with the database, `resolveDraftConflict` compares:
   $$\text{Winner} = \begin{cases} \text{Incoming}, & \text{if } V_{\text{incoming}} > V_{\text{local}} \\ \text{Local}, & \text{if } V_{\text{local}} > V_{\text{incoming}} \\ \text{Latest Timestamp}, & \text{if } V_{\text{local}} = V_{\text{incoming}} \end{cases}$$
3. Guarantees that newer grading derivations can never be overwritten by an older stale tab session.

### 3.3 Score Sanitization & Granularity Snapping
`sanitizeMark(rawMark, maxQuestionMarks, scoreStep)` enforces three invariants:
1. **Positivity**: Non-negative numbers only ($$\text{Mark} \ge 0$$).
2. **Ceiling**: Mark cannot exceed maximum question points ($$\text{Mark} \le \text{MaxMarks}$$).
3. **Step Alignment**: Fractional points must align with rubric steps (e.g., $$0.5, 1.0, 1.5$$); invalid floating-point inputs are automatically snapped to the nearest valid step.

---

## 4. Regression Verification Suite

The automated regression test suite (`src/__tests__/RegressionHardeningAE240.test.ts`) verifies:
- Boundary conditions for open, closed, and closing-second regrade submissions.
- Version-vector multi-tab conflict resolution.
- Rejection of oversized and negative payload sizes.
- Mark sanitization, step alignment, and invalid input rejection.
- Documentation completeness and edge-case traceability.
