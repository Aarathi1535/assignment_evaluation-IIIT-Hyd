'use client';

import React from 'react';
import Link from 'next/link';
import { Brain, ArrowLeft, ShieldAlert, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function PersonalizedRegisterPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col justify-center px-4 py-8">
      <div className="max-w-md w-full mx-auto space-y-6">
        <Link
          href="/personalized"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Personalised Learning Portal</span>
        </Link>

        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl space-y-6 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 mx-auto">
            <ShieldAlert className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Access by Request Only</h1>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Open self-registration for Personalised Learning is disabled. Access is granted to professors by the administrator upon request. Students gain access via their assigned course section.
            </p>
          </div>

          <div className="p-4 bg-neutral-850 rounded-2xl border border-neutral-800 text-left space-y-2">
            <div className="text-xs font-semibold text-neutral-300">How to access:</div>
            <ul className="text-2xs text-neutral-400 space-y-1 list-disc list-inside">
              <li>Professors: Sign in using institutional credentials, or submit an access request to the admin.</li>
              <li>Students: Your professor will assign course sections to enable daily adaptive learning.</li>
            </ul>
          </div>

          <Link href="/personalized/login" className="block">
            <Button className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2">
              <LogIn className="w-4 h-4" />
              <span>Go to Personalized Login</span>
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
