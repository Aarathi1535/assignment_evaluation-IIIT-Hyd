'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { BookOpen, Plus, Search, Trash2, Edit3, GraduationCap, Users, X, Check, CheckSquare, Square, AlertCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface StudentItem {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface CourseItem {
  _id: string;
  courseCode: string;
  courseName: string;
  semester: number;
  academicYear: string;
  professor: string;
  teachingAssistants?: string[];
  isActive: boolean;
  enrolledStudents?: StudentItem[];
}

export default function ProfessorCoursesPage() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Enrollment & Roster Modal state
  const [enrollCourseId, setEnrollCourseId] = useState<string | null>(null);
  const [enrollingCourse, setEnrollingCourse] = useState<CourseItem | null>(null);
  const [activeTab, setActiveTab] = useState<'roster' | 'enroll'>('roster');
  const [roster, setRoster] = useState<StudentItem[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [enrollStatus, setEnrollStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [savingEnrollment, setSavingEnrollment] = useState(false);

  const handleCloseModal = () => {
    setEnrollCourseId(null);
    setEnrollingCourse(null);
    setRoster([]);
    setStudents([]);
    setSelectedStudentIds([]);
    setStudentSearchQuery('');
    setEnrollStatus(null);
  };

  useEffect(() => {
    if (!enrollCourseId) {
      return;
    }

    async function loadEnrollmentData() {
      setLoadingRoster(true);
      setLoadingStudents(true);
      setEnrollStatus(null);
      setActiveTab('roster');

      try {
        const courseRes = await fetch(`/api/courses/${enrollCourseId}`);
        const courseData = await courseRes.json();
        
        const usersRes = await fetch('/api/users');
        const usersData = await usersRes.json();

        if (courseData.success && courseData.data) {
          setEnrollingCourse(courseData.data);
          const currentRoster = courseData.data.enrolledStudents || [];
          setRoster(currentRoster);
          
          if (usersData.success && Array.isArray(usersData.data)) {
            const allStudents = usersData.data.filter((u: StudentItem) => u.role?.toUpperCase() === 'STUDENT');
            setStudents(allStudents);
          }
        } else {
          setEnrollStatus({ success: false, message: courseData.message || 'Failed to load course details' });
        }
      } catch {
        setEnrollStatus({ success: false, message: 'An error occurred while loading enrollment details' });
      } finally {
        setLoadingRoster(false);
        setLoadingStudents(false);
      }
    }

    loadEnrollmentData();
  }, [enrollCourseId]);

  const handleEnrollSubmit = async () => {
    if (!enrollCourseId || selectedStudentIds.length === 0) return;

    setSavingEnrollment(true);
    setEnrollStatus(null);

    try {
      const res = await fetch(`/api/courses/${enrollCourseId}/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ studentIds: selectedStudentIds }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setEnrollStatus({ success: true, message: 'Students enrolled successfully!' });
        setSelectedStudentIds([]);
        
        const courseRes = await fetch(`/api/courses/${enrollCourseId}`);
        const courseData = await courseRes.json();
        if (courseData.success && courseData.data) {
          setEnrollingCourse(courseData.data);
          setRoster(courseData.data.enrolledStudents || []);
        }

        const listRes = await fetch('/api/courses');
        const listData = await listRes.json();
        if (listData.success && Array.isArray(listData.data)) {
          setCourses(listData.data);
        }

        setTimeout(() => {
          setActiveTab('roster');
          setEnrollStatus(null);
        }, 1500);

      } else {
        throw new Error(data.message || 'Failed to enroll students');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred during enrollment';
      setEnrollStatus({ success: false, message });
    } finally {
      setSavingEnrollment(false);
    }
  };

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
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Enrolled Students</span>
                          <span className="text-slate-800 font-bold">
                            {course.enrolledStudents?.length || 0} Students
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
                        variant="outline"
                        size="sm"
                        className="flex-1 h-9"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEnrollCourseId(course._id);
                        }}
                      >
                        <Users className="h-4 w-4 mr-1.5" />
                        <span>Enroll</span>
                      </Button>
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

        {/* Course Enrollment & Roster Modal */}
        {enrollCourseId && enrollingCourse && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50">
            <div className="bg-white rounded-brand-lg p-6 max-w-2xl w-full mx-4 shadow-xl border border-slate-200 flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    Course Enrollment & Roster
                  </h3>
                  <p className="text-sm font-semibold text-brand-primary tracking-wider uppercase mt-0.5">
                    {enrollingCourse.courseCode} — {enrollingCourse.courseName}
                  </p>
                </div>
                 <button
                  onClick={handleCloseModal}
                  className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-4 border-b border-slate-100 mt-4 shrink-0">
                <button
                  className={`pb-2.5 text-sm font-bold border-b-2 transition-all ${
                    activeTab === 'roster'
                      ? 'border-brand-primary text-brand-primary'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                  onClick={() => {
                    setActiveTab('roster');
                    setEnrollStatus(null);
                  }}
                >
                  Current Roster ({roster.length})
                </button>
                <button
                  className={`pb-2.5 text-sm font-bold border-b-2 transition-all ${
                    activeTab === 'enroll'
                      ? 'border-brand-primary text-brand-primary'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                  onClick={() => {
                    setActiveTab('enroll');
                    setEnrollStatus(null);
                  }}
                >
                  Enroll New Students
                </button>
              </div>

              {/* Content area (scrollable) */}
              <div className="flex-1 overflow-y-auto py-4 min-h-[300px]">
                {/* Alerts */}
                {enrollStatus && (
                  <div
                    className={`flex items-center gap-3 p-3.5 rounded-brand text-sm font-semibold mb-4 border ${
                      enrollStatus.success
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    {enrollStatus.success ? (
                      <Check className="h-5 w-5 shrink-0" />
                    ) : (
                      <AlertCircle className="h-5 w-5 shrink-0" />
                    )}
                    <span>{enrollStatus.message}</span>
                  </div>
                )}

                {activeTab === 'roster' ? (
                  loadingRoster ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-2">
                      <LoadingSpinner size="md" />
                      <p className="text-sm font-semibold text-slate-500">Loading roster...</p>
                    </div>
                  ) : roster.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                      <Users className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                      <p className="text-sm font-semibold">No students are currently enrolled in this course.</p>
                      <button
                        onClick={() => setActiveTab('enroll')}
                        className="text-brand-primary hover:underline text-xs font-bold mt-1"
                      >
                        Enroll students now
                      </button>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-brand overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                              Name
                            </th>
                            <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                              Email
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm font-medium text-slate-800">
                          {roster.map((student) => (
                            <tr key={student._id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-semibold text-slate-900">{student.name}</td>
                              <td className="px-4 py-3 text-slate-600">{student.email}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  // Enroll Tab
                  loadingStudents ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-2">
                      <LoadingSpinner size="md" />
                      <p className="text-sm font-semibold text-slate-500">Loading student directory...</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Search & Select All */}
                      <div className="flex flex-col sm:flex-row items-center gap-3 justify-between">
                        <div className="relative w-full sm:max-w-xs">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <input
                            type="text"
                            placeholder="Search students by name or email..."
                            value={studentSearchQuery}
                            onChange={(e) => setStudentSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-1.5 rounded-brand border border-slate-300 bg-white text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all text-xs font-semibold"
                          />
                        </div>

                        {/* Select All Toggle */}
                        {(() => {
                          const enrolledStudentIdsSet = new Set(roster.map((r) => r._id));
                          const enrollableStudents = students.filter((s) => !enrolledStudentIdsSet.has(s._id));
                          const filteredEnrollable = enrollableStudents.filter((s) => {
                            const query = studentSearchQuery.toLowerCase().trim();
                            return s.name.toLowerCase().includes(query) || s.email.toLowerCase().includes(query);
                          });
                          
                          if (filteredEnrollable.length === 0) return null;

                          const allSelected = filteredEnrollable.every((s) => selectedStudentIds.includes(s._id));

                          const handleSelectAllChange = () => {
                            if (allSelected) {
                              const filteredIds = filteredEnrollable.map((s) => s._id);
                              setSelectedStudentIds(selectedStudentIds.filter((id) => !filteredIds.includes(id)));
                            } else {
                              const filteredIds = filteredEnrollable.map((s) => s._id);
                              setSelectedStudentIds([...Array.from(new Set([...selectedStudentIds, ...filteredIds]))]);
                            }
                          };

                          return (
                            <button
                              type="button"
                              onClick={handleSelectAllChange}
                              className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-800 cursor-pointer self-start sm:self-center"
                            >
                              {allSelected ? (
                                <CheckSquare className="h-4.5 w-4.5 text-brand-primary" />
                              ) : (
                                <Square className="h-4.5 w-4.5 text-slate-400" />
                              )}
                              <span>Select All ({filteredEnrollable.length} found)</span>
                            </button>
                          );
                        })()}
                      </div>

                      {/* Student List */}
                      {(() => {
                        const enrolledStudentIdsSet = new Set(roster.map((r) => r._id));
                        const enrollableStudents = students.filter((s) => !enrolledStudentIdsSet.has(s._id));
                        const filteredEnrollable = enrollableStudents.filter((s) => {
                          const query = studentSearchQuery.toLowerCase().trim();
                          return s.name.toLowerCase().includes(query) || s.email.toLowerCase().includes(query);
                        });

                        if (filteredEnrollable.length === 0) {
                          return (
                            <div className="text-center py-12 text-slate-500 border border-dashed border-slate-200 rounded-brand bg-slate-50">
                              <p className="text-sm font-semibold">No new active students found matching your criteria.</p>
                            </div>
                          );
                        }

                        return (
                          <div className="border border-slate-200 rounded-brand max-h-[350px] overflow-y-auto divide-y divide-slate-100">
                            {filteredEnrollable.map((student) => {
                              const isChecked = selectedStudentIds.includes(student._id);
                              const handleToggle = () => {
                                if (isChecked) {
                                  setSelectedStudentIds(selectedStudentIds.filter((id) => id !== student._id));
                                } else {
                                  setSelectedStudentIds([...selectedStudentIds, student._id]);
                                }
                              };

                              return (
                                <div
                                  key={student._id}
                                  onClick={handleToggle}
                                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer transition-colors"
                                >
                                  <div>
                                    {isChecked ? (
                                      <CheckSquare className="h-5 w-5 text-brand-primary shrink-0" />
                                    ) : (
                                      <Square className="h-5 w-5 text-slate-400 shrink-0" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-slate-800 truncate">
                                      {student.name}
                                    </p>
                                    <p className="text-xs text-slate-500 truncate">
                                      {student.email}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )
                )}
              </div>

              {/* Actions Footer */}
              <div className="pt-4 border-t border-slate-100 flex justify-end gap-3 bg-white mt-auto shrink-0">
                 <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCloseModal}
                >
                  Close
                </Button>
                {activeTab === 'enroll' && (
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={savingEnrollment}
                    disabled={selectedStudentIds.length === 0}
                    onClick={handleEnrollSubmit}
                  >
                    Enroll Selected ({selectedStudentIds.length})
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
