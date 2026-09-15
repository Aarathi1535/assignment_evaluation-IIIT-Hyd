'use client';

import React, { useState, useEffect } from 'react';
import { BookOpen, Clock, CheckCircle, HelpCircle, FileText, ClipboardList, CheckSquare, AlertCircle, ArrowRight, Bell } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import NotificationPanel from '@/components/NotificationPanel';
import Link from 'next/link';

interface AnswerScript {
  _id: string;
  exam: string;
  anonymousId?: string;
  scriptReference?: string;
  startPageNumber?: number;
  endPageNumber?: number;
  pageCount?: number;
  isActive: boolean;
}

interface Allocation {
  _id: string;
  exam: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  question?: number;
  answerScript: AnswerScript | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export default function TaDashboardPage() {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);

  const fetchAllocations = async (pageToFetch: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/allocations?page=${pageToFetch}&limit=20`);
      const data = await res.json();
      if (res.ok) {
        setAllocations(data.data?.allocations || []);
        setPagination(data.data?.pagination || null);
        setUnreadNotificationCount(data.data?.unreadNotificationCount || 0);
        setCurrentPage(pageToFetch);
      } else {
        setError(data.message || 'Failed to retrieve allocations');
        setAllocations([]);
        setPagination(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setAllocations([]);
      setPagination(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAllocations(1);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Compute stats
  const uniqueExams = Array.from(new Set(allocations.map(a => a.exam))).length;
  const pendingCount = allocations.filter(a => a.status !== 'COMPLETED').length;
  const completedCount = allocations.filter(a => a.status === 'COMPLETED').length;

  const stats = [
    {
      title: 'Assigned Exams',
      value: uniqueExams.toString(),
      icon: BookOpen,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Pending Grading',
      value: pendingCount.toString(),
      icon: Clock,
      color: 'text-amber-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-amber-50 text-amber-600',
    },
    {
      title: 'Completed Grading',
      value: completedCount.toString(),
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
    <div className="flex items-center gap-2.5">
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={() => setIsNotificationPanelOpen(true)}
        className="relative cursor-pointer"
        data-testid="notifications-button"
        aria-label={unreadNotificationCount > 0 ? `Notifications (${unreadNotificationCount} unread)` : 'Notifications'}
      >
        <Bell className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <span>Notifications</span>
        {unreadNotificationCount > 0 && (
          <span
            className="ml-1 px-1.5 py-0.5 text-3xs font-extrabold bg-brand-primary text-white rounded-full"
            data-testid="unread-notification-badge"
            aria-hidden="true"
          >
            {unreadNotificationCount}
          </span>
        )}
      </Button>
      <Button type="button" variant="outline" size="md" onClick={() => fetchAllocations(currentPage)}>
        <Clock className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <span>Refresh Queue</span>
      </Button>
    </div>
  );

  const getStatusBadge = (status: Allocation['status']) => {
    switch (status) {
      case 'PENDING':
        return 'bg-amber-50 text-amber-700 border-amber-200 border';
      case 'IN_PROGRESS':
        return 'bg-blue-50 text-blue-700 border-blue-200 border';
      case 'COMPLETED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 border';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200 border';
    }
  };

  return (
    <DashboardLayout
      title="TA Work Queue"
      description="Access and evaluate your assigned exam answer scripts."
      stats={stats}
      quickActions={quickActions}
    >
      <div className="space-y-6">
        {/* In-app Notification Alert Banner (AE-111) */}
        {unreadNotificationCount > 0 && (
          <div
            role="status"
            aria-live="polite"
            data-testid="new-assignment-notification-banner"
            className="p-4 rounded-brand bg-brand-primary/10 border border-brand-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm shadow-xs"
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-brand-primary text-white flex items-center justify-center shrink-0" aria-hidden="true">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-slate-900">New Assignment Notifications</p>
                <p className="text-xs text-slate-600 font-medium">
                  You have {unreadNotificationCount} unread script assignment notification{unreadNotificationCount === 1 ? '' : 's'}.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setIsNotificationPanelOpen(true)}
              className="cursor-pointer shrink-0"
              data-testid="view-notifications-banner-btn"
            >
              <span>View Notifications</span>
            </Button>
          </div>
        )}

        {/* Error State Banner */}
        {error && (
          <div role="alert" aria-live="assertive" className="p-4 rounded-brand bg-rose-50 border border-rose-100 flex gap-3 text-sm text-rose-700 font-medium shadow-xs">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Allocations Queue Card */}
        <Card className="p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-slate-500" />
              <span>Assigned Grading Queue</span>
            </h2>
            <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
              {pagination ? pagination.total : allocations.length} Items
            </span>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 bg-white" role="status">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-primary" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-500 mt-3">Loading queue...</span>
            </div>
          ) : error ? (
            <div className="p-12 text-center bg-white flex flex-col items-center justify-center" role="alert">
              <AlertCircle className="h-10 w-10 text-rose-500 mb-3" />
              <span className="text-sm font-semibold text-slate-750">{error}</span>
            </div>
          ) : allocations.length === 0 ? (
            <div className="p-6 bg-white">
              <EmptyState
                title="No grading assignments"
                description="You do not have any active grading allocations assigned to you."
                icon={CheckSquare}
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 text-2xs uppercase tracking-wider font-extrabold select-none">
                      <th scope="col" className="px-6 py-4">Script Reference / Anonymous ID</th>
                      <th scope="col" className="px-6 py-4">Exam Context</th>
                      <th scope="col" className="px-6 py-4">Grading Mode / Context</th>
                      <th scope="col" className="px-6 py-4 text-center">Status</th>
                      <th scope="col" className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {allocations.map((alloc) => {
                      const script = alloc.answerScript;
                      const scriptRef = script?.scriptReference || script?.anonymousId || 'Unassigned Script';
                      const isQuestionWise = alloc.question !== undefined && alloc.question !== null;
                      const targetUrl = script
                        ? isQuestionWise
                          ? `/grading/${script._id}/question/${alloc.question}`
                          : `/grading/${script._id}`
                        : '#';

                      return (
                        <tr key={alloc._id} className="hover:bg-slate-50/50 transition-colors">
                          {/* Script Ref */}
                          <td className="px-6 py-4.5 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="h-8.5 w-8.5 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center font-extrabold text-sm select-none">
                                <FileText className="h-4 w-4" />
                              </div>
                              <span className="font-bold text-slate-950">{scriptRef}</span>
                            </div>
                          </td>

                          {/* Exam ID */}
                          <td className="px-6 py-4.5 text-slate-650 font-medium whitespace-nowrap">
                            Exam ID: {alloc.exam}
                          </td>

                          {/* Context Mode */}
                          <td className="px-6 py-4.5 whitespace-nowrap">
                            {isQuestionWise ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase tracking-wide bg-purple-50 text-purple-700 border border-purple-200">
                                Question {alloc.question}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-200">
                                Whole Script
                              </span>
                            )}
                          </td>

                          {/* Status Badge */}
                          <td className="px-6 py-4.5 whitespace-nowrap text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase tracking-wider ${getStatusBadge(alloc.status)}`}>
                              {alloc.status}
                            </span>
                          </td>

