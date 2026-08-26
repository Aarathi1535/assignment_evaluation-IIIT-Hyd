'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, Plus, Calendar, Bookmark, HelpCircle, Search, Trash2, Edit3, CheckCircle2, AlertCircle, Upload, Users } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface ExamItem {
  _id: string;
  title: string;
  course: string;
  examDate: string;
  totalMarks: number;
  numberOfQuestions: number;
  status: string;
}

interface CourseItem {
  _id: string;
  courseCode: string;
  courseName: string;
}

export default function ProfessorExamsPage() {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [examsRes, coursesRes] = await Promise.all([
          fetch('/api/exams'),
          fetch('/api/courses')
        ]);
        const examsData = await examsRes.json();
        const coursesData = await coursesRes.json();

        if (examsData.success && Array.isArray(examsData.data)) {
          setExams(examsData.data);
        }
        if (coursesData.success && Array.isArray(coursesData.data)) {
          setCourses(coursesData.data);
        }
      } catch (err) {
        console.error('Failed to load exams or courses data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const courseMap = React.useMemo(() => {
    return new Map(courses.map(c => [c._id, c]));
  }, [courses]);

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
      const res = await fetch(`/api/exams/${deleteConfirmId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg('Exam deleted successfully!');
        setExams(exams.filter((ex) => ex._id !== deleteConfirmId));
        setDeleteConfirmId(null);
      } else {
        throw new Error(data.message || 'Failed to delete exam');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred while deleting the exam.';
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

  const filteredExams = React.useMemo(() => {
    return exams.filter((ex) => {
      const titleMatches = ex.title.toLowerCase().includes(searchQuery.toLowerCase().trim());
      const courseMatches = selectedCourse === '' || ex.course === selectedCourse;
      return titleMatches && courseMatches;
    });
  }, [exams, searchQuery, selectedCourse]);

  const quickActions = (
    <div className="flex flex-wrap gap-3">
      <Link href="/professor/exams/upload">
        <Button variant="outline" size="md">
          <Upload className="h-4 w-4" />
          <span>Upload Answer Sheets</span>
        </Button>
      </Link>
      <Link href="/professor/exams/create">
        <Button variant="primary" size="md">
          <Plus className="h-4 w-4" />
          <span>Create Exam</span>
        </Button>
      </Link>
    </div>
  );

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'SCHEDULED':
        return 'bg-blue-50 text-blue-700 border border-blue-200';
      case 'DRAFT':
      default:
        return 'bg-slate-100 text-slate-700 border border-slate-200';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
        <div className="text-center space-y-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-semibold text-slate-500">Loading exams...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout
      title="Exam Management"
      description="Create, monitor, and configure exams for your active courses."
      quickActions={quickActions}
    >
      <div className="space-y-6 font-sans">
        {/* Alerts */}
        {successMsg && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-brand p-3.5 text-emerald-800 text-sm font-semibold transition-all">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-brand p-3.5 text-rose-800 text-sm font-semibold transition-all">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {exams.length === 0 ? (
          <EmptyState
            title="No exams created yet"
            description="Design your first assessment or exam to get started."
            icon={FileText}
            action={
              <Link href="/professor/exams/create">
                <Button variant="primary">
                  <Plus className="h-4 w-4 mr-2" />
                  <span>Create Exam</span>
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-5">
            {/* Search and Filters Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* Search Title */}
              <div className="relative max-w-md w-full">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Search className="h-4.5 w-4.5 text-slate-400" />
                </span>
                <input
                  type="text"
                  placeholder="Search exams by title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-brand border border-slate-300 bg-white text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all text-sm font-semibold shadow-2xs"
                />
              </div>

              {/* Course Filter Dropdown */}
              <div className="w-full sm:w-64">
                <select
                  value={selectedCourse}
                  onChange={(e) => setSelectedCourse(e.target.value)}
                  className="w-full px-4 py-2 rounded-brand border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all text-sm font-semibold shadow-2xs"
                >
                  <option value="">All Courses</option>
                  {courses.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.courseCode} - {c.courseName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Cards Grid */}
            {filteredExams.length === 0 ? (
              <EmptyState
                title="No matching exams"
                description="Try refining your search query or selected course filter."
                icon={FileText}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredExams.map((exam) => {
                  const matchedCourse = courseMap.get(exam.course);
                  const courseLabel = matchedCourse 
                    ? `${matchedCourse.courseCode} - ${matchedCourse.courseName}`
                    : 'Unknown Course';

                  return (
                    <Card
                      key={exam._id}
                      className="hover:shadow-md transition-shadow duration-200 flex flex-col justify-between h-full border border-slate-200"
                    >
                      <div className="space-y-4">
                        {/* Title and Status */}
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-lg font-bold text-slate-900 line-clamp-2 leading-snug">
                            {exam.title}
                          </h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${getStatusBadgeStyle(exam.status)}`}>
                            {exam.status}
                          </span>
                        </div>

                        {/* Metadata */}
                        <div className="space-y-2 text-sm text-slate-600 font-medium">
                          <div className="flex items-center gap-2">
                            <Bookmark className="h-4 w-4 text-slate-400 shrink-0" />
                            <span className="truncate">{courseLabel}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                            <span>
                              {new Date(exam.examDate).toLocaleString(undefined, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <HelpCircle className="h-4 w-4 text-slate-400 shrink-0" />
                            <span>
                              {exam.numberOfQuestions} Questions ({exam.totalMarks} Marks)
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="pt-4 mt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/professor/exams/edit/${exam._id}`} className="flex-1 min-w-[70px]">
                          <Button variant="outline" size="sm" className="w-full h-9 text-xs px-2">
                            <Edit3 className="h-3.5 w-3.5 mr-1" />
                            <span>Edit</span>
                          </Button>
                        </Link>
                        <Link href={`/professor/exams/edit/${exam._id}/rubric`} className="flex-1 min-w-[70px]">
                          <Button variant="outline" size="sm" className="w-full h-9 text-xs px-2">
                            <FileText className="h-3.5 w-3.5 mr-1" />
                            <span>Rubric</span>
                          </Button>
                        </Link>
                        <Link href={`/professor/exams/${exam._id}/review-dashboard`} className="flex-1 min-w-[70px]">
                          <Button variant="outline" size="sm" className="w-full h-9 text-xs px-2">
                            <Search className="h-3.5 w-3.5 mr-1" />
                            <span>Review</span>
                          </Button>
                        </Link>
                        <Link href={`/professor/exams/${exam._id}/allocate`} className="flex-1 min-w-[70px]">
                          <Button variant="outline" size="sm" className="w-full h-9 text-xs px-2">
                            <Users className="h-3.5 w-3.5 mr-1" />
                            <span>Allocate</span>
                          </Button>
                        </Link>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-9 px-3"
                          onClick={(e) => handleDeleteClick(exam._id, e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmId && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50">
            <div className="bg-white rounded-brand-lg p-6 max-w-sm w-full mx-4 shadow-xl border border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Delete Exam</h3>
              <p className="text-sm text-slate-600 mt-2 font-medium">
                Are you sure you want to delete this exam? This action cannot be undone and will delete related submissions.
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
