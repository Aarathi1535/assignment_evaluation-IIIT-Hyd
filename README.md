# Assignment Evaluation Platform
### Next.js Full Stack Implementation (Based on SMAI AI Evaluator POC)

A scalable full-stack Assignment Evaluation Platform built with **Next.js**, **TypeScript**, and **MongoDB**. This project is a migration of the original Python/FastAPI proof-of-concept into a production-ready architecture with a modern web interface.

The platform is designed to support AI-powered assignment evaluation, course management, exam management, rubric-based grading, and future integrations with Tango, Vertex AI (Gemini), and DeepSeek.

---

## 🚀 Project Goals

- Migrate the FastAPI proof-of-concept into a modern Next.js full-stack application.
- Build a scalable layered architecture.
- Support AI-assisted assignment evaluation.
- Provide role-based access for Professors, Teaching Assistants, Students, and Administrators.
- Enable future deployment as a production SaaS platform.

---

# 🏗 Architecture

The project follows a layered architecture.

```
Frontend (Next.js + React)

        │

API Routes

        │

Service Layer

        │

Repository Layer

        │

MongoDB (Mongoose)
```

Business logic is isolated from API routes to keep the codebase modular and maintainable.

---

# 📁 Project Structure

```
src/

├── app/
│   ├── api/
│   ├── (dashboard)/
│   └── (auth)/
│
├── components/
│
├── config/
│
├── lib/
│
├── middleware/
│
├── models/
│
├── repositories/
│
├── services/
│
├── validations/
│
└── types/
```

---

# 🛠 Technology Stack

## Frontend

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- React Hook Form
- Zod
- Lucide Icons

## Backend

- Next.js Route Handlers
- MongoDB Atlas
- Mongoose

## Authentication

- NextAuth (Planned)
- JWT
- RBAC Middleware

## AI Integration (Planned)

- Google Vertex AI (Gemini)
- DeepSeek
- Tango Evaluation Pipeline

---

# 👥 User Roles

- Administrator
- Professor
- Teaching Assistant (TA)
- Student

Role-Based Access Control (RBAC) is implemented to restrict access based on permissions.

---

# 📚 Current Features

## ✅ Week 1

- Project Architecture
- Folder Structure
- MongoDB Integration
- Environment Configuration
- User Model
- Course Model
- Exam Model
- Repository Pattern
- Service Layer
- RBAC Foundation

## 🚧 Week 2 (In Progress)

### Course Module

- Create Course
- View Courses
- MongoDB Integration
- Course Validation
- Course Repository
- Course Services

### Dashboard

- Professor Dashboard
- Statistics Cards
- Quick Actions
- Course Creation Interface

---

# 🔄 Planned Features

- Authentication (NextAuth)
- Course Management
- Exam Management
- Student Management
- Assignment Upload
- OCR Processing
- AI Evaluation Pipeline
- Manual Review Workflow
- Result Publishing
- Analytics Dashboard
- Notification System

---

# ⚙ Environment Variables

Create a `.env.local` file.

```env
MONGODB_URI=your_mongodb_connection_string

NEXTAUTH_SECRET=your_nextauth_secret

JWT_SECRET=your_jwt_secret
```

---

# ▶ Running the Project

Install dependencies

```bash
npm install
```

Start development server

```bash
npm run dev
```

Open

```
http://localhost:3000
```

---

# 📖 Development Principles

- Layered Architecture
- Repository Pattern
- Service Pattern
- Separation of Concerns
- Type Safety
- Input Validation
- Scalable Folder Structure
- Production Ready Codebase

---

# 🗺 Development Roadmap

## Week 1

- Project Foundation
- Database Models
- Architecture
- MongoDB Integration

## Week 2

- Course Management
- Dashboard
- CRUD Operations

## Week 3+

- Authentication
- Exam Module
- Assignment Upload
- AI Evaluation
- Analytics
- Deployment

---

# 📄 License

This project is developed as part of the IIIT Hyderabad Assignment Evaluation research project.
