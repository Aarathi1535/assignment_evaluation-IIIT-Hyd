import React from 'react';
import { FolderOpen, LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState = ({
  title,
  description,
  icon: Icon = FolderOpen,
  action,
  className = '',
}: EmptyStateProps) => {
  return (
    <div className={`border-2 border-dashed border-slate-300 rounded-brand-lg p-8 text-center bg-slate-50/50 ${className}`}>
      <Icon className="mx-auto h-12 w-12 text-slate-400 mb-4 animate-pulse-slow" />
      <p className="text-base font-bold text-slate-800">{title}</p>
      <p className="text-sm text-slate-600 mt-1">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};

EmptyState.displayName = 'EmptyState';
