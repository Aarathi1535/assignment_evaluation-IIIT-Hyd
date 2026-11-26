# Backup, Disaster Recovery Procedures, and Restoration Strategy (AE-233 / PR #359)

> [!NOTE]
> **Status: Architectural Target & Operational Reference**
> Per mentor review guidance on PR #359, the MongoDB Atlas disaster recovery parameters (RPO/RTO, PITR retention, snapshot frequencies) represent target architectural specifications to be verified against the provisioned Atlas project. Offline backup/restoration utilities provide local development, staging transfer, and disaster drill capabilities with strict target-host and transaction guards.

---

## 1. Disaster Recovery Objectives (Target Specifications)

| Metric | Target Specification | Description & Mechanism |
| :--- | :---: | :--- |
| **RPO** (Recovery Point Objective) | **< 1 hour** *(Target)* | Target data loss window. Designed to be supported in production via MongoDB Atlas continuous oplog tailing (Point-in-Time Recovery with 1-minute granularity), pending cluster tier validation. |
| **RTO** (Recovery Time Objective) | **< 30 minutes** *(Target)* | Target platform downtime during disaster recovery. Designed to be achieved through automated Atlas snapshot restore or point-in-time replica set provisioning. |

---

## 2. Production Backup Architecture: MongoDB Atlas Cloud Backups (Target Baseline)

In production, backups are managed natively by **MongoDB Atlas** rather than application-layer cron scripts. This ensures zero CPU/memory overhead on Cloud Run application containers and eliminates risks of lock contention or partial snapshots.

### Target Capabilities (Subject to Atlas Tier Agreement):
1. **Continuous Cloud Backups (Point-in-Time Recovery - PITR)**:
   - Target configuration: Continuous oplog streaming to dedicated cloud backup storage.
   - Allows restoring the cluster to any exact second within a 7-day retention window.
2. **Automated Scheduled Snapshots**:
   - Target schedule: Daily snapshots retained for 30 days; weekly snapshots retained for 12 weeks.
3. **Cross-Region Redundancy**:
   - Snapshot data geo-redundantly stored to protect against regional cloud outages.

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
> These offline scripts are intended for developer workstations, CI testing, and staging environments. Production disaster recovery must always utilize MongoDB Atlas Point-in-Time Recovery. Dumps default to `backups/`, which is ignored in `.gitignore` to prevent committing user data.

### 1. BSON Type Preservation (Canonical EJSON)
Standard `JSON.stringify` drops BSON data types, converting MongoDB `ObjectId`, `Date`, and `Binary` buffers into plain strings, which corrupts database references upon restoration.
The backup engine uses **Canonical EJSON** imported directly from `mongodb` (`const { EJSON } = BSON`), faithfully preserving all MongoDB data types:
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
- **Target Host & Database Guard**: Direct restoration is blocked on non-localhost database targets (or when `NODE_ENV === 'production'`) unless `allowProductionRestore: true` AND `--target-db <dbName>` matching the connected database is explicitly supplied. This prevents developers from accidentally restoring against production databases from local machines.
- **Confirmation for Destructive Drops**: The `--drop-existing` option requires an explicit `--confirm-destructive` flag. Drops are never performed by default.
- **Standalone Non-Empty Target Guard**: When restoring to a standalone MongoDB instance without transaction support, restoring into non-empty collections without `--drop-existing` is blocked to prevent half-inserted data if interrupted.
- **Atomic Transactions**: When connected to a replica set (transactions enabled), restoration runs inside `session.withTransaction()`. Any error triggers an immediate, atomic rollback.

---

## 4. Using the Offline Utilities

### Running a Backup:
```bash
# Standard compressed backup (.json.gz) into gitignored backups/ folder
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

# 3. Verified drill on remote target (requires matching target database name and confirmation)
npx tsx src/scripts/restoreDatabase.ts backups/backup-2026-11-22 --target-db my_staging_db --allow-production-restore
```
