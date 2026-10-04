'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, FileCheck, Award, HelpCircle, Eye, RefreshCw, GraduationCap } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface StudentCourse {
  _id: string;
  courseCode: string;
  courseName: string;
  semester: number;
  academicYear: string;
}

interface StudentExam {
  _id: string;
  title: string;
  examDate: string;
  totalMarks: number;
  status: string;
}

async function fetchStudentList<T>(url: string, signal: AbortSignal): Promise<T[]> {
  const response = await fetch(url, { cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok || !body.success || !Array.isArray(body.data)) {
    throw new Error(body.message || `Could not load dashboard data (${response.status}).`);
  }
  return body.data as T[];
}

export default function StudentDashboardPage() {
  const [courses, setCourses] = useState<StudentCourse[] | null>(null);
  const [exams, setExams] = useState<StudentExam[] | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const loadDashboard = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    try {
      const [courseData, examData] = await Promise.all([
        fetchStudentList<StudentCourse>('/api/courses', controller.signal),
        fetchStudentList<StudentExam>('/api/exams', controller.signal)
      ]);
      if (!controller.signal.aborted) {
        setCourses(courseData);
        setExams(examData);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'Could not load your courses and exams.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setRefreshing(false);
        activeRequest.current = null;
      }
    }
  }, []);

  const refreshDashboard = useCallback(() => {
    setRefreshing(true);
    setError(null);
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const initialLoadId = window.setTimeout(() => void loadDashboard(), 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshDashboard();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
      activeRequest.current?.abort();
    };
  }, [loadDashboard, refreshDashboard]);

  const stats = [
    {
      title: 'Enrolled Courses',
      value: courses?.length.toString() ?? '—',
      icon: BookOpen,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Assigned Exams',
      value: exams?.length.toString() ?? '—',
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
      <Button variant="outline" size="md" onClick={() => void refreshDashboard()} disabled={refreshing}>
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        <span>Refresh Dashboard</span>
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
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3" aria-labelledby="student-courses-heading">
          <h2 id="student-courses-heading" className="text-xl font-bold text-slate-900">My Courses</h2>
          {courses === null && refreshing ? (
            <p role="status" className="text-sm text-slate-600">Loading your courses…</p>
          ) : courses?.length ? (
            <ul className="space-y-3">
              {courses.map(course => (
                <li key={course._id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="font-semibold text-slate-900">{course.courseName}</h3>
                  <p className="mt-1 text-sm text-slate-600">{course.courseCode} · Semester {course.semester} · {course.academicYear}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No enrolled courses"
              description="You are not enrolled in any courses yet."
              icon={GraduationCap}
            />
          )}
        </section>

        <section className="space-y-3" aria-labelledby="student-exams-heading">
          <h2 id="student-exams-heading" className="text-xl font-bold text-slate-900">My Exams</h2>
          {exams === null && refreshing ? (
            <p role="status" className="text-sm text-slate-600">Loading your exams…</p>
          ) : exams?.length ? (
            <ul className="space-y-3">
              {exams.map(exam => (
                <li key={exam._id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="font-semibold text-slate-900">{exam.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {new Date(exam.examDate).toLocaleDateString()} · {exam.totalMarks} marks
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No assigned exams"
              description="Published exams assigned to you will appear here."
              icon={Award}
            />
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
