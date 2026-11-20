import React from 'react';
import Link from 'next/link';
import { ClipboardCheck, Monitor, Brain, ArrowRight, ShieldCheck, Sparkles, Cpu } from 'lucide-react';
import { UnifiedPlatformNav } from '@/components/navigation/UnifiedPlatformNav';

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col justify-between font-sans antialiased selection:bg-zinc-800 selection:text-white">
      {/* Platform Navigation */}
      <UnifiedPlatformNav />

      {/* Main Content Area */}
      <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        {/* Hero Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-950/60 text-blue-400 border border-blue-800/60 mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Architecture Plan v2 &middot; CVIT Integrated Platform</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
            CVIT Integrated <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-teal-300 to-purple-400">E-Learning Platform</span>
          </h1>

          <p className="mt-4 text-base sm:text-lg text-zinc-400 leading-relaxed">
            IIIT Hyderabad Center for Visual Information Technology (CVIT) &middot; Prof. C.V. Jawahar.
            One unified experience connecting three independent headless services: Assignment Evaluation, Classroom Activity, and Personalised Practice.
          </p>
        </div>

        {/* 3 Core Product Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Product 1: Assignment Evaluation */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 flex flex-col justify-between hover:border-blue-500/50 hover:bg-zinc-900/40 transition-all duration-200">
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="h-11 w-11 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <ClipboardCheck className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-950 text-blue-300 border border-blue-800/60">
                  Product 1
                </span>
              </div>

              <h2 className="text-xl font-bold text-white mb-2">Assignment Evaluation</h2>
              <p className="text-sm text-zinc-400 leading-relaxed mb-4">
                Exam ingestion, multi-page splitting, rubric-driven canvas grading, TA allocations, regrading, and comprehensive analytics.
              </p>

              <div className="space-y-1.5 text-xs text-zinc-300">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Headless REST API: /api/v1/evaluation</span>
                </div>
                <div className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span>Dedicated DB: MONGODB_URI</span>
                </div>
              </div>
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
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 flex flex-col justify-between hover:border-teal-500/50 hover:bg-zinc-900/40 transition-all duration-200">
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="h-11 w-11 rounded-xl bg-teal-600/20 border border-teal-500/30 flex items-center justify-center text-teal-400">
                  <Monitor className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-teal-950 text-teal-300 border border-teal-800/60">
                  Product 2
                </span>
              </div>

              <h2 className="text-xl font-bold text-white mb-2">Classroom Activity</h2>
              <p className="text-sm text-zinc-400 leading-relaxed mb-4">
                6-digit PIN and QR mobile join, real-time Mentimeter-style polls, handwritten script photo uploads, OCR extraction, and staff review.
              </p>

              <div className="space-y-1.5 text-xs text-zinc-300">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Headless REST API: /api/v1/classroom</span>
                </div>
                <div className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-teal-400" />
                  <span>Dedicated DB: MONGODB_CLASSROOM_URI</span>
                </div>
              </div>
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
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 flex flex-col justify-between hover:border-purple-500/50 hover:bg-zinc-900/40 transition-all duration-200">
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="h-11 w-11 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Brain className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-purple-950 text-purple-300 border border-purple-800/60">
                  Product 3
                </span>
              </div>

              <h2 className="text-xl font-bold text-white mb-2">Personalised Learning</h2>
              <p className="text-sm text-zinc-400 leading-relaxed mb-4">
                Syllabus taxonomy trees, curated question banks, daily 3-question adaptive practice, concept mastery, and model-agnostic AI generation.
              </p>

              <div className="space-y-1.5 text-xs text-zinc-300">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Headless REST API: /api/v1/practice</span>
                </div>
                <div className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-purple-400" />
                  <span>Dedicated DB: MONGODB_PERSONALIZED_URI</span>
                </div>
              </div>
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
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-6 text-center text-xs text-zinc-500">
        <p>
          IIIT Hyderabad &middot; Center for Visual Information Technology &middot; Architecture Plan v2 (2026)
        </p>
        <p className="mt-1">
          Independent Headless Services &middot; Asymmetric RS256 Auth &middot; Isolated Databases &middot; LTI 1.3 Advantage
        </p>
      </footer>
    </div>
  );
}
