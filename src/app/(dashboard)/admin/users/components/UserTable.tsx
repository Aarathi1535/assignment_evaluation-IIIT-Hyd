'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import { ShieldAlert, Trash2 } from 'lucide-react';

export interface UserItem {
  _id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

interface UserTableProps {
  users: UserItem[];
  isLoading: boolean;
  onDeactivate: (user: { id: string; name: string; email: string }) => void;
}

const roleBadgeStyles: Record<string, string> = {
  ADMIN: 'bg-rose-50 text-rose-700 border-rose-200 border',
  PROFESSOR: 'bg-indigo-50 text-indigo-700 border-indigo-200 border',
  TA: 'bg-purple-50 text-purple-700 border-purple-200 border',
  STUDENT: 'bg-emerald-50 text-emerald-700 border-emerald-200 border',
};

export const UserTable = ({ users, isLoading, onDeactivate }: UserTableProps) => {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white rounded-brand-lg border border-slate-200 shadow-xs">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-primary" />
        <span className="text-sm font-semibold text-slate-500 mt-3">Loading directory...</span>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-12 bg-white rounded-brand-lg border border-slate-200 shadow-xs">
        <div className="h-12 w-12 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mb-3">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-bold text-slate-900">No users found</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-[280px]">
          Try adjusting your search terms or register new accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-brand-lg shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-2xs uppercase tracking-wider font-extrabold select-none">
              <th className="px-6 py-4">User Name</th>
              <th className="px-6 py-4">Email Address</th>
              <th className="px-6 py-4">Security Role</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {users.map((user) => {
              const roleStyle = roleBadgeStyles[user.role.toUpperCase()] || 'bg-slate-50 text-slate-700 border-slate-200 border';
              const initialLetter = user.name ? user.name.charAt(0).toUpperCase() : 'U';

              return (
                <tr key={user._id} className="hover:bg-slate-50/50 transition-colors">
                  {/* Name with initials avatar */}
                  <td className="px-6 py-4.5 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="h-8.5 w-8.5 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center font-extrabold text-sm select-none">
                        {initialLetter}
                      </div>
                      <span className="font-bold text-slate-950">{user.name}</span>
                    </div>
                  </td>
                  {/* Email */}
                  <td className="px-6 py-4.5 text-slate-650 font-medium whitespace-nowrap">
                    {user.email}
                  </td>
                  {/* Role Badge */}
                  <td className="px-6 py-4.5 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase tracking-wide ${roleStyle}`}>
                      {user.role}
                    </span>
                  </td>
                  {/* Status */}
                  <td className="px-6 py-4.5 whitespace-nowrap text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase tracking-wider bg-green-50 text-green-700 border border-green-200">
                      Active
                    </span>
                  </td>
                  {/* Actions */}
                  <td className="px-6 py-4.5 whitespace-nowrap text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDeactivate({ id: user._id, name: user.name, email: user.email })}
                      className="border-slate-200 text-slate-650 hover:bg-rose-50 hover:text-rose-650 hover:border-rose-200"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      <span>Deactivate</span>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
