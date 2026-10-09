'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, Clock, CheckCircle, HelpCircle, FileText, ClipboardList, CheckSquare, AlertCircle, ArrowRight, Bell, Send } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import NotificationPanel from '@/components/NotificationPanel';
import { BulkSubmitModal } from '@/components/grading/BulkSubmitModal';
import Link from 'next/link';
import { resolveTargetExamId } from '@/lib/allocationUtils';

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

interface AssignedCourse {
  _id: string;
  courseCode: string;
  courseName: string;
}

interface AssignedExam {
  _id: string;
  title: string;
  examDate: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface AllocationStats {
  pending: number;
  inProgress: number;
  completed: number;
  assignedExams: number;
}

async function fetchAssignedList<T>(url: string, signal: AbortSignal): Promise<T[]> {
  const response = await fetch(url, { cache: 'no-store', signal });
  const body = await response.json() as { success?: boolean; message?: string; data?: unknown };
  if (!response.ok || !body.success || !Array.isArray(body.data)) {
    throw new Error(body.message || `Could not load assigned items (${response.status}).`);
  }
  return body.data as T[];
}

export default function TaDashboardPage() {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [assignedCourses, setAssignedCourses] = useState<AssignedCourse[]>([]);
  const [assignedExams, setAssignedExams] = useState<AssignedExam[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [allocationStats, setAllocationStats] = useState<AllocationStats | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignmentContextError, setAssignmentContextError] = useState<string | null>(null);
  const [assignmentContextLoaded, setAssignmentContextLoaded] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [selectedExamFilter, setSelectedExamFilter] = useState<string>('ALL');
  const [isExamPickerOpen, setIsExamPickerOpen] = useState(false);

  const currentPageRef = useRef(currentPage);
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  const fetchAllocations = useCallback(async (pageToFetch: number, showLoading = false) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    if (showLoading) setIsLoading(true);
    setError(null);

    const [allocationsResult, coursesResult, examsResult] = await Promise.allSettled([
      fetch(`/api/allocations?page=${pageToFetch}&limit=20`, {
        cache: 'no-store',
        signal: controller.signal
      })
        .then(async response => {
          const body = await response.json() as {
            success?: boolean;
            message?: string;
            data?: {
              allocations?: Allocation[];
              pagination?: Pagination | null;
              stats?: AllocationStats;
              unreadNotificationCount?: number;
            };
          };
          if (!response.ok || !body.success || !body.data) {
            throw new Error(body.message || `Failed to retrieve allocations (${response.status}).`);
          }
          return body.data;
        }),
      fetchAssignedList<AssignedCourse>('/api/courses', controller.signal),
      fetchAssignedList<AssignedExam>('/api/exams', controller.signal)
    ]);

    if (controller.signal.aborted || sequence !== requestSequence.current) return;

    if (allocationsResult.status === 'fulfilled') {
      setAllocations(allocationsResult.value.allocations || []);
      setPagination(allocationsResult.value.pagination || null);
      setAllocationStats(allocationsResult.value.stats || null);
      setUnreadNotificationCount(allocationsResult.value.unreadNotificationCount || 0);
      setCurrentPage(pageToFetch);
      setError(null);
    } else {
      setError(allocationsResult.reason instanceof Error ? allocationsResult.reason.message : 'Failed to retrieve allocations.');
    }
    if (coursesResult.status === 'fulfilled' && examsResult.status === 'fulfilled') {
      setAssignedCourses(coursesResult.value);
      setAssignedExams(examsResult.value);
      setAssignmentContextLoaded(true);
      setAssignmentContextError(null);
    } else {
      const failedRequest = [coursesResult, examsResult].find(result => result.status === 'rejected');
      setAssignmentContextError(
        failedRequest?.status === 'rejected' && failedRequest.reason instanceof Error
          ? failedRequest.reason.message
          : 'Could not refresh assigned courses and exams.'
      );
    }
    setIsLoading(false);
    activeRequest.current = null;
  }, []);

