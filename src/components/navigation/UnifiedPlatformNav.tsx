'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ClipboardCheck,
  Monitor,
  Brain,
  GraduationCap,
  LogOut,
  User,
  Layers,
} from 'lucide-react';

export interface UnifiedPlatformNavProps {
  currentUser?: {
    name: string;
    email: string;
    role: 'ADMIN' | 'PROFESSOR' | 'TA' | 'STUDENT';
  };
  courses?: Array<{ code: string; name: string }>;
  currentCourse?: string;
  onCourseChange?: (courseCode: string) => void;
  onLogout?: () => void;
}

export const UnifiedPlatformNav: React.FC<UnifiedPlatformNavProps> = ({
  currentUser = { name: 'Faculty Member', email: 'faculty@iiit.ac.in', role: 'PROFESSOR' },
  courses = [
    { code: 'CS201', name: 'Data Structures & Algorithms' },
    { code: 'CS301', name: 'Computer Vision & Deep Learning' },
  ],
  currentCourse = 'CS201',
  onCourseChange,
  onLogout,
}) => {
  const pathname = usePathname();

  const isEvaluation =
    pathname.startsWith('/exams') ||
    pathname.startsWith('/grading') ||
    pathname.startsWith('/professor') ||
    pathname.startsWith('/ta') ||
    pathname === '/login';

  const isClassroom = pathname.startsWith('/classroom');
  const isPractice = pathname.startsWith('/personalized');

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Platform Brand */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="h-9 w-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:bg-blue-600/30 transition-colors">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-bold text-white tracking-tight">CVIT Learning Platform</span>
                <span className="block text-[11px] text-zinc-400 leading-none">IIIT Hyderabad</span>
              </div>
            </Link>

            {/* Course Switcher */}
            <div className="hidden md:flex items-center ml-4 pl-4 border-l border-zinc-800">
              <Layers className="w-4 h-4 text-zinc-400 mr-2" />
              <select
                value={currentCourse}
                onChange={(e) => onCourseChange?.(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {courses.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} - {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Unified Product Tabs */}
          <nav className="flex items-center space-x-1 sm:space-x-2">
            <Link
              href="/professor"
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                isEvaluation
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <ClipboardCheck className="w-4 h-4 text-blue-400" />
              <span>Evaluation</span>
            </Link>

            <Link
              href="/classroom"
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                isClassroom
                  ? 'bg-teal-600/20 text-teal-300 border border-teal-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <Monitor className="w-4 h-4 text-teal-400" />
              <span>Classroom</span>
            </Link>

            <Link
              href="/personalized"
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                isPractice
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <Brain className="w-4 h-4 text-purple-400" />
              <span>Practice</span>
            </Link>
          </nav>

          {/* User Profile & Role Indicator */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-semibold text-zinc-200">{currentUser.name}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                {currentUser.role}
              </span>
            </div>

            <button
              onClick={onLogout}
              className="p-2 rounded-xl text-zinc-400 hover:text-rose-400 hover:bg-zinc-900 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
