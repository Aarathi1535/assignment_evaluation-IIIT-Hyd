'use client';

import React from 'react';
import Link from 'next/link';
import { Brain, Sparkles, BookOpen, LogIn, UserPlus, ArrowRight, ArrowLeft } from 'lucide-react';

export default function PersonalizedPortalPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col justify-between p-6 sm:p-12">
      <header className="max-w-4xl mx-auto w-full flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Unified Platform Hub</span>
        </Link>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-950 text-purple-400 border border-purple-800">
          Product 3 &bull; Personalised Learning
        </span>
      </header>

      <main className="max-w-xl mx-auto w-full my-8 space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-inner">
            <Brain className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Personalised Learning</h1>
          <p className="text-neutral-400 text-sm">
            AI-driven adaptive question generation, daily 3-question mastery cycles, and syllabus-aligned learning paths.
          </p>
        </div>

        {/* Action cards */}
        <div className="space-y-4">
          <Link
            href="/student/personalized"
            className="block p-5 bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 hover:border-purple-600/50 rounded-2xl transition shadow-xl group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white group-hover:text-purple-300 transition-colors">
                    Daily 3-Question Challenge
                  </h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Practice your personalized questions for today and track topic mastery
                  </p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-neutral-500 group-hover:text-purple-400 transition-colors" />
            </div>
          </Link>

          <Link
            href="/professor/personalized"
            className="block p-5 bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 hover:border-purple-600/50 rounded-2xl transition shadow-xl group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white group-hover:text-indigo-300 transition-colors">
                    Professor Question Bank &amp; Taxonomy
                  </h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Generate AI questions, import question sets, and organize course syllabus
                  </p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-neutral-500 group-hover:text-indigo-400 transition-colors" />
            </div>
          </Link>
        </div>

        {/* Independent Auth for Personalized Learning */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/personalized/login"
            className="flex items-center justify-center gap-2 py-3 px-4 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 rounded-xl text-white font-medium text-sm transition"
          >
            <LogIn className="w-4 h-4 text-purple-400" />
            <span>Personalized Login</span>
          </Link>
          <Link
            href="/personalized/register"
            className="flex items-center justify-center gap-2 py-3 px-4 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 rounded-xl text-white font-medium text-sm transition"
          >
            <UserPlus className="w-4 h-4 text-purple-400" />
            <span>Register Account</span>
          </Link>
        </div>
      </main>

      <footer className="text-center text-xs text-neutral-500">
        Personalised Learning Product &bull; Independent User Profiles &amp; Adaptive AI Engine
      </footer>
    </div>
  );
}
