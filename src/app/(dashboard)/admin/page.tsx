'use client';

import React from 'react';
import { Users, BookOpen, FileText, Terminal, UserPlus, Settings, ShieldAlert } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export default function AdminDashboardPage() {
  const stats = [
    {
      title: 'Total Users',
      value: '0',
      icon: Users,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Active Courses',
      value: '0',
      icon: BookOpen,
      color: 'text-purple-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-purple-50 text-purple-600',
    },
    {
      title: 'Total Submissions',
      value: '0',
      icon: FileText,
      color: 'text-emerald-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Audit Logs',
      value: '0',
      icon: Terminal,
      color: 'text-amber-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-amber-50 text-amber-600',
    },
  ];

  const quickActions = (
    <>
      <Button variant="primary" size="md">
        <UserPlus className="h-4 w-4" />
        <span>Manage Users</span>
      </Button>
      <Button variant="secondary" size="md">
        <Settings className="h-4 w-4" />
        <span>System Settings</span>
      </Button>
    </>
  );

  return (
    <DashboardLayout
      title="Admin Dashboard"
      description="System administration, user roles management, course registrations, and logs."
      stats={stats}
      quickActions={quickActions}
    >
      {/* Content Sections Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Management */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-slate-900">User Directory</h2>
          <EmptyState
            title="No users registered"
            description="Manage and verify users as they register on the platform."
            icon={Users}
          />
        </div>

        {/* Audit Logs */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-slate-900">System Logs</h2>
          <EmptyState
            title="No audit entries"
            description="Security audits and background task logs will be logged here."
            icon={ShieldAlert}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
