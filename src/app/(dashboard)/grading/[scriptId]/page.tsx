'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';

export default function WholeScriptGradingPagePlaceholder() {
  const params = useParams();
  const scriptId = params.scriptId as string;

  return (
    <DashboardLayout
      title="Grading Portal"
      description="Evaluate and grade full exam script submissions."
    >
      <div className="bg-white border border-slate-200 rounded-brand-lg p-6 max-w-2xl mx-auto space-y-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="h-10 w-10 rounded-full bg-blue-50 text-blue-650 flex items-center justify-center font-bold">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Grading Portal Placeholder</h2>
            <p className="text-xs text-slate-500">Evaluating Whole-Script Allocation</p>
          </div>
        </div>

        <div className="space-y-3 bg-slate-50 p-4 rounded-brand border border-slate-200/60 text-sm">
          <p className="flex justify-between">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-2xs">Answer Script ID:</span>
            <span className="font-semibold text-slate-900 font-mono">{scriptId}</span>
          </p>
          <p className="flex justify-between">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-2xs">Assigned Question:</span>
            <span className="font-bold text-slate-900">Whole Script (All Questions)</span>
          </p>
        </div>

        <div className="text-slate-650 text-sm leading-relaxed space-y-2">
          <p>This is a minimal placeholder route matching the routing requirements of <strong>AE-095</strong>.</p>
          <p className="text-slate-500 text-xs italic">Note: The interactive evaluation grading workspace, scan viewport, rubrics selector, and grading controls will be implemented in a subsequent milestone ticket.</p>
        </div>

        <div className="border-t border-slate-100 pt-4 flex justify-start">
          <Link href="/ta" passHref legacyBehavior>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              <span>Back to Work Queue</span>
            </Button>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}