                          {/* Open Action */}
                          <td className="px-6 py-4.5 whitespace-nowrap text-right">
                            <Link href={targetUrl} passHref legacyBehavior>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!script}
                                className="border-slate-200 text-slate-650 hover:bg-brand-primary/5 hover:text-brand-primary hover:border-brand-primary"
                              >
                                <span>Open Grader</span>
                                <ArrowRight className="h-3.5 w-3.5 ml-1" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {pagination && pagination.totalPages > 1 && (
                <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex justify-between items-center select-none">
                  <div className="text-xs md:text-sm text-slate-500">
                    Showing page <span className="font-semibold text-slate-700">{pagination.page}</span> of{' '}
                    <span className="font-semibold text-slate-700">{pagination.totalPages}</span> ({pagination.total} total items)
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchAllocations(currentPage - 1)}
                      disabled={!pagination.hasPreviousPage || isLoading}
                      id="prev-page-btn"
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchAllocations(currentPage + 1)}
                      disabled={!pagination.hasNextPage || isLoading}
                      id="next-page-btn"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Notification Panel Modal (AE-111) */}
      <NotificationPanel
        isOpen={isNotificationPanelOpen}
        onClose={() => setIsNotificationPanelOpen(false)}
        onNotificationsUpdated={(count) => setUnreadNotificationCount(count)}
      />
    </DashboardLayout>
  );
}
