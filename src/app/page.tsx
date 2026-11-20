import React from 'react';
import Link from 'next/link';
import {
  ClipboardCheck,
  Monitor,
  Brain,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Users,
  GraduationCap,
  BookOpen,
  QrCode,
  FileText,
  BarChart3,
  Layers,
} from 'lucide-react';
import { UnifiedPlatformNav } from '@/components/navigation/UnifiedPlatformNav';

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col justify-between font-sans antialiased selection:bg-zinc-800 selection:text-white">
      {/* Platform Navigation */}
      <UnifiedPlatformNav />

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
        {/* Hero Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-blue-950/70 text-blue-300 border border-blue-800/60 mb-5 shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>Academic Learning &amp; Assessment Environment</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
            Integrated{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-teal-300">
              E-Learning Platform
            </span>
          </h1>

          <p className="mt-4 text-base sm:text-lg text-zinc-400 leading-relaxed max-w-2xl mx-auto">
            A unified environment connecting examination evaluation, interactive classroom engagement, and personalised practice for students, teaching assistants, and faculty.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>Sign In to Portal</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/classroom/join"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/80 transition-colors"
            >
              <QrCode className="w-4 h-4 text-teal-400" />
              <span>Join Live Session</span>
            </Link>
          </div>
        </div>

        {/* 3 Core Product Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {/* Product 1: Assignment Evaluation */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-6 flex flex-col justify-between hover:border-blue-500/50 hover:bg-zinc-900/40 transition-all duration-200 shadow-sm">
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="h-11 w-11 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <ClipboardCheck className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-950 text-blue-300 border border-blue-800/60">
                  Assessment
                </span>
              </div>

              <h2 className="text-xl font-bold text-white mb-2">Assignment Evaluation</h2>
              <p className="text-sm text-zinc-400 leading-relaxed mb-5">
                Digitized exam processing, rubric-based canvas grading, TA allocation, regrading, and comprehensive analytics.
              </p>

              <ul className="space-y-2 text-xs text-zinc-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>Rubric-based canvas grading &amp; annotations</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>Automated TA allocation &amp; progress tracking</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>Regrade requests &amp; verified result publishing</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>Classroom-wide performance analytics</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-zinc-800/80">
              <Link
                href="/login"
                className="inline-flex items-center justify-center w-full gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                <span>Access Evaluation</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Product 2: Classroom Activity */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-6 flex flex-col justify-between hover:border-teal-500/50 hover:bg-zinc-900/40 transition-all duration-200 shadow-sm">
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="h-11 w-11 rounded-xl bg-teal-600/20 border border-teal-500/30 flex items-center justify-center text-teal-400">
                  <Monitor className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-teal-950 text-teal-300 border border-teal-800/60">
                  Live Classroom
                </span>
              </div>

              <h2 className="text-xl font-bold text-white mb-2">Classroom Activity</h2>
              <p className="text-sm text-zinc-400 leading-relaxed mb-5">
                Real-time lecture engagement, live polls, word clouds, handwritten answer photo uploads, and student feedback.
              </p>

              <ul className="space-y-2 text-xs text-zinc-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                  <span>Instant join via 6-digit PIN or QR code</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                  <span>Live audience polls, MCQs &amp; word clouds</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                  <span>Handwritten script photo upload &amp; OCR</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                  <span>Real-time response aggregation &amp; reveal</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-zinc-800/80">
              <Link
                href="/classroom"
                className="inline-flex items-center justify-center w-full gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-teal-600 text-white hover:bg-teal-500 transition-colors"
              >
                <span>Launch Classroom</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Product 3: Personalised Learning */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-6 flex flex-col justify-between hover:border-purple-500/50 hover:bg-zinc-900/40 transition-all duration-200 shadow-sm">
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="h-11 w-11 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Brain className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-purple-950 text-purple-300 border border-purple-800/60">
                  Self-Paced
                </span>
              </div>

              <h2 className="text-xl font-bold text-white mb-2">Personalised Learning</h2>
              <p className="text-sm text-zinc-400 leading-relaxed mb-5">
                Curriculum-aligned practice questions, adaptive learning paths, concept mastery tracking, and targeted feedback.
              </p>

              <ul className="space-y-2 text-xs text-zinc-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>Syllabus taxonomy trees &amp; topic hierarchies</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>Adaptive daily practice &amp; recommendations</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>Curated question banks across skill categories</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>Detailed explanations, hints &amp; mastery tracking</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-zinc-800/80">
              <Link
                href="/personalized"
                className="inline-flex items-center justify-center w-full gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-purple-600 text-white hover:bg-purple-500 transition-colors"
              >
                <span>Start Practice</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>

        {/* Role-Based Navigation Section */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 sm:p-8">
          <div className="text-center max-w-xl mx-auto mb-8">
            <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Tailored for Every Academic Role
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-zinc-400">
              Direct access to dedicated workflows designed for students, teaching staff, and course instructors.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Student Pathway */}
            <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2.5 mb-3 text-blue-400 font-semibold text-sm">
                  <GraduationCap className="w-4 h-4" />
                  <span>Students</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                  Participate in live classroom sessions, review evaluated submissions with instructor feedback, and practice adaptive questions.
                </p>
              </div>
              <Link
                href="/student"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
              >
                <span>Go to Student Portal</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* TA Pathway */}
            <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2.5 mb-3 text-teal-400 font-semibold text-sm">
                  <Users className="w-4 h-4" />
                  <span>Teaching Assistants</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                  Evaluate allocated answer sheets on an interactive canvas, apply rubrics with consistent score steps, and process regrade requests.
                </p>
              </div>
              <Link
                href="/ta"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-400 hover:text-teal-300 transition-colors"
              >
                <span>Go to TA Grading Queue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* Professor Pathway */}
            <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2.5 mb-3 text-purple-400 font-semibold text-sm">
                  <BarChart3 className="w-4 h-4" />
                  <span>Faculty &amp; Instructors</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                  Manage exams, allocate grading quotas, monitor real-time evaluation progress, conduct live lectures, and manage syllabus question banks.
                </p>
              </div>
              <Link
                href="/professor"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-400 hover:text-purple-300 transition-colors"
              >
                <span>Go to Faculty Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-6 text-center text-xs text-zinc-400">
        <p>
          Center for Visual Information Technology (CVIT) &middot; IIIT Hyderabad
        </p>
        <p className="mt-1 text-zinc-400">
          Integrated E-Learning Platform &middot; Academic Assessment, Classroom Engagement &amp; Adaptive Practice
        </p>
      </footer>
    </div>
  );
}
