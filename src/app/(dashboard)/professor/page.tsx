'use client';

import React from 'react';
import Link from 'next/link';
import { BookOpen, FileText, Users, Clock, Plus, FolderOpen } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export default function ProfessorDashboardPage() {
  const stats = [
    {
      title: 'Total Courses',
      value: '0',
      icon: BookOpen,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Total Exams',
      value: '0',
      icon: FileText,
      color: 'text-purple-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-purple-50 text-purple-600',
    },
    {
      title: 'Students',
      value: '0',
      icon: Users,
      color: 'text-emerald-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Pending Evaluations',
      value: '0',
      icon: Clock,
      color: 'text-amber-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-amber-50 text-amber-600',
    },
  ];

  const quickActions = (
    <>
      <Link href="/professor/courses/create">
        <Button variant="primary" size="md">
          <Plus className="h-4 w-4" />
          <span>Create Course</span>
        </Button>
      </Link>
      <Button variant="secondary" size="md">
        <Plus className="h-4 w-4" />
        <span>Create Exam</span>
      </Button>
    </>
  );

  return (
    <DashboardLayout
      title="Professor Dashboard"
      description="Overview of your active courses, upcoming exams, and pending grading assessments."
      stats={stats}
      quickActions={quickActions}
    >
      {/* Empty Sections Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Courses */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-slate-900">Recent Courses</h2>
          <EmptyState
            title="No courses created yet"
            description="Get started by creating your first course."
            icon={FolderOpen}
          />
        </div>

        {/* Recent Exams */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-slate-900">Recent Exams</h2>
          <EmptyState
            title="No exams created yet"
            description="Design your first assignment or exam once you have a course."
            icon={FileText}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
