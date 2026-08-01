'use client';

import React from 'react';
import Link from 'next/link';
import { BookOpen, FileText, Users, Clock, Plus, FolderOpen } from 'lucide-react';

export default function ProfessorDashboardPage() {
  const stats = [
    {
      title: 'Total Courses',
      value: '0',
      icon: BookOpen,
      color: 'from-blue-500/10 to-indigo-500/10 text-blue-600 dark:text-blue-400',
      borderColor: 'border-blue-100 dark:border-blue-900/50',
      iconBg: 'bg-blue-500/20',
    },
    {
      title: 'Total Exams',
      value: '0',
      icon: FileText,
      color: 'from-purple-500/10 to-pink-500/10 text-purple-600 dark:text-purple-400',
      borderColor: 'border-purple-100 dark:border-purple-900/50',
      iconBg: 'bg-purple-500/20',
    },
    {
      title: 'Students',
      value: '0',
      icon: Users,
      color: 'from-emerald-500/10 to-teal-500/10 text-emerald-600 dark:text-emerald-400',
      borderColor: 'border-emerald-100 dark:border-emerald-900/50',
      iconBg: 'bg-emerald-500/20',
    },
    {
      title: 'Pending Evaluations',
      value: '0',
      icon: Clock,
      color: 'from-amber-500/10 to-orange-500/10 text-amber-600 dark:text-amber-400',
      borderColor: 'border-amber-100 dark:border-amber-900/50',
      iconBg: 'bg-amber-500/20',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-900/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col gap-2 md:flex-row md:justify-between md:items-center">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              Professor Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Overview of your active courses, upcoming exams, and pending grading assessments.
            </p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div
                key={idx}
                className={`relative overflow-hidden rounded-2xl border ${stat.borderColor} bg-gradient-to-br ${stat.color} p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <p className="text-sm font-medium opacity-80 uppercase tracking-wider">{stat.title}</p>
                    <p className="text-3xl font-bold tracking-tight">{stat.value}</p>
                  </div>
                  <div className={`p-3 rounded-xl ${stat.iconBg}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Actions */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/80 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-4">
            <Link href="/professor/courses/create" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-505 hover:bg-indigo-500 text-white font-medium shadow-sm transition-all hover:scale-[1.02] hover:shadow-indigo-500/10 cursor-pointer">
              <Plus className="h-5 w-5" />
              <span>Create Course</span>
            </Link>
            <button className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-505 hover:bg-emerald-500 text-white font-medium shadow-sm transition-all hover:scale-[1.02] hover:shadow-emerald-500/10 cursor-pointer">
              <Plus className="h-5 w-5" />
              <span>Create Exam</span>
            </button>
          </div>
        </div>

        {/* Empty Sections Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Courses */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Recent Courses</h2>
            </div>
            <div className="border-2 border-dashed border-slate-200 dark:border-slate-700/80 rounded-2xl p-8 text-center bg-white/50 dark:bg-slate-800/30">
              <FolderOpen className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-600 mb-3" />
              <p className="text-base font-semibold text-slate-900 dark:text-white">No courses created yet</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Get started by creating your first course.</p>
            </div>
          </div>

          {/* Recent Exams */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Recent Exams</h2>
            </div>
            <div className="border-2 border-dashed border-slate-200 dark:border-slate-700/80 rounded-2xl p-8 text-center bg-white/50 dark:bg-slate-800/30">
              <FileText className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-600 mb-3" />
              <p className="text-base font-semibold text-slate-900 dark:text-white">No exams created yet</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Design your first assignment or exam once you have a course.</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
