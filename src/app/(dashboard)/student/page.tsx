'use client';

import React from 'react';
import { BookOpen, FileCheck, Award, HelpCircle, Eye, RefreshCw, GraduationCap } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export default function StudentDashboardPage() {
  const stats = [
    {
      title: 'Enrolled Courses',
      value: '0',
      icon: BookOpen,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Submitted Exams',
      value: '0',
      icon: FileCheck,
      color: 'text-purple-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-purple-50 text-purple-600',
    },
    {
      title: 'Average Grade',
      value: 'N/A',
      icon: Award,
      color: 'text-emerald-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Regrade Requests',
      value: '0',
      icon: HelpCircle,
      color: 'text-amber-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-amber-50 text-amber-600',
    },
  ];

  const quickActions = (
    <>
      <Button variant="primary" size="md">
        <Eye className="h-4 w-4" />
        <span>View Grades</span>
      </Button>
      <Button variant="secondary" size="md">
        <RefreshCw className="h-4 w-4" />
        <span>Request Regrade</span>
      </Button>
    </>
  );

  return (
    <DashboardLayout
      title="Student Dashboard"
      description="Track your courses, view assignment grades, and check regrade request status."
      stats={stats}
      quickActions={quickActions}
    >
      {/* Content Sections Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Enrolled Courses */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-slate-900">My Courses</h2>
          <EmptyState
            title="No enrolled courses"
            description="You are not enrolled in any courses yet."
            icon={GraduationCap}
          />
        </div>

        {/* Recent Grades */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-slate-900">Recent Grades</h2>
          <EmptyState
            title="No grades published"
            description="Graded exam results will appear here once published."
            icon={Award}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
