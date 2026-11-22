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
  Layers,
  LogIn,
} from 'lucide-react';

export interface UnifiedPlatformNavProps {
  currentUser?: {
    name: string;
    email: string;
    role: 'ADMIN' | 'PROFESSOR' | 'TA' | 'STUDENT';
  } | null;
  courses?: Array<{ code: string; name: string }>;
  currentCourse?: string;
  onCourseChange?: (courseCode: string) => void;
  onLogout?: () => void;
}

export const UnifiedPlatformNav: React.FC<UnifiedPlatformNavProps> = ({
  currentUser,
  courses = [
    { code: 'CS201', name: 'Data Structures & Algorithms' },
    { code: 'CS301', name: 'Computer Vision & Deep Learning' },
  ],
  currentCourse = 'CS201',
  onCourseChange,
  onLogout,
}) => {
  const pathname = usePathname() || '/';

  // Determine active tab across the 3 independent products
  const isEvaluation =
    pathname.startsWith('/exams') ||
    pathname.startsWith('/grading') ||
    pathname.startsWith('/professor') ||
    pathname.startsWith('/ta') ||
    pathname.startsWith('/student') ||
    pathname.startsWith('/admin') ||
    pathname === '/login' ||
    pathname === '/register';

  const isClassroom = pathname.startsWith('/classroom');
  const isPractice = pathname.startsWith('/personalized');

  // Dynamically resolve the primary Evaluation target URL based on active role/path
  const getEvaluationTarget = (): string => {
    if (currentUser?.role === 'STUDENT' || pathname.startsWith('/student')) {
      return '/student';
    }
    if (currentUser?.role === 'TA' || pathname.startsWith('/ta')) {
      return '/ta';
    }
    if (currentUser?.role === 'ADMIN' || pathname.startsWith('/admin')) {
      return '/admin';
    }
    if (currentUser?.role === 'PROFESSOR' || pathname.startsWith('/professor')) {
      return '/professor';
    }
    return currentUser ? '/professor' : '/login';
  };

  const evaluationHref = getEvaluationTarget();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-950/95 backdrop-blur" data-testid="unified-platform-nav">
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

            {/* Course Switcher (when courses provided) */}
            {currentUser && courses.length > 0 && (
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
            )}
          </div>

          {/* Unified Product Tabs */}
          <nav className="flex items-center space-x-1 sm:space-x-2" aria-label="Platform Products Navigation">
            <Link
              href={evaluationHref}
              data-testid="nav-tab-evaluation"
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
              data-testid="nav-tab-classroom"
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
              data-testid="nav-tab-practice"
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

          {/* User Profile or Sign In Link */}
          <div className="flex items-center gap-3">
            {currentUser ? (
              <>
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
              </>
            ) : (
              <Link
                href="/login"
                data-testid="nav-signin-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
