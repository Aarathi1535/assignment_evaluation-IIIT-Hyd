# Backup, Disaster Recovery Procedures, and Restoration Engine (AE-233)

This document establishes the official disaster recovery (DR) strategy, recovery objectives, automated backup procedures, integrity verification protocols, and step-by-step restoration runbook for the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Disaster Recovery Objectives (RPO & RTO)

| Metric | Target | Description & Mechanism |
|--------|--------|-------------------------|
| **RPO** (Recovery Point Objective) | **< 1 hour** | Maximum acceptable data loss window. Supported via MongoDB Atlas continuous oplog tailing, hourly snapshots, and idempotent event replay. |
| **RTO** (Recovery Time Objective) | **< 30 minutes** | Maximum allowable platform downtime during a disaster. Script-based restore engine restores typical 5,000-page exam datasets in under 5 minutes. |

---

## 2. Multi-Tiered Backup Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Primary Operations Layer                        │
│  - Cloud Run / App Pods                                               │
│  - MongoDB Atlas M10 Replica Set (3-node cross-AZ in Mumbai)          │
│  - GCS Standard Bucket (Encrypted, Versioning Enabled)                │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           │                                                   │
           ▼                                                   ▼
┌───────────────────────────────┐           ┌───────────────────────────────────┐
│     Automated PITR Backups    │           │    Portable Application Backups   │
│ - Continuous oplog retention  │           │ - Timestamped snapshot manifests  │
│ - 7-day granular rollback     │           │ - Per-collection SHA-256 checksum │
│ - Daily Atlas snapshots       │           │ - Gzip compressed collection dumps│
└───────────────────────────────┘           └─────────────────┬─────────────────┘
                                                              │
                                                              ▼
                                            ┌───────────────────────────────────┐
                                            │      Encrypted Offsite Storage    │
                                            │ - Coldline / Archive GCS bucket   │
                                            │ - WORM Object Retention Policy    │
                                            │ - Geo-redundant storage           │
                                            └───────────────────────────────────┘
```

---

## 3. Backup Retention Schedule

| Tier | Frequency | Retention Window | Storage Target |
|------|-----------|------------------|----------------|
| **Nearline Oplog** | Continuous | 7 days | MongoDB Atlas Managed Cloud Backup |
| **Hourly Snapshots** | Every 60 min | 48 hours | GCS Nearline (`iiit-eval-backups-hourly`) |
| **Daily Snapshots** | Daily at 02:00 IST | 30 days | GCS Coldline (`iiit-eval-backups-daily`) |
| **Semester Archives** | Post-Grading Complete | 3 Years | GCS Archive with Object Lock (WORM) |

---

## 4. Automated Backup Utility (`src/scripts/backupDatabase.ts`)

The backup utility exports all database collections into deterministic JSON or Gzip archives and produces a cryptographically sealed `manifest.json`.

### Features:
- **Per-Collection Hashing**: Every collection archive is hashed with SHA-256.
- **Manifest Tamper Detection**: The manifest contains record counts and file hashes, sealed with an overall `manifestSha256`.
- **Zero Downtime**: Reads are executed using non-locking queries compatible with active grading operations.

### Running a Backup:
```bash
# Standard backup (JSON format)
npx tsx src/scripts/backupDatabase.ts

# Programmatic invocation in TypeScript
import { createDatabaseBackup } from './src/scripts/backupDatabase';

const { backupDir, manifest } = await createDatabaseBackup({
  compress: true,
  targetDir: './backups/backup-2026-11-19',
});
```

Sample `manifest.json`:
```json
{
  "version": "1.0.0",
  "timestamp": "2026-11-19T12:00:00.000Z",
  "database": "assignment-evaluator",
  "collections": {
    "courses": {
      "name": "courses",
      "count": 5,
      "sha256": "3a8b...1f2",
      "fileName": "courses.json.gz"
    },
    "auditlogs": {
      "name": "auditlogs",
      "count": 1420,
      "sha256": "9b12...c44",
      "fileName": "auditlogs.json.gz"
    }
  },
  "totalDocuments": 1425,
  "manifestSha256": "7e14...a09"
}
```

---

## 5. Deterministic Restoration Engine (`src/scripts/restoreDatabase.ts`)

The restore engine provides guaranteed recovery with strict pre-flight validation.

### Pre-flight Integrity Guarantees:
1. **Checksum Verification**: Before modifying any collection, the engine decompresses and recomputes the SHA-256 hash of every collection file, validating it against `manifest.json`. If even one byte differs, restore immediately halts.
2. **Schema & Array Validation**: Verifies that files contain valid document arrays.
3. **Dry-Run Mode (`--dry-run`)**: Allows operators to test backup integrity, disk access, and database connectivity without altering any live records.

### Running a Restore:

#### 1. Dry-Run Verification (Mandatory First Step)
```bash
npx tsx src/scripts/restoreDatabase.ts backups/backup-2026-11-19 --dry-run
```

Output:
```
✅ [DRY RUN] Restore completed successfully!
📦 Validated 1,425 documents across 2 collections (Checksums 100% matched)
```

#### 2. Live Database Restoration
```bash
npx tsx src/scripts/restoreDatabase.ts backups/backup-2026-11-19
```

---

## 6. Disaster Recovery Drill Runbook

Follow this step-by-step checklist during a disaster recovery drill or live recovery event:

```
[Phase 1: Incident Isolation]
  │
  ├─► 1. Divert traffic to Maintenance Page (set CLOUD_RUN_MAINTENANCE=true)
  ├─► 2. Lock write permissions on corrupted cluster
  │
[Phase 2: Backup Selection & Verification]
  │
  ├─► 3. Identify target backup directory (local or pulled from GCS)
  ├─► 4. Run Dry-Run verification:
  │      `npx tsx src/scripts/restoreDatabase.ts <backup_dir> --dry-run`
  │      (Verify: all collection checksums return OK)
  │
[Phase 3: Restoration]
  │
  ├─► 5. Execute live restoration:
  │      `npx tsx src/scripts/restoreDatabase.ts <backup_dir>`
  │
[Phase 4: Post-Restore Audit & Health Check]
  │
  ├─► 6. Run audit log HMAC seal verification:
  │      `npx tsx src/scripts/verifyIntegrity.ts`
  ├─► 7. Query `/api/health` to confirm MongoDB connectivity
  ├─► 8. Verify document counts against manifest totals
  │
[Phase 5: Resumption]
  │
  └─► 9. Route traffic back to platform and monitor latency
```
