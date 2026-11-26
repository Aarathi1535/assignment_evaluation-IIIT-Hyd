# Administrator User Guide: IIIT Hyderabad Assignment Evaluation Platform

Welcome to the Platform Administrator Guide. This manual covers system configuration, user role management, cryptographic audit trail verification, security policies, and operational infrastructure monitoring.

---

## 1. System Administration & Overview

### 1.1 Administrator Dashboard
1. Log in with Administrator credentials at `/login`.
2. Navigate to the Admin Dashboard (`/admin`):
   - Review overview metrics, active exams, and system health status.
   - Access user directory, audit trails, and examination batches.

---

## 2. User Administration & Role-Based Access Control (RBAC)

The platform enforces strict role-based authorization across four discrete roles defined in `UserRole`:

| Role Identifier | Description & Access Scope |
|-----------------|----------------------------|
| `ADMIN` | Global governance, user administration, system health monitoring, and audit log inspection. |
| `PROFESSOR` | Complete control over owned courses, exams, rubrics, TA allocations, result publication, and regrade arbitration. |
| `TA` | Teaching Assistant access strictly scoped to assigned grading queues; student identities anonymized. |
| `STUDENT` | Access restricted to personal published examination results and owned regrade requests. |

### 2.1 User Directory & Account Management
1. Navigate to **User Directory** (`/admin/users`).
2. Search for user accounts by name or email address.
3. Review user role badges (`ADMIN`, `PROFESSOR`, `TA`, `STUDENT`) and active account status.
4. Manage accounts via creation modals, CSV bulk onboarding, or account deactivation dialogs.

---

## 3. Cryptographic Audit Trail & Compliance Verification

Every critical state mutation (grade publication, mark override, exam unpublishing, role modification) is recorded in an immutable, cryptographically sealed audit collection.

### 3.1 Inspecting the Audit Trail
1. Navigate to **Audit Logs** (`/admin/audit-logs`).
2. Filter events by actor, action type, target resource ID, or timestamp range.
3. Export filtered query records to CSV for academic senate or institutional compliance reporting via `/api/audit-logs/export`.

### 3.2 Automated HMAC Integrity Verification
The platform seals audit logs and immutable original assets with SHA-256 HMAC signatures:
```bash
# Run server-side cryptographic audit seal verification
npx tsx src/scripts/verifyIntegrity.ts
```

---

## 4. Operational Health & Backup Architecture

### 4.1 System Health Monitoring Endpoint
Monitor live infrastructure health through the automated JSON health probe:
```bash
curl -s -f http://localhost:3000/api/health | jq .
```
Response format:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "database": "connected",
    "timestamp": "2026-11-24T12:00:00.000Z"
  }
}
```

### 4.2 Backup & Disaster Recovery Architecture
- **Production Standard**: Primary disaster recovery and point-in-time recovery (PITR) are managed through **MongoDB Atlas Continuous Cloud Backups**, providing automated snapshots and continuous oplog replay.
> [!CAUTION]
> Production restores are managed exclusively through cloud provider snapshot rollbacks to prevent data loss.
