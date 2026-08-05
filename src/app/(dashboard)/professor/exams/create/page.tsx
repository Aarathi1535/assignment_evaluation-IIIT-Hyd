'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { FormInput } from '@/components/ui/FormInput';
import { FormSelect } from '@/components/ui/FormSelect';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import { ArrowLeft, FileText, CheckCircle2, AlertCircle, BookOpen } from 'lucide-react';

const formSchema = z.object({
  title: z.string().trim().min(3, { message: 'Title must be at least 3 characters long' }),
  course: z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Course is required' }),
  examDate: z.string().min(1, { message: 'Exam date is required' }),
  totalMarks: z.string().min(1, { message: 'Total marks is required' }).refine((val) => !isNaN(Number(val)) && Number(val) >= 0, { message: 'Total marks must be non-negative' }),
  numberOfQuestions: z.string().min(1, { message: 'Number of questions is required' }).refine((val) => !isNaN(Number(val)) && Number(val) >= 1, { message: 'Number of questions must be at least 1' }),
  status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED'], { message: 'Status is required' }),
});

type FormValues = z.infer<typeof formSchema>;

const statusOptions = [
  { value: '', label: 'Select Status' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'SCHEDULED', label: 'Scheduled' },
];

interface CourseItem {
  _id: string;
  courseCode: string;
  courseName: string;
}

export default function CreateExamPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [fetchingCourses, setFetchingCourses] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadCourses() {
      try {
        const res = await fetch('/api/courses');
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setCourses(data.data);
        }
      } catch (err) {
        console.error('Failed to fetch courses:', err);
      } finally {
        setFetchingCourses(false);
      }
    }
    loadCourses();
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      course: '',
      examDate: '',
      totalMarks: '',
      numberOfQuestions: '',
      status: 'DRAFT',
    },
  });
  
  // eslint-disable-next-line react-hooks/incompatible-library
  const selectedCourseId = watch('course');
  const [courseStudents, setCourseStudents] = useState<{ value: string; label: string }[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [fetchingRoster, setFetchingRoster] = useState(false);

  useEffect(() => {
    if (!selectedCourseId) {
      setCourseStudents([]);
      setSelectedStudentIds([]);
      return;
    }

    async function loadCourseRoster() {
      setFetchingRoster(true);
      try {
        const res = await fetch(`/api/courses/${selectedCourseId}`);
        const data = await res.json();
        if (data.success && data.data) {
          const enrolled = data.data.enrolledStudents || [];
          const options = enrolled.map((s: { _id: string; name: string; email: string }) => ({
            value: s._id,
            label: `${s.name} (${s.email})`,
          }));
          setCourseStudents(options);
          setSelectedStudentIds(options.map((o: { value: string; label: string }) => o.value));
        } else {
          setCourseStudents([]);
          setSelectedStudentIds([]);
        }
      } catch {
        setCourseStudents([]);
        setSelectedStudentIds([]);
      } finally {
        setFetchingRoster(false);
      }
    }

    loadCourseRoster();
  }, [selectedCourseId]);

  const onSubmit = async (values: FormValues) => {
    if (!session?.user?.id) {
      setErrorMsg('User session is missing. Please log in again.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const payload = {
      title: values.title,
      course: values.course,
      createdBy: session.user.id,
      examDate: new Date(values.examDate).toISOString(),
      totalMarks: Number(values.totalMarks),
      numberOfQuestions: Number(values.numberOfQuestions),
      status: values.status,
    };

    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to create exam');
      }

      const examId = data.data._id;

      // Enroll selected students into the exam
      if (selectedStudentIds.length > 0) {
        const enrollRes = await fetch(`/api/exams/${examId}/enroll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ studentIds: selectedStudentIds }),
        });
        const enrollData = await enrollRes.json();
        if (!enrollRes.ok || !enrollData.success) {
          throw new Error(enrollData.message || 'Failed to enroll students in exam');
        }
      }

      setSuccessMsg('Exam created and students enrolled successfully!');
      reset();
      setSelectedStudentIds([]);
      
      // Delay navigation slightly to let professor see success message
      setTimeout(() => {
        router.push('/professor/exams');
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  const courseOptions = [
    { value: '', label: 'Select Course' },
    ...courses.map((c) => ({
      value: c._id,
      label: `${c.courseCode} - ${c.courseName}`,
    })),
  ];

  if (fetchingCourses) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-semibold text-slate-500 font-sans">Loading courses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto space-y-5">
        
        {/* Back Button & Header */}
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => router.push('/professor/exams')}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-all w-fit cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Exams</span>
          </button>
          
          <div className="flex items-center gap-3 mt-2">
            <div className="p-2.5 bg-brand-primary/10 rounded text-brand-primary flex items-center justify-center">
              <FileText className="h-5 w-5" />
            </div>
            <PageHeader
              title="Create Exam"
              description="Design and schedule a new exam or assessment."
            />
          </div>
        </div>

        {/* Alerts */}
        {successMsg && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-brand p-3.5 text-emerald-800 text-sm font-semibold">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-brand p-3.5 text-rose-800 text-sm font-semibold">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {courses.length === 0 ? (
          <EmptyState
            title="No Courses Available"
            description="Create a course before creating an exam."
            icon={BookOpen}
            action={
              <Link href="/professor/courses/create">
                <Button variant="primary">
                  Create Course
                </Button>
              </Link>
            }
          />
        ) : (
          /* Form Card */
          <Card>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <div className="md:col-span-2">
                  <FormInput
                    label="Exam Title"
                    placeholder="e.g. Midterm Exam"
                    error={errors.title?.message}
                    {...register('title')}
                  />
                </div>

                <FormSelect
                  label="Course"
                  options={courseOptions}
                  error={errors.course?.message}
                  {...register('course')}
                />

                {selectedCourseId && (
                  <div className="md:col-span-2 mt-1">
                    {fetchingRoster ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                        <LoadingSpinner size="sm" />
                        <span>Loading course roster...</span>
                      </div>
                    ) : courseStudents.length === 0 ? (
                      <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold rounded-brand">
                        No students are currently enrolled in the selected course.
                      </div>
                    ) : (
                      <SearchableMultiSelect
                        label="Enroll Students for this Exam"
                        options={courseStudents}
                        value={selectedStudentIds}
                        onChange={(val) => setSelectedStudentIds(val)}
                        placeholder="Search and select students to take this exam..."
                      />
                    )}
                  </div>
                )}

                <FormInput
                  label="Exam Date"
                  type="datetime-local"
                  error={errors.examDate?.message}
                  {...register('examDate')}
                />

                <FormInput
                  label="Total Marks"
                  type="number"
                  placeholder="e.g. 100"
                  error={errors.totalMarks?.message}
                  {...register('totalMarks')}
                />

                <FormInput
                  label="Number of Questions"
                  type="number"
                  placeholder="e.g. 10"
                  error={errors.numberOfQuestions?.message}
                  {...register('numberOfQuestions')}
                />

                <div className="md:col-span-2">
                  <FormSelect
                    label="Status"
                    options={statusOptions}
                    error={errors.status?.message}
                    {...register('status')}
                  />
                </div>

              </div>

              {/* Actions */}
              <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/professor/exams')}
                >
                  Cancel
                </Button>
                
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={loading}
                >
                  Save Exam
                </Button>
              </div>
            </form>
          </Card>
        )}

      </div>
    </div>
  );
}
