# Manual TA Grading and Assignment Management System
### Next.js Full Stack Implementation

A scalable full-stack **Manual TA Grading and Assignment Management System** built with **Next.js**, **TypeScript**, and **MongoDB**. This platform streamlines course administration, exam coordination, manual grading by Teaching Assistants (TAs), student submissions, regrade requests, and audit logging.

---

## 🚀 Project Goals

- Establish a production-ready manual grading workflow for university environments.
- Build a scalable layered architecture separating UI, services, and database concerns.
- Support comprehensive manual grading capabilities including page-level script navigation, TA allocations, and annotations.
- Provide a robust role-based access control (RBAC) security model for Professors, TAs, Students, and Administrators.

---

## 🏗 Architecture & Workflow

The platform defines a clean, manual grading pipeline:

```
Professor Creates Course/Exam 
        │
Professor Creates Rubric 
        │
Student Uploads AnswerScript 
        │
AnswerScript Pages Extracted 
        │
Professor Allocates Scripts to TAs 
        │
TAs Add Annotations & Comments 
        │
TAs Grade Script & Criteria 
        │
Student Views Grade 
        │
Student Submits Regrade Request 
        │
Audit Log Records All Grading Activity
```

### Layered Architecture Structure:
```
Frontend (Next.js + React)
        │
API Routes / Server Actions
        │
Service Layer
        │
Repository Layer
        │
MongoDB (Mongoose)
```

---

## 📁 Project Structure

```
├── middleware.ts            # Next.js authentication & RBAC middleware
├── package.json             # Node dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── src/
│   ├── app/                 # Next.js App Router (pages, dashboards, API routes)
│   │   ├── (auth)/          # Authentication pages (login, register)
│   │   ├── (dashboard)/     # Dashboards (admin, professor, ta, student)
│   │   ├── api/             # Backend API routes
│   │   ├── globals.css      # CSS styling with Tailwind CSS v4 design tokens
│   │   └── layout.tsx       # Root layout
│   ├── components/          # Reusable React components
│   ├── config/              # Centralized environment configuration using Zod
│   ├── constants/           # Centralized RBAC permissions registry
│   ├── lib/                 # Core utilities (database connection, NextAuth options)
│   ├── models/              # Mongoose database models
│   ├── repositories/        # Database abstraction layer
│   ├── scripts/             # Database seeding and utility scripts
│   ├── services/            # Main business logic layer
│   ├── types/               # Custom TypeScript definitions
│   └── validations/         # Zod schemas for user input validations
```

---

## 🛠 Technology Stack

### Frontend & Styling
- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS v4
- React Hook Form
- Zod

### Backend & Database
- Next.js Route Handlers
- MongoDB Atlas (Cloud Database)
- Mongoose (ODM)

### Authentication & Authorization
- NextAuth (JWT-based session management)
- Role-Based Access Control (RBAC) permissions

---

## 👥 User Roles & Permissions

The system enforces strict Role-Based Access Control (RBAC) via middleware:
- **Administrator**: Complete system and user management access.
- **Professor**: Manages courses, exams, rubrics, publishes results, and allocates answer scripts to TAs.
- **Teaching Assistant (TA)**: Views assigned courses, views only assigned scripts, grades scripts, and flags submissions for review.
- **Student**: Uploads answer scripts, views graded results, and submits regrade requests.

---

## 📚 Features Roadmap

### ✅ Week 1 (Completed)
- Scalable full-stack architecture setup.
- Mongoose integration and database models (User, Course, Exam, Rubric).
- Strong environment validation using Zod.
- Centralized RBAC permissions registry and hasPermission module.
- Secure NextAuth JWT Authentication implementation.
- Refactored edge-compatible middleware with permission-based routing guards.

### ✅ Week 2 (Completed / In Progress)
- Course creation and dashboard management interfaces.
- Custom Tailwind v4 design tokens system setup.
- Manual TA grading domain models implemented:
  - `AnswerScript` (student submissions with unique constraints)
  - `Page` (extracted script pages)
  - `StudentMapping` (anonymous scanner mappings)
  - `Allocation` (script assignments for TAs)
  - `Annotation` (drawing position coordinate comments)
  - `Grade` (criterion-level marks and overall score)
  - `RegradeRequest` (student regrade workflow)
  - `AuditLog` (grading activity logs)

---

## ⚙ Environment Variables

Configure a `.env.local` file in the root folder with the following variables:

```env
MONGODB_URI=your_mongodb_connection_string
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=http://localhost:3000
```

---

## ▶ Running the Project

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run database seeding**:
   ```bash
   npm run seed
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Run unit tests**:
   ```bash
   npm run test
   ```

---

## 📄 License

This project is developed as part of the IIIT Hyderabad Assignment Evaluation research project.
