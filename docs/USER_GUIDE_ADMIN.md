# Administrator User Guide: IIIT Hyderabad Assignment Evaluation Platform

Welcome to the Platform Administrator Guide. This manual covers system configuration, user role management, cryptographic audit trail verification, security policies, and operational infrastructure monitoring.

---

## 1. Academic Configuration & Course Lifecycle

### 1.1 Managing Terms and Departments
1. Log in with Administrator credentials at `/login`.
2. Navigate to **Academic Settings** in the Admin Dashboard (`/admin`):
   - Define active academic years (e.g. `2026-27`) and semesters (`Monsoon`, `Spring`).
   - Configure term start and end boundaries.
3. Verify active academic departments (CSE, ECE, CND, etc.).

### 1.2 Course Provisioning
1. Navigate to **Course Administration** (`/professor/courses` or via Admin console).
2. Specify course code, title, credits, department, and assign the lead **Course Professor**.
3. Once provisioned, the assigned professor gains immediate administration over exam creation, rubric configuration, and TA allocations.

---

## 2. User Administration & Role-Based Access Control (RBAC)

The platform enforces strict role-based authorization across four discrete roles:

| Role Identifier | Description & Access Scope |
|-----------------|----------------------------|
| `ADMIN` | Global governance, user administration, system health monitoring, and audit log inspection. |
| `PROFESSOR` | Complete control over owned courses, exams, rubrics, TA allocations, result publication, and regrade arbitration. |
| `TEACHING_ASSISTANT` | Access strictly scoped to assigned grading queues; student identities anonymized. |
| `STUDENT` | Access restricted to personal published examination results and owned regrade requests. |

### Assigning and Revoking Roles
1. Navigate to **User Directory** (`/admin/users`).
2. Search for user accounts by email or campus name.
3. Update the user role in the **Role Assignment** dropdown and save. Updated session tokens reflect new permissions on their next API request.

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

## 4. Operational Health & Disaster Recovery

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
    "timestamp": "2026-11-22T12:00:00.000Z",
    "uptime": 3600
  }
}
```

### 4.2 Backup & Disaster Recovery Strategy
- **Production Standard**: Primary disaster recovery and point-in-time recovery (PITR) are managed through **MongoDB Atlas Continuous Cloud Backups**, providing automated snapshots and continuous oplog replay.
- **Local Validation Drills**: For testing and offline archival, the repository provides non-destructive dry-run inspection:
  ```bash
  # Generate local archive backup
  npx tsx src/scripts/backupDatabase.ts

  # Validate backup archive integrity in dry-run mode (read-only, non-destructive)
  npx tsx src/scripts/restoreDatabase.ts backups/latest --dry-run
  ```
> [!CAUTION]
> Never execute raw destructive database restores against a live database. Production restores are managed exclusively through cloud provider snapshot rollbacks to prevent catastrophic data loss.