  const refreshAllocations = useCallback((pageToFetch: number, showLoading = true) => {
    void fetchAllocations(pageToFetch, showLoading);
  }, [fetchAllocations]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    const initialLoadId = window.setTimeout(() => void fetchAllocations(1), 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshAllocations(currentPageRef.current, false);
      }
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const intervalId = window.setInterval(refreshWhenVisible, 60_000);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
      activeRequest.current?.abort();
    };
  }, [fetchAllocations, refreshAllocations]);

  // Compute stats
  const uniqueExamIds = Array.from(new Set(allocations.map((a) => a.exam).filter(Boolean)));
  const uniqueExams = allocationStats?.assignedExams ?? uniqueExamIds.length;
  const pendingCount = allocationStats
    ? allocationStats.pending + allocationStats.inProgress
    : allocations.filter(a => a.status !== 'COMPLETED').length;
  const completedCount = allocationStats?.completed
    ?? allocations.filter(a => a.status === 'COMPLETED').length;

  const handleBulkSubmitClick = (targetExamId?: string) => {
    if (targetExamId) {
      setSelectedExamId(targetExamId);
      setIsBulkModalOpen(true);
      return;
    }

    const resolved = resolveTargetExamId(allocations, selectedExamFilter);
    if (resolved) {
      setSelectedExamId(resolved);
      setIsBulkModalOpen(true);
    } else {
      setIsExamPickerOpen(true);
    }
  };

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
      <Button type="button" variant="outline" size="md" onClick={() => refreshAllocations(currentPage)}>
        <Clock className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <span>Refresh Queue</span>
      </Button>
      {allocations.length > 0 && (
        <Button
          type="button"
          variant="primary"
          size="md"
          data-testid="bulk-submit-exam-button"
          onClick={() => handleBulkSubmitClick()}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs cursor-pointer"
        >
          <Send className="h-4 w-4" />
          <span>Bulk Submit Exam</span>
        </Button>
      )}
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

        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Courses and exams assigned to you</h2>
            <p className="mt-1 text-sm text-slate-600">Course access and grading allocations are managed separately. Newly allocated scripts appear in the grading queue below.</p>
          </div>
          {assignmentContextError && <p role="alert" className="text-sm text-rose-700">{assignmentContextError}</p>}
          <div className="grid gap-5 md:grid-cols-2">
            <section aria-labelledby="ta-assigned-courses-heading">
              <h3 id="ta-assigned-courses-heading" className="font-semibold text-slate-800">Courses</h3>
              {assignedCourses.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {assignedCourses.map(course => (
                    <li key={course._id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <span className="font-medium text-slate-900">{course.courseName}</span>
                      <span className="ml-2 text-sm text-slate-600">{course.courseCode}</span>
                    </li>
                  ))}
                </ul>
              ) : assignmentContextLoaded ? (
                <p className="mt-2 text-sm text-slate-500">No courses are currently assigned to you.</p>
              ) : (
                <p role="status" className="mt-2 text-sm text-slate-500">Loading assigned courses…</p>
              )}
            </section>
            <section aria-labelledby="ta-assigned-exams-heading">
              <h3 id="ta-assigned-exams-heading" className="font-semibold text-slate-800">Exams</h3>
              {assignedExams.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {assignedExams.map(exam => (
                    <li key={exam._id} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-900">
                      {exam.title}
                    </li>
                  ))}
                </ul>
              ) : assignmentContextLoaded ? (
                <p className="mt-2 text-sm text-slate-500">No exams are currently available through your assigned courses.</p>
              ) : (
                <p role="status" className="mt-2 text-sm text-slate-500">Loading assigned exams…</p>
              )}
            </section>
          </div>
        </Card>

        {/* Allocations Queue Card */}
        <Card className="p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-slate-500" />
                <span>Assigned Grading Queue</span>
              </h2>
              <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                {pagination ? pagination.total : allocations.length} Items
              </span>
            </div>
            {uniqueExamIds.length > 1 && (
              <div className="flex items-center gap-2">
                <label htmlFor="exam-filter-select" className="text-xs font-semibold text-slate-600">
                  Filter Exam:
                </label>
                <select
                  id="exam-filter-select"
                  data-testid="exam-filter-select"
                  value={selectedExamFilter}
                  onChange={(e) => setSelectedExamFilter(e.target.value)}
                  className="text-xs border border-slate-300 rounded px-2.5 py-1 bg-white text-slate-700 font-medium focus:ring-1 focus:ring-brand-primary"
                >
                  <option value="ALL">All Exams ({uniqueExamIds.length})</option>
                  {uniqueExamIds.map((id) => (
                    <option key={id} value={id}>
                      Exam: {id}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
                    {(selectedExamFilter === 'ALL'
                      ? allocations
                      : allocations.filter((a) => a.exam === selectedExamFilter)
                    ).map((alloc) => {
                      const script = alloc.answerScript;
                      const scriptRef = script?.scriptReference || script?.anonymousId || 'Unassigned Script';
                      const isQuestionWise = alloc.question !== undefined && alloc.question !== null;
                      const targetUrl = script
                        ? isQuestionWise
                          ? `/grading/${script._id}/question/${alloc.question}?allocationId=${alloc._id}`
                          : `/grading/${script._id}?allocationId=${alloc._id}`
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
                            <div className="flex items-center gap-2">
                              <span>Exam ID: {alloc.exam}</span>
                              {uniqueExamIds.length > 1 && (
                                <button
                                  type="button"
                                  data-testid={`bulk-submit-exam-row-${alloc.exam}`}
                                  onClick={() => handleBulkSubmitClick(alloc.exam)}
                                  className="text-3xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5 font-bold cursor-pointer transition-colors"
                                  title={`Bulk submit scripts for Exam ${alloc.exam}`}
                                >
                                  Submit Exam
                                </button>
                              )}
                            </div>
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
                            {script ? (
                              <Link
                                href={targetUrl}
                                className="inline-flex items-center justify-center gap-2 font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary cursor-pointer border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 px-3 py-1.5 text-xs rounded-brand-sm border-slate-200 text-slate-650 hover:bg-brand-primary/5 hover:text-brand-primary hover:border-brand-primary"
                              >
                                <span>Open Grader</span>
                                <ArrowRight className="h-3.5 w-3.5 ml-1" />
                              </Link>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled
                                className="border-slate-200 text-slate-650 hover:bg-brand-primary/5 hover:text-brand-primary hover:border-brand-primary"
                              >
                                <span>Open Grader</span>
                                <ArrowRight className="h-3.5 w-3.5 ml-1" />
                              </Button>
                            )}
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
                      onClick={() => refreshAllocations(currentPage - 1)}
                      disabled={!pagination.hasPreviousPage || isLoading}
                      id="prev-page-btn"
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refreshAllocations(currentPage + 1)}
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

      {/* Exam Picker Modal for Multiple Exams (AE-173) */}
      {isExamPickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="select-exam-modal-title"
          data-testid="exam-picker-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        >
          <div className="bg-white rounded-brand-lg shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div>
              <h3 id="select-exam-modal-title" className="text-base font-bold text-slate-900">
                Select Exam for Bulk Submission
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Your queue contains allocations across multiple exams. Please select the specific exam you wish to bulk submit:
              </p>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {uniqueExamIds.map((examId) => {
                const count = allocations.filter((a) => a.exam === examId).length;
                return (
                  <button
                    key={examId}
                    type="button"
                    data-testid={`select-exam-option-${examId}`}
                    onClick={() => {
                      setSelectedExamId(examId);
                      setIsExamPickerOpen(false);
                      setIsBulkModalOpen(true);
                    }}
                    className="w-full text-left p-3 rounded-brand border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/50 transition-colors flex justify-between items-center cursor-pointer"
                  >
                    <div>
                      <span className="font-mono text-xs font-bold text-slate-900 block">Exam: {examId}</span>
                      <span className="text-2xs text-slate-500 font-medium">{count} script{count === 1 ? '' : 's'} assigned</span>
                    </div>
                    <Send className="h-4 w-4 text-emerald-600 shrink-0" />
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsExamPickerOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Submit Modal (AE-169 / AE-173) */}
      {selectedExamId && (
        <BulkSubmitModal
          isOpen={isBulkModalOpen}
          onClose={() => setIsBulkModalOpen(false)}
          examId={selectedExamId}
          onComplete={() => {
            refreshAllocations(currentPage);
          }}
        />
      )}
    </DashboardLayout>
  );
}
