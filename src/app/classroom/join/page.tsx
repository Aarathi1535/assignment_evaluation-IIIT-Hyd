'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowRight } from 'lucide-react';

export default function ClassroomJoinPage() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    router.push(`/classroom/session/${joinCode.trim().toUpperCase()}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center px-4 py-8">
      <div className="max-w-md w-full mx-auto bg-slate-900 border-2 border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-600/20 text-blue-400 mb-3 border-2 border-blue-500/40">
            <Sparkles className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Join Classroom Activity</h1>
          <p className="text-sm text-slate-300 mt-1">Enter the 6-character code displayed on the screen</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-200 mb-1.5">
              Classroom Code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="e.g. B7K9X2"
              className="w-full px-4 py-3 bg-slate-950 border-2 border-slate-600 rounded-xl text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-400 font-mono text-center tracking-widest text-3xl font-black uppercase"
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={joinCode.trim().length < 3}
            className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer text-base"
          >
            <span>Proceed to Session</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-slate-400 font-medium">
          IIIT Hyderabad &bull; Classroom Assessment Platform
        </div>
      </div>
    </div>
  );
}

