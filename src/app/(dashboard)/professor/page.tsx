'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { BookOpen, FileText, Users, Clock, Plus, FolderOpen } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Card } from '@/components/ui/Card';

interface CourseItem {
  _id: string;
  courseCode: string;
  courseName: string;
  createdAt: string;
}

interface ExamItem {
  _id: string;
  title: string;
  course: string;
  examDate: string;
  createdAt: string;
  status: string;
}

export default function ProfessorDashboardPage() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [coursesRes, examsRes] = await Promise.all([
          fetch('/api/courses'),
          fetch('/api/exams')
        ]);
        const coursesData = await coursesRes.json();
        const examsData = await examsRes.json();

        if (coursesData.success && Array.isArray(coursesData.data)) {
          setCourses(coursesData.data);
        }
        if (examsData.success && Array.isArray(examsData.data)) {
          setExams(examsData.data);
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboardData();
  }, []);

  const courseMap = React.useMemo(() => {
    return new Map(courses.map(c => [c._id, c]));
  }, [courses]);

  // Sort by createdAt descending
  const recentCourses = [...courses]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);

  const recentExams = [...exams]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);

  const stats = [
    {
      title: 'Total Courses',
      value: String(courses.length),
      icon: BookOpen,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Total Exams',
      value: String(exams.length),
      icon: FileText,
      color: 'text-purple-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-purple-50 text-purple-600',
    },
    {
      title: 'Students',
      value: '0', // Optional placeholder or mocked
      icon: Users,
      color: 'text-emerald-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Pending Evaluations',
      value: '0', // Optional placeholder or mocked
      icon: Clock,
      color: 'text-amber-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-amber-50 text-amber-600',
    },
  ];

  const quickActions = (
    <>
      <Link href="/professor/courses/create">
        <Button variant="primary" size="md">
          <Plus className="h-4 w-4" />
          <span>Create Course</span>
        </Button>
      </Link>
      <Link href="/professor/exams/create">
        <Button variant="secondary" size="md">
          <Plus className="h-4 w-4" />
          <span>Create Exam</span>
        </Button>
      </Link>
    </>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
        <div className="text-center space-y-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-semibold text-slate-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout
      title="Professor Dashboard"
      description="Overview of your active courses, upcoming exams, and pending grading assessments."
      stats={stats}
      quickActions={quickActions}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 font-sans">
        
        {/* Recent Courses */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900">Recent Courses</h2>
            {courses.length > 0 && (
              <Link href="/professor/courses" className="text-sm font-bold text-brand-primary hover:underline">
                View All
              </Link>
            )}
          </div>
          
          {recentCourses.length === 0 ? (
            <EmptyState
              title="No courses created yet"
              description="Get started by creating your first course."
              icon={FolderOpen}
              action={
                <Link href="/professor/courses/create">
                  <Button variant="primary" size="sm">
                    <Plus className="h-4 w-4 mr-1.5" />
                    <span>Create Course</span>
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {recentCourses.map((c) => (
                <Card key={c._id} className="hover:shadow-xs transition-shadow duration-200 border border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-extrabold text-brand-primary tracking-wider uppercase">{c.courseCode}</p>
                      <h3 className="text-base font-bold text-slate-900">{c.courseName}</h3>
                    </div>
                    <Link href={`/professor/courses/edit/${c._id}`}>
                      <Button variant="outline" size="sm">
                        Edit
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Recent Exams */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900">Recent Exams</h2>
            {exams.length > 0 && (
              <Link href="/professor/exams" className="text-sm font-bold text-brand-primary hover:underline">
                View All
              </Link>
            )}
          </div>

          {recentExams.length === 0 ? (
            <EmptyState
              title="No exams created yet"
              description="Design your first assignment or exam once you have a course."
              icon={FileText}
              action={
                <Link href="/professor/exams/create">
                  <Button variant="secondary" size="sm">
                    <Plus className="h-4 w-4 mr-1.5" />
                    <span>Create Exam</span>
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {recentExams.map((e) => {
                const courseInfo = courseMap.get(e.course);
                const courseLabel = courseInfo ? courseInfo.courseCode : 'Unknown Course';

                return (
                  <Card key={e._id} className="hover:shadow-xs transition-shadow duration-200 border border-slate-200">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-2xs font-extrabold px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 uppercase">
                            {courseLabel}
                          </span>
                          <span className="text-3xs font-extrabold text-slate-500 uppercase tracking-widest">
                            {e.status}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-slate-900">{e.title}</h3>
                        <p className="text-xs text-slate-500 font-medium">
                          {new Date(e.examDate).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                        </p>
                      </div>
                      <Link href={`/professor/exams/edit/${e._id}`}>
                        <Button variant="outline" size="sm">
                          Edit
                        </Button>
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}
