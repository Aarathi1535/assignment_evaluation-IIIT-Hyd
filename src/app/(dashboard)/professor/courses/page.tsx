'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { BookOpen, Plus, Search, Trash2, Edit3, GraduationCap } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface CourseItem {
  _id: string;
  courseCode: string;
  courseName: string;
  semester: number;
  academicYear: string;
  professor: string;
  teachingAssistants?: string[];
  isActive: boolean;
}

export default function ProfessorCoursesPage() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadCourses() {
      try {
        const res = await fetch('/api/courses');
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setCourses(data.data);
        }
      } catch (err) {
        console.error('Failed to load courses:', err);
      } finally {
        setLoading(false);
      }
    }
    loadCourses();
  }, []);

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return;
    setDeleting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/courses/${deleteConfirmId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg('Course deleted successfully!');
        setCourses(courses.filter((c) => c._id !== deleteConfirmId));
        setDeleteConfirmId(null);
      } else {
        throw new Error(data.message || 'Failed to delete course');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred while deleting the course.';
      setErrorMsg(message);
      setDeleteConfirmId(null);
    } finally {
      setDeleting(false);
      setTimeout(() => {
        setSuccessMsg(null);
        setErrorMsg(null);
      }, 3000);
    }
  };

  const filteredCourses = React.useMemo(() => {
    return courses.filter((c) => {
      const query = searchQuery.toLowerCase().trim();
      return (
        c.courseCode.toLowerCase().includes(query) ||
        c.courseName.toLowerCase().includes(query)
      );
    });
  }, [courses, searchQuery]);

  const quickActions = (
    <Link href="/professor/courses/create">
      <Button variant="primary" size="md">
        <Plus className="h-4 w-4" />
        <span>Create Course</span>
      </Button>
    </Link>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
        <div className="text-center space-y-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-semibold text-slate-500">Loading courses...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout
      title="Course Management"
      description="Manage configurations, TA allocations, and curriculums for your courses."
      quickActions={quickActions}
    >
      <div className="space-y-6 font-sans">
        {/* Alerts */}
        {successMsg && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-brand p-3.5 text-emerald-800 text-sm font-semibold transition-all">
            <GraduationCap className="h-5 w-5 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-brand p-3.5 text-rose-800 text-sm font-semibold transition-all">
            <Trash2 className="h-5 w-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {courses.length === 0 ? (
          <EmptyState
            title="No courses created yet"
            description="Create your first course to configure exams and grade submissions."
            icon={BookOpen}
            action={
              <Link href="/professor/courses/create">
                <Button variant="primary">
                  <Plus className="h-4 w-4 mr-2" />
                  <span>Create Course</span>
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-5">
            {/* Search Bar */}
            <div className="relative max-w-md w-full">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search className="h-4.5 w-4.5 text-slate-400" />
              </span>
              <input
                type="text"
                placeholder="Search courses by code or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-brand border border-slate-300 bg-white text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all text-sm font-semibold shadow-2xs"
              />
            </div>

            {/* List/Grid Cards */}
            {filteredCourses.length === 0 ? (
              <EmptyState
                title="No matching courses"
                description="Try refining your search keyword."
                icon={BookOpen}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredCourses.map((course) => (
                  <Card
                    key={course._id}
                    className="hover:shadow-md transition-shadow duration-200 flex flex-col justify-between h-full border border-slate-200"
                  >
                    <div className="space-y-4">
                      {/* Header: Code & Semester */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <p className="text-xs font-extrabold text-brand-primary tracking-wider uppercase">
                            {course.courseCode}
                          </p>
                          <h3 className="text-lg font-bold text-slate-900 leading-snug line-clamp-2">
                            {course.courseName}
                          </h3>
                        </div>
                      </div>

                      {/* Course Metadata */}
                      <div className="space-y-2 text-sm text-slate-600 font-medium pt-1 border-t border-slate-100">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Academic Year</span>
                          <span className="text-slate-800 font-bold">{course.academicYear}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Semester</span>
                          <span className="text-slate-800 font-bold">Semester {course.semester}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">TAs Allocated</span>
                          <span className="text-slate-800 font-bold">
                            {course.teachingAssistants?.length || 0} TAs
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                      <Link href={`/professor/courses/edit/${course._id}`} className="flex-1">
                        <Button variant="outline" size="sm" className="w-full h-9">
                          <Edit3 className="h-4 w-4 mr-1.5" />
                          <span>Edit</span>
                        </Button>
                      </Link>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-9 px-3"
                        onClick={(e) => handleDeleteClick(course._id, e)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmId && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50">
            <div className="bg-white rounded-brand-lg p-6 max-w-sm w-full mx-4 shadow-xl border border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Delete Course</h3>
              <p className="text-sm text-slate-600 mt-2 font-medium">
                Are you sure you want to delete this course? This action cannot be undone and will affect related exams.
              </p>
              <div className="flex justify-end gap-3 mt-6">
                <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  isLoading={deleting}
                  onClick={handleDeleteConfirm}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
