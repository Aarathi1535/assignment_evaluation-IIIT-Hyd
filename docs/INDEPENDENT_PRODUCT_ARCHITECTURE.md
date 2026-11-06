# Independent Product Architecture

This document specifies the decoupled, multi-product architecture of the IIIT Hyderabad Learning Platform.

## 1. System Overview

The platform is partitioned into three independently operating products accessible via a unified discovery portal:

1. **Assignment Evaluation (Product 1)**: The core grading platform supporting exam ingestion, rubrics, handwritten script annotation, multi-grader allocations, analytics, regrading, and LMS grade exports.
2. **Classroom Activity (Product 2)**: Live classroom engagement system supporting QR-based code joining, synchronized question delivery, student handwritten uploads, real-time SSE event streaming, OCR handwriting extraction, and live professor review.
3. **Personalised Learning (Product 3)**: Adaptive learning platform supporting daily 3-question mastery cycles, student knowledge state tracking, syllabus-aligned taxonomy, and AI question generation using Gemini.

```
                    ┌────────────────────────────────────────────────────────┐
                    │  Unified Landing Hub (src/app/page.tsx)                │
                    │  Discovery & Entry Point (No Shared Authentication)    │
                    └──────────────┬──────────────────┬──────────────────────┘
                                   │                  │
         ┌─────────────────────────┼──────────────────┼─────────────────────────┐
         │                         │                  │                         │
         ▼                         ▼                  ▼                         ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Product 1       │     │  Product 2       │     │  Product 3       │
│  Assignment Eval │     │  Classroom Act.  │     │  Personalised    │
├──────────────────┤     ├──────────────────┤     ├──────────────────┤
│ Port: 3000       │     │ Port: 3001       │     │ Port: 3002       │
│ DB: MONGODB_URI  │     │ DB: CLASSROOM_URI│     │ DB: PERSONAL_URI │
│ Auth: NextAuth   │     │ Auth: ClassToken │     │ Auth: PersonToken│
│ Storage: Local/S3│     │ Storage: Uploads │     │ Storage: GCS/Loc │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

---

## 2. Product Boundaries & Isolation

### Product 1: Assignment Evaluation
- **Access URL**: `/login` (or `/admin`, `/professor`, `/ta`, `/student`)
- **Database**: `MONGODB_URI` (`connectDB()`)
- **User Management**: `src/models/User.ts` (ADMIN, PROFESSOR, TA, STUDENT)
- **Authentication**: NextAuth credentials provider (`/api/auth/[...nextauth]`)
- **APIs**: `/api/grading/*`, `/api/exams/*`, `/api/courses/*`, `/api/analytics/*`, `/api/export/*`
- **Storage**: `data/submissions/`, `data/rubrics/`
- **Status**: Preserved existing implementation.

### Product 2: Classroom Activity
- **Access URL**: `/classroom` (Portal), `/classroom/join` (Live Join), `/classroom/login`, `/classroom/register`
- **Database**: `MONGODB_CLASSROOM_URI` (`connectClassroomDB()`)
- **User Management**:
  - `src/models/ClassroomUser.ts`: Dedicated instructor/host accounts.
  - `src/models/ClassroomParticipant.ts`: Lightweight student identities with session PIN join tokens.
- **Authentication**:
  - Independent JWT tokens via `src/lib/classroomAuth.ts` (`classroom_token` cookie or `x-classroom-token` header).
  - Independent endpoints: `/api/classroom/auth/register`, `/api/classroom/auth/login`, `/api/classroom/auth/me`, `/api/classroom/auth/logout`.
- **APIs**: `/api/classroom/*` (sessions, questions, submissions, review, stream, image).
- **Storage**: `data/classroom-uploads/` via `ClassroomStorageService.ts`.

### Product 3: Personalised Learning
- **Access URL**: `/personalized` (Portal), `/personalized/login`, `/personalized/register`, `/student/personalized` (Daily Practice), `/professor/personalized` (Taxonomy & Question Bank)
- **Database**: `MONGODB_PERSONALIZED_URI` (`connectPersonalizedDB()`)
- **User Management**:
  - `src/models/PersonalizedUser.ts`: Dedicated learner and professor accounts with skill level and target topics.
- **Authentication**:
  - Independent JWT tokens via `src/lib/personalizedAuth.ts` (`personalized_token` cookie or `x-personalized-token` header).
  - Independent endpoints: `/api/personalized/auth/register`, `/api/personalized/auth/login`, `/api/personalized/auth/me`, `/api/personalized/auth/logout`.
- **APIs**: `/api/personalized/*` (today, submit, schedules, questions, syllabus, taxonomy).
- **Storage**: `data/personalized-uploads/` or Google Cloud Storage via `CloudStorageService.ts`.

---

## 3. Independent Deployment Guide

Each product can run as an independent microservice container with its own database, process memory, and port:

```bash
# Run all three independent products simultaneously
docker-compose -f docker-compose.products.yml up -d
```

| Product | Host Port | Database Container | Env Configuration |
|---|---|---|---|
| **Assignment Evaluation** | 3000 | `mongo-assignment:27017` | `deploy/assignment/.env.example` |
| **Classroom Activity** | 3001 | `mongo-classroom:27017` | `deploy/classroom/.env.example` |
| **Personalised Learning** | 3002 | `mongo-personalized:27017` | `deploy/personalized/.env.example` |
