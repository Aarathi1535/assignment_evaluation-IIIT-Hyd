# Backup, Disaster Recovery Procedures, and Restoration Strategy (AE-233)

This document establishes the official disaster recovery (DR) architecture, recovery objectives, production MongoDB Atlas backup procedures, and offline backup/restoration tooling for the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Disaster Recovery Objectives (RPO & RTO)

| Metric | Target | Description & Mechanism |
|--------|--------|-------------------------|
| **RPO** (Recovery Point Objective) | **< 1 hour** | Maximum acceptable data loss window. Supported in production via MongoDB Atlas continuous oplog tailing (Point-in-Time Recovery with 1-minute granularity). |
| **RTO** (Recovery Time Objective) | **< 30 minutes** | Maximum allowable platform downtime during a disaster event. Achieved through automated Atlas snapshot restore or point-in-time replica set provisioning. |

---

## 2. Production Backup Architecture: MongoDB Atlas Cloud Backups

In production, backups are managed natively by **MongoDB Atlas** rather than application-layer cron scripts. This ensures zero CPU/memory overhead on Cloud Run application containers and eliminates risks of lock contention or partial snapshots.

### Key Capabilities:
1. **Continuous Cloud Backups (Point-in-Time Recovery - PITR)**:
   - Atlas continuously streams the MongoDB oplog to dedicated cloud backup storage.
   - Allows restoring the cluster to any exact second within the 7-day retention window.
2. **Automated Scheduled Snapshots**:
   - Daily snapshots retained for 30 days.
   - Weekly snapshots retained for 12 weeks.
3. **Cross-Region Redundancy**:
   - Snapshot data is geo-redundantly stored to protect against regional cloud outages.

### Production Restoration Procedures (Atlas):
When disaster recovery is required:
1. Navigate to **MongoDB Atlas Console** > **Deployment** > **Database** > **Backups**.
2. Select **Restore** and choose between:
   - **Point in Time**: Enter the target timestamp immediately preceding the corruption or incident.
   - **Snapshot**: Select the desired daily snapshot.
3. Choose the destination:
   - **Restore to New Cluster** (Recommended for forensic verification and disaster drills).
   - **Restore In-Place** (Overwrites existing cluster once confirmed by lead infrastructure engineer).

---

## 3. Offline Backup & Restore Utilities (`src/scripts/`)

For local development, testing, staging data transfers, and offline disaster drills, the platform provides dedicated TypeScript utilities:
- `src/scripts/backupDatabase.ts`
- `src/scripts/restoreDatabase.ts`

> [!WARNING]
> These offline scripts are intended for developer workstations, CI testing, and staging environments. Production disaster recovery must always utilize MongoDB Atlas Point-in-Time Recovery.

### 1. BSON Type Preservation (Canonical EJSON)
Standard `JSON.stringify` drops BSON data types, converting MongoDB `ObjectId`, `Date`, and `Binary` buffers into plain strings, which corrupts database references upon restoration.
The backup engine uses **Canonical EJSON** (`import { EJSON } from 'bson'`), faithfully preserving all MongoDB data types:
- `_id: { "$oid": "..." }` -> deserialized as `ObjectId`
- `createdAt: { "$date": "..." }` -> deserialized as native `Date`
- `data: { "$binary": ... }` -> deserialized as BSON `Binary`

### 2. Cryptographic Manifest Integrity (`manifestSha256`)
Every backup generates a `manifest.json` recording:
- Database name, ISO timestamp, and document counts.
- SHA-256 checksum for every collection dump.
- An overall `manifestSha256` seal calculated across the entire manifest structure.

Before modifying any collection during restoration, `restoreDatabase.ts`:
1. Recomputes and validates `manifestSha256` against the manifest contents.
2. Computes the SHA-256 hash of each collection file on disk and verifies an exact match against the manifest checksum. If any file has been modified or corrupted, restoration immediately aborts without touching the database.

### 3. Operational Safety Guards
To prevent accidental data loss:
- **Production Guard**: Restoration is unconditionally blocked if `NODE_ENV === 'production'` unless `allowProductionRestore: true` (or `--allow-production-restore`) is passed.
- **Confirmation for Destructive Drops**: The `--drop-existing` option requires an explicit `--confirm-destructive` flag. Drops are never performed by default.
- **Atomic Transactions**: When connected to a replica set (transactions enabled), restoration runs inside `session.withTransaction()`. Any error triggers an immediate, atomic rollback.

---

## 4. Using the Offline Utilities

### Running a Backup:
```bash
# Standard compressed backup (.json.gz)
npx tsx src/scripts/backupDatabase.ts

# Programmatic invocation
import { createDatabaseBackup } from '../scripts/backupDatabase';

const { backupDir, manifest } = await createDatabaseBackup({
  compress: true,
  targetDir: './backups/backup-2026-11-22',
});
```

### Running a Restore:
```bash
# 1. Dry-run verification (recomputes checksums, does not modify database)
npx tsx src/scripts/restoreDatabase.ts backups/backup-2026-11-22 --dry-run

# 2. Live restore (requires explicit confirmation if dropping existing collections)
npx tsx src/scripts/restoreDatabase.ts backups/backup-2026-11-22 --drop-existing --confirm-destructive
```
