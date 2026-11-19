# Administrator User Guide: IIIT Hyderabad Assignment Evaluation Platform

Welcome to the Platform Administrator Guide. This manual covers system configuration, user role management, cryptographic audit trail verification, security policies, and operational infrastructure monitoring.

---

## 1. Academic Configuration & Course Lifecycle

### 1.1 Managing Terms and Departments
1. Log in with Administrator credentials at `https://eval.iiit.ac.in/admin`.
2. Navigate to **Academic Settings > Terms**:
   - Define active academic years (e.g. `2026-27`) and semesters (`Monsoon`, `Spring`).
   - Configure term start and end boundaries.
3. Under **Departments**, verify active academic branches (CSE, ECE, CND, etc.).

### 1.2 Course Provisioning
1. Navigate to **Course Administration > Create Course**.
2. Specify course code, title, credits, department, and assign the lead **Course Professor**.
3. Once provisioned, the assigned professor gains immediate autonomous administration over exam creation and TA allocations.

---

## 2. User Administration & Role-Based Access Control (RBAC)

The platform enforces strict role-based authorization across four discrete roles:

| Role Identifier | Description & Access Scope |
|-----------------|----------------------------|
| `ADMIN` | Global governance, course provisioning, audit inspection, and system configuration. |
| `PROFESSOR` | Complete autonomous control over owned courses, exams, rubrics, publications, and regrade decisions. |
| `TEACHING_ASSISTANT` | Access strictly scoped to assigned grading queues; student identities anonymized. |
| `STUDENT` | Access restricted to personal published examination results and owned regrade requests. |

### Assigning and Revoking Roles
1. Navigate to **User Directory** (`/admin/users`).
2. Search for user accounts by email or campus roll number.
3. Update the user role in the **Role Assignment** dropdown and click **Save Changes**. All session tokens reflect updated permissions on their next API request.

---

## 3. Cryptographic Audit Trail & Compliance Verification

Every critical state mutation (grade publication, mark override, exam unpublishing, role modification) is recorded in an immutable, cryptographically sealed audit collection.

### 3.1 Inspecting the Audit Trail
1. Navigate to **Security & Audit > Audit Viewer** (`/admin/audit`).
2. Filter events by actor, action type, target resource ID, or timestamp range.
3. Export filtered query records to CSV for academic senate or institutional compliance reporting.

### 3.2 Automated HMAC Integrity Verification
The platform seals audit logs and immutable original assets with SHA-256 HMAC signatures:
```bash
# Run server-side cryptographic audit seal verification
npx tsx src/scripts/verifyIntegrity.ts
```

Expected output:
```
=== IIIT Hyd Platform: Audit Trail & Asset Integrity Verification ===
Scanning 1,420 audit records...
[SEAL] Verifying HMAC signatures against SECRET_KEY_ID: v1
1,420 / 1,420 records verified. Zero tampering detected.
Integrity Status: 100% VALID
```

---

## 4. Operational Health & Disaster Recovery

### 4.1 System Health Monitoring Endpoint
Monitor live infrastructure health through the automated JSON endpoint:
```bash
curl -s -f https://eval.iiit.ac.in/api/health | jq .
```
Response:
```json
{
  "status": "ok",
  "database": "connected",
  "storage": "available",
  "timestamp": "2026-11-19T14:00:00.000Z"
}
```

### 4.2 Backup & Disaster Recovery Execution
In the event of database migration or disaster recovery drills, execute the built-in backup and restore utilities:
```bash
# Generate complete sealed database backup
npx tsx src/scripts/backupDatabase.ts

# Execute non-destructive dry-run restore validation
npx tsx src/scripts/restoreDatabase.ts backups/latest --dry-run

# Execute live database restoration
npx tsx src/scripts/restoreDatabase.ts backups/latest
```
