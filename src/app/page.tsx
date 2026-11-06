import React from 'react';
import Link from 'next/link';
import { ClipboardCheck, Monitor, Brain } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col justify-between px-4 py-12 sm:px-6 lg:px-8 font-sans antialiased selection:bg-zinc-800 selection:text-white">
      {/* Top Header */}
      <header className="text-center pt-4 sm:pt-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
          IIIT Hyderabad Learning Platform
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Unified product discovery and entry point
        </p>
      </header>

      {/* Main Product Discovery Section */}
      <main className="max-w-4xl mx-auto w-full my-8 sm:my-12">
        <div className="mb-6">
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Choose the product you want to use
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Each product has its own registration, login, users and workflows.
          </p>
        </div>

        <div className="space-y-4">
          {/* Product 1: Assignment Evaluation */}
          <Link
            href="/login"
            className="block group rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 sm:p-6 transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-900/60 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <ClipboardCheck className="w-6 h-6 text-blue-400 shrink-0" />
                <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-blue-300 transition-colors">
                  Assignment Evaluation
                </h3>
              </div>
              <span className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                Product 1
              </span>
            </div>

            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              Separate registration &middot; Separate login &middot; Separate user database &middot; Existing grading system
            </p>

            <div className="mt-3">
              <span className="text-xs sm:text-sm font-medium text-emerald-400">
                Preserve existing implementation
              </span>
            </div>
          </Link>

          {/* Product 2: Classroom Activity */}
          <Link
            href="/classroom"
            className="block group rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 sm:p-6 transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-900/60 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <Monitor className="w-6 h-6 text-teal-400 shrink-0" />
                <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-teal-300 transition-colors">
                  Classroom Activity
                </h3>
              </div>
              <span className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                Product 2
              </span>
            </div>

            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              Separate registration &middot; Separate login &middot; Separate users &middot; Live classroom sessions
            </p>

            <div className="mt-3">
              <span className="text-xs sm:text-sm font-medium text-emerald-400">
                Develop independently
              </span>
            </div>
          </Link>

          {/* Product 3: Personalised Learning */}
          <Link
            href="/personalized"
            className="block group rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 sm:p-6 transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-900/60 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <Brain className="w-6 h-6 text-purple-400 shrink-0" />
                <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-purple-300 transition-colors">
                  Personalised Learning
                </h3>
              </div>
              <span className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                Product 3
              </span>
            </div>

            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              Separate registration &middot; Separate login &middot; Separate users &middot; Individual learning workflows
            </p>

            <div className="mt-3">
              <span className="text-xs sm:text-sm font-medium text-emerald-400">
                Develop independently
              </span>
            </div>
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center pb-4 sm:pb-8">
        <h4 className="text-sm sm:text-base font-bold text-zinc-200">
          Independent product infrastructure
        </h4>
        <p className="mt-1 text-xs sm:text-sm text-zinc-400">
          Separate databases &middot; Authentication &middot; APIs &middot; Storage &middot; Deployment
        </p>
      </footer>
    </div>
  );
}
