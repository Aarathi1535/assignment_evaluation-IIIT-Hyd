'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  UserCheck,
  AlertCircle,
  RefreshCw,
  Eye,
  CheckCheck
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export interface ActivityItem {
  _id: string;
  action: string;
  description: string;
  timestamp: string;
  createdAt: string;
  outcome?: 'SUCCESS' | 'FAILURE';
  allocationId?: string | null;
  question?: number | null;
  exam?: {
    id: string;
    title: string;
    courseCode?: string;
  } | null;
  answerScript?: {
    id: string;
    anonymousId?: string;
    scriptReference?: string;
  } | null;
  actingUser?: {
    id: string;
    name: string;
    email: string;
    role?: string;
  };
  details?: {
    previousTa?: { id: string; name: string; email: string };
    newTa?: { id: string; name: string; email: string };
    ta?: { id: string; name: string; email: string };
    [key: string]: unknown;
  };
}

interface ProfessorActivityFeedProps {
  limit?: number;
  examId?: string;
  className?: string;
}

export function formatActivityTime(timestamp: string | Date): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

export function getActionBadge(action: string): { label: string; bg: string; text: string; icon: React.ElementType } {
  switch (action) {
    case 'ALLOCATION_REASSIGN':
      return { label: 'Reassigned', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: ArrowRightLeft };
    case 'ALLOCATION_CLAIM':
      return { label: 'Claimed', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: Clock };
    case 'ALLOCATION_RELEASE':
      return { label: 'Released', bg: 'bg-slate-100 border-slate-200', text: 'text-slate-700', icon: ArrowRightLeft };
    case 'ALLOCATION_COMPLETE':
      return { label: 'Completed', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: CheckCircle2 };
    case 'ANSWERSCRIPT_IDENTIFIED':
      return { label: 'Identified', bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700', icon: UserCheck };
    case 'INGESTION_APPROVED':
      return { label: 'Approved', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: CheckCheck };
    case 'INGESTION_APPROVAL_REVOKED':
      return { label: 'Revoked', bg: 'bg-rose-50 border-rose-200', text: 'text-rose-700', icon: AlertCircle };
    case 'EXAM_BLIND_GRADING_TOGGLED':
      return { label: 'Blind Grading', bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700', icon: Eye };
    default:
      return { label: action.replace(/_/g, ' '), bg: 'bg-slate-100 border-slate-200', text: 'text-slate-700', icon: Activity };
  }
}

export default function ProfessorActivityFeed({ limit = 10, examId, className = '' }: ProfessorActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(async () => {
    try {
      const url = new URL('/api/professor/activity', window.location.origin);
      url.searchParams.set('limit', String(limit));
      if (examId) {
        url.searchParams.set('examId', examId);
      }

      const res = await fetch(url.toString());
      const data = await res.json();

      if (res.ok && data.success && Array.isArray(data.data?.activities)) {
        setActivities(data.data.activities);
      } else {
        setError(data.message || 'Failed to load activity feed');
      }
    } catch (err) {
      console.error('Failed to load activity feed:', err);
      setError('Unable to fetch recent activity. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [limit, examId]);

  const handleRefresh = () => {
    setLoading(true);
    setError(null);
    fetchActivities();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchActivities();
  }, [fetchActivities]);

  return (
    <div className={`space-y-4 font-sans ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-brand-primary" />
          <h2 className="text-xl font-bold text-slate-900">Recent Activity</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </Button>
      </div>

      {loading && (
        <div className="py-10 flex flex-col items-center justify-center space-y-3 bg-white rounded-lg border border-slate-200">
          <LoadingSpinner size="md" />
          <p className="text-xs font-semibold text-slate-500">Loading recent activity...</p>
        </div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600" />
            <p className="text-sm font-semibold">Failed to load activity feed</p>
          </div>
          <p className="text-xs text-rose-700">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="text-xs border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            Try Again
          </Button>
        </div>
      )}

      {!loading && !error && activities.length === 0 && (
        <EmptyState
          title="No recent activities yet"
          description="Grading, allocation, and script updates will appear here in chronological order as they occur."
          icon={Activity}
        />
      )}

      {!loading && !error && activities.length > 0 && (
        <div className="space-y-3">
          {activities.map((item) => {
            const badge = getActionBadge(item.action);
            const BadgeIcon = badge.icon;
            const timeFormatted = formatActivityTime(item.timestamp || item.createdAt);

            return (
              <Card
                key={item._id}
                className="hover:shadow-xs transition-shadow duration-200 border border-slate-200 p-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 p-1.5 rounded-md border ${badge.bg} ${badge.text}`}>
                      <BadgeIcon className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-2xs font-extrabold px-1.5 py-0.5 rounded-full border ${badge.bg} ${badge.text} uppercase`}>
                          {badge.label}
                        </span>
                        {item.exam && (
                          <span className="text-2xs font-extrabold px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 uppercase">
                            {item.exam.courseCode || item.exam.title}
                          </span>
                        )}
                        {item.question !== null && item.question !== undefined && (
                          <span className="text-2xs font-extrabold px-1.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700">
                            Q{item.question}
                          </span>
                        )}
                        {item.answerScript?.anonymousId && (
                          <span className="text-2xs font-mono font-bold text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                            {item.answerScript.anonymousId}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-900">
                        {item.description}
                      </p>
                      {item.actingUser?.name && (
                        <p className="text-xs text-slate-500 font-medium">
                          By <span className="font-semibold text-slate-700">{item.actingUser.name}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between text-xs text-slate-500">
                    <span className="font-medium">{timeFormatted}</span>
                    {item.exam?.title && (
                      <span className="text-3xs text-slate-400 font-medium truncate max-w-[160px]" title={item.exam.title}>
                        {item.exam.title}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
