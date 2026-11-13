'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MonitorPlay, Users, LogIn, UserPlus, ArrowRight, ArrowLeft } from 'lucide-react';

export default function ClassroomPortalPage() {
  const router = useRouter();
  const [code, setCode] = useState('');

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    router.push(`/classroom/session/${code.trim().toUpperCase()}`);
  };

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
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-teal-950 text-teal-400 border border-teal-800">
          Product 2 &bull; Classroom Activity
        </span>
      </header>

      <main className="max-w-xl mx-auto w-full my-8 space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-500/10 text-teal-400 border border-teal-500/20 shadow-inner">
            <MonitorPlay className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Classroom Activity</h1>
          <p className="text-neutral-400 text-sm">
            Live interactive classroom sessions with instant handwritten uploads and AI verification.
          </p>
        </div>

        {/* Quick Join for Students */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-2 text-teal-400 font-bold text-sm">
            <Users className="w-4 h-4" />
            <span>Join Live Session (No account needed)</span>
          </div>
          <form onSubmit={handleJoin} className="space-y-3">
            <input
              type="text"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ENTER 6-DIGIT CODE"
              className="w-full text-center font-mono text-2xl tracking-widest font-black py-3 px-4 bg-neutral-950 border border-neutral-700 rounded-xl text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500 uppercase"
            />
            <button
              type="submit"
              disabled={code.trim().length < 3}
              className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-lg"
            >
              <span>Join Session</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Independent Auth for Instructors / Account Holders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/classroom/login"
            className="flex items-center justify-center gap-2 py-3 px-4 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 rounded-xl text-white font-medium text-sm transition"
          >
            <LogIn className="w-4 h-4 text-teal-400" />
            <span>Classroom Login</span>
          </Link>
          <Link
            href="/classroom/register"
            className="flex items-center justify-center gap-2 py-3 px-4 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 rounded-xl text-white font-medium text-sm transition"
          >
            <UserPlus className="w-4 h-4 text-teal-400" />
            <span>Register Account</span>
          </Link>
        </div>
      </main>

      <footer className="text-center text-xs text-neutral-500">
        Classroom Activity Product &bull; Independent Authentication &amp; Live Session Stream
      </footer>
    </div>
  );
}

