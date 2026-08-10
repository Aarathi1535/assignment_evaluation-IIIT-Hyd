'use client';

import React from 'react';
import { BookOpen, Clock, CheckCircle, HelpCircle, ClipboardList, PenTool, CheckSquare } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export default function TaDashboardPage() {
  const stats = [
    {
      title: 'Assigned Courses',
      value: '0',
      icon: BookOpen,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Pending Grading',
      value: '0',
      icon: Clock,
      color: 'text-amber-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-amber-50 text-amber-600',
    },
    {
      title: 'Completed Grading',
      value: '0',
      icon: CheckCircle,
      color: 'text-emerald-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Regrade Requests',
      value: '0',
      icon: HelpCircle,
      color: 'text-purple-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-purple-50 text-purple-600',
    },
  ];

  const quickActions = (
    <>
      <Button variant="primary" size="md">
        <ClipboardList className="h-4 w-4" />
        <span>View Grading Allocations</span>
      </Button>
      <Button variant="secondary" size="md">
        <PenTool className="h-4 w-4" />
        <span>Enter Grading Portal</span>
      </Button>
    </>
  );

  return (
    <DashboardLayout
      title="TA Dashboard"
      description="Manage your grading allocations, pending evaluations, and student queries."
      stats={stats}
      quickActions={quickActions}
    >
      {/* Content Sections Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Grading Allocations */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-slate-900">Grading Allocations</h2>
          <EmptyState
            title="No grading assignments"
            description="You do not have any active grading allocations yet."
            icon={CheckSquare}
          />
        </div>

        {/* Pending Regrades */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-slate-900">Pending Regrades</h2>
          <EmptyState
            title="No pending requests"
            description="All student regrade requests for your sections have been addressed."
            icon={HelpCircle}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
