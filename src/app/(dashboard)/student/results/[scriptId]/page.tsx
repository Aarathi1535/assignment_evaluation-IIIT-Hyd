'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { ReadOnlyScriptViewer } from '@/components/student/ReadOnlyScriptViewer';

export default function StudentScriptViewerPage() {
  const params = useParams();
  const scriptId = (params?.scriptId as string) || '';

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-7xl mx-auto w-full">
      {/* Top Header / Breadcrumb navigation */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <Link
            href="/student/results"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-xs"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-slate-500" />
            <span>Back to My Results</span>
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2 text-slate-800">
            <BookOpen className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold tracking-tight">Graded Answer Sheet</h1>
          </div>
        </div>
      </div>

      {/* Embedded Read-Only Script Viewer */}
      <ReadOnlyScriptViewer scriptId={scriptId} />
    </div>
  );
}
