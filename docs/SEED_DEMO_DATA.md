# Repeatable Seed & Demo Data Generator (AE-225)

## Overview

The `seedDemoData` utility generates an end-to-end, realistic demonstration dataset for staging, manual testing, and automated integration suites.

It creates:
- **Users:** Professor (`prof.demo@university.edu`), TAs (`ta1.demo@university.edu`, etc.), Students (`student1.demo@university.edu`, etc.)
- **Courses & Rosters:** Courses with enrolled students and teaching assistants
- **Exams & Rubrics:** Scheduled/evaluating exams with multi-criterion rubrics
- **Answer Scripts & Anonymization:** Ingested and mapped answer booklets with student roll numbers
- **Allocations:** Script-level or question-level TA allocations
- **Grades:** Sample evaluations with criterion marks, feedback, and finalization status

---

## Safety Guards

The generator includes hard guards preventing execution in production environments:
```typescript
if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PROD_SEED) {
    throw new Error('Demo data generation is forbidden in production');
}
```

---

## CLI Usage

To seed demo data into your development or staging database:

```bash
# Seed default environment (1 course, 1 exam, 4 students, 2 TAs)
npx ts-node src/scripts/seedDemoData.ts

# Seed custom capacity
npx ts-node src/scripts/seedDemoData.ts --students=20 --tas=4 --exams=2

# Clean prior demo data before re-seeding (idempotent reset)
npx ts-node src/scripts/seedDemoData.ts --clean --students=10 --tas=3
```

### Default Credentials

All seeded accounts are created with password `DemoPassword123!`:
- **Professor:** `prof.demo@university.edu`
- **Teaching Assistant 1:** `ta1.demo@university.edu`
- **Teaching Assistant 2:** `ta2.demo@university.edu`
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
    withGrades: true,
    cleanFirst: true,
});

console.log(`Generated ${result.stats.scripts} scripts across ${result.stats.exams} exams.`);
```

---

## Automated Verification

Run the automated Vitest test suite:
```bash
npx vitest run src/__tests__/SeedDemoGeneratorAE225.test.ts
```
