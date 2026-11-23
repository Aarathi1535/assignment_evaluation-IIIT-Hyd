'use client';

import React from 'react';
import Link from 'next/link';
import { MonitorPlay, ArrowLeft, ShieldAlert, LogIn } from 'lucide-react';

export default function ClassroomRegisterPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col justify-center px-4 py-8">
      <div className="max-w-md w-full mx-auto space-y-6">
        <Link
          href="/classroom"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Classroom Portal</span>
        </Link>

        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl space-y-6 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 mx-auto">
            <ShieldAlert className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Access by Request Only</h1>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Open registration for Classroom Activity is disabled. Access is granted to professors by the administrator upon request.
            </p>
          </div>

          <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl text-xs text-neutral-400 text-left space-y-2">
            <p className="font-semibold text-neutral-300">How to get access:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Log in with your existing professor credentials.</li>
              <li>If you don&apos;t have access yet, click &quot;Request Access&quot;.</li>
              <li>Once the administrator grants access, you will be able to launch live sessions.</li>
            </ol>
          </div>

          <Link
            href="/classroom/login"
            className="w-full py-3.5 px-4 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Proceed to Classroom Login</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
