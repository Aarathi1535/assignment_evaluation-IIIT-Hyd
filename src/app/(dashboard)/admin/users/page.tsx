'use client';

import React, { useState, useEffect } from 'react';
import { 
  Users as UsersIcon, 
  GraduationCap, 
  BookOpen, 
  ClipboardList, 
  Plus, 
  FileSpreadsheet, 
  Search, 
  AlertCircle 
} from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { UserTable, UserItem } from './components/UserTable';
import { CreateUserModal } from './components/CreateUserModal';
import { CsvImportModal } from './components/CsvImportModal';
import { DeactivateConfirmDialog } from './components/DeactivateConfirmDialog';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals Visibility
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCsvOpen, setIsCsvOpen] = useState(false);
  const [deactivateUser, setDeactivateUser] = useState<{ id: string; name: string; email: string } | null>(null);

  const fetchUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (res.ok) {
        setUsers(data.data || []);
      } else {
        setError(data.message || 'Failed to retrieve users');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fetchUsers();
    };
    init();
  }, []);

  const handleDeactivateClick = (user: { id: string; name: string; email: string }) => {
    setDeactivateUser(user);
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase().trim();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const stats = [
    {
      title: 'Active Users',
      value: users.length.toString(),
      icon: UsersIcon,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Professors',
      value: users.filter((u) => u.role.toUpperCase() === 'PROFESSOR').length.toString(),
      icon: GraduationCap,
      color: 'text-indigo-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-indigo-50 text-indigo-600',
    },
    {
      title: 'Teaching Assistants',
      value: users.filter((u) => u.role.toUpperCase() === 'TA').length.toString(),
      icon: BookOpen,
      color: 'text-purple-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-purple-50 text-purple-600',
    },
    {
      title: 'Students',
      value: users.filter((u) => u.role.toUpperCase() === 'STUDENT').length.toString(),
      icon: ClipboardList,
      color: 'text-emerald-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
  ];

  return (
    <DashboardLayout
      title="User Management"
      description="Create, search, deactivate accounts, and perform bulk user CSV imports."
      stats={stats}
    >
      <div className="space-y-6">
        
        {/* Controls Card (Search and Actions) */}
        <Card className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Search bar */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Quick Action buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="md"
              onClick={() => setIsCsvOpen(true)}
            >
              <FileSpreadsheet className="h-4 w-4 text-slate-500" />
              <span>Import CSV</span>
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              <span>Create User</span>
            </Button>
          </div>
        </Card>

        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-brand bg-rose-50 border border-rose-100 flex gap-3 text-sm text-rose-700 font-medium shadow-xs">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Directory Table */}
        <UserTable
          users={filteredUsers}
          isLoading={isLoading}
          onDeactivate={handleDeactivateClick}
        />

        {/* Modals */}
        <CreateUserModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSuccess={fetchUsers}
        />

        <CsvImportModal
          isOpen={isCsvOpen}
          onClose={() => setIsCsvOpen(false)}
          onSuccess={fetchUsers}
        />

        <DeactivateConfirmDialog
          isOpen={!!deactivateUser}
          user={deactivateUser}
          onClose={() => setDeactivateUser(null)}
          onSuccess={fetchUsers}
        />

      </div>
    </DashboardLayout>
  );
}
