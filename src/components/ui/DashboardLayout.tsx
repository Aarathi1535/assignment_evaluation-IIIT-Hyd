import React from 'react';
import { PageHeader } from './PageHeader';
import { Card } from './Card';
import { LucideIcon } from 'lucide-react';

export interface StatItem {
  title: string;
  value: string;
  icon: LucideIcon;
  color: string;
  borderColor: string;
  iconBg: string;
}

interface DashboardLayoutProps {
  title: string;
  description: string;
  stats?: StatItem[];
  quickActions?: React.ReactNode;
  children?: React.ReactNode;
}

export const DashboardLayout = ({
  title,
  description,
  stats = [],
  quickActions,
  children,
}: DashboardLayoutProps) => {
  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <PageHeader title={title} description={description} />

        {/* Stats Grid */}
        {stats.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat, idx) => {
              const Icon = stat.icon;
              return (
                <div
                  key={idx}
                  className="relative overflow-hidden rounded-brand-lg border border-slate-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{stat.title}</p>
                      <p className="text-3xl font-black text-slate-900 tracking-tight">{stat.value}</p>
                    </div>
                    <div className={`p-2.5 rounded-brand ${stat.iconBg} flex items-center justify-center`}>
                      <Icon className="h-5 w-5 text-current" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick Actions */}
        {quickActions && (
          <Card>
            <h2 className="text-base font-bold text-slate-900 mb-3">Quick Actions</h2>
            <div className="flex flex-wrap gap-3">
              {quickActions}
            </div>
          </Card>
        )}

        {/* Main Dashboard Content */}
        {children}

      </div>
    </div>
  );
};

DashboardLayout.displayName = 'DashboardLayout';
