# Repeatable Seed & Demo Data Generator (AE-225)

## Overview

The `seedDemoData` utility generates an end-to-end, realistic demonstration dataset for local development, staging, manual testing, and automated integration suites.

It creates:
- **Users:** Professor (`prof.demo@university.edu`), TAs (`ta1.demo@university.edu`, etc.), Students (`student1.demo@university.edu`, etc.)
- **Courses & Rosters:** Courses with enrolled students and teaching assistants
- **Exams & Rubrics:** Scheduled/evaluating exams with multi-criterion rubrics
- **Answer Scripts & Anonymization:** Ingested and mapped answer booklets with student roll numbers
- **Pages & Derived Images:** Multi-page canvas-rendered answer sheet images persisted in derived storage
- **Allocations:** Script-level or question-level TA allocations
- **Grades:** Sample evaluations with criterion marks, feedback, and finalization status

---

## Safety Guards & Host Allowlist

The generator strictly forbids execution in production and requires the target MongoDB database host and storage bucket to be in an allowlist:
1. **Production Guard:** Blocked if `NODE_ENV === 'production'`.
2. **Database Host Allowlist:** Only allows connections to `localhost`, `127.0.0.1`, `::1`, or in-memory test databases (`mongodb-memory-server`). Connecting to an external cluster requires an explicit opt-in via the `DEMO_CLUSTER_HOST` environment variable matching the cluster hostname exactly; generic substring matches or unconfigured hosts containing "demo" are strictly rejected.
3. **Derived Storage Bucket Guard:** When `DERIVED_PAGE_STORAGE_BUCKET` is configured, the generator refuses to operate unless the target bucket is explicitly a demo bucket (bucket name contains `demo` or matches `DEMO_STORAGE_BUCKET`).
4. **Safe Scoped Cleaning:** When running with `--clean`, records tagged with `demo: true` (as well as linked demo entities) are deleted. In addition, all corresponding demo images are removed from storage via `DerivedStorageService.cleanupDerivedBatch(batchId)`. Real courses, exams, scripts, and grades are strictly preserved.

---

## CLI Usage

To seed demo data into your development or staging database (using `tsx`):

```bash
# Seed default environment (1 course, 1 exam, 4 students, 2 TAs)
npx tsx src/scripts/seedDemoData.ts

# Seed custom capacity
npx tsx src/scripts/seedDemoData.ts --students=20 --tas=4 --exams=2

# Clean prior demo data before re-seeding (idempotent reset)
npx tsx src/scripts/seedDemoData.ts --clean --students=10 --tas=3
```

### Credentials & Security

Passwords are no longer hardcoded:
- A unique random password is generated per run (or configured via the `DEMO_PASSWORD` environment variable) and printed upon completion.
- **Demo Passwords Reset on Each Run:** Every time the seed script executes (with or without `--clean`), all demo users' passwords are reset to the newly generated password (or `DEMO_PASSWORD`). Always use the credentials printed in the latest run summary.
- Example login credentials:
  - **Professor:** `prof.demo@university.edu`
  - **Teaching Assistant 1:** `ta1.demo@university.edu`
  - **Student 1:** `student1.demo@university.edu`

---

## Programmatic API

The generator can also be imported directly inside tests or scripts:

```typescript
import { seedDemoData } from '@/scripts/seedDemoData';

const result = await seedDemoData({
    coursesCount: 1,
    examsPerCourse: 1,
    studentsCount: 10,
    tasCount: 2,
    questionsCount: 3,
    pagesPerScript: 3,
    withGrades: true,
    cleanFirst: true,
});

console.log(`Generated ${result.stats.scripts} scripts with ${result.stats.pages} pages across ${result.stats.exams} exams.`);
console.log(`Credentials Password: ${result.generatedPassword}`);
```

---

## Automated Verification

Run the automated Vitest test suite:
```bash
npx vitest run src/__tests__/SeedDemoGeneratorAE225.test.ts
```
