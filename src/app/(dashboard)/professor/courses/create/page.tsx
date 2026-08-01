'use client';

import React, { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { FormInput } from '@/components/ui/FormInput';
import { FormSelect } from '@/components/ui/FormSelect';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import { ArrowLeft, BookOpen, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const formSchema = z.object({
  courseCode: z.string().trim().min(2, { message: 'Course code must be at least 2 characters long' }),
  courseName: z.string().trim().min(3, { message: 'Course name must be at least 3 characters long' }),
  semester: z.string().min(1, { message: 'Semester is required' }),
  academicYear: z.string().min(1, { message: 'Academic year is required' }),
  professor: z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Professor is required' }),
  teachingAssistants: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional(),
});

type FormValues = z.infer<typeof formSchema>;

const semesterOptions = [
  { value: '', label: 'Select Semester' },
  { value: '1', label: 'Semester 1' },
  { value: '2', label: 'Semester 2' },
  { value: '3', label: 'Semester 3' },
  { value: '4', label: 'Semester 4' },
  { value: '5', label: 'Semester 5' },
  { value: '6', label: 'Semester 6' },
  { value: '7', label: 'Semester 7' },
  { value: '8', label: 'Semester 8' },
];

const professorOptions = [
  { value: '60d5ec49315e2c56a84976fa', label: 'Aarathisree (Professor)' }
];

const taOptions = [
  { value: '60d5ec49315e2c56a84976fb', label: 'TA 1' },
  { value: '60d5ec49315e2c56a84976fc', label: 'TA 2' },
  { value: '60d5ec49315e2c56a84976fd', label: 'TA 3' },
];

const academicYearOptions = [
  { value: '2025-26', label: '2025-26' },
  { value: '2026-27', label: '2026-27' },
  { value: '2027-28', label: '2027-28' },
  { value: '2028-29', label: '2028-29' },
];

export default function CreateCoursePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      courseCode: '',
      courseName: '',
      semester: '',
      academicYear: '',
      professor: '',
      teachingAssistants: [],
    },
  });

  const onSubmit = async (values: FormValues) => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const payload = {
      courseCode: values.courseCode,
      courseName: values.courseName,
      semester: values.semester,
      academicYear: values.academicYear,
      professor: values.professor,
      teachingAssistants: values.teachingAssistants || [],
    };

    try {
      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to create course');
      }

      setSuccessMsg('Course created successfully!');
      reset();
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-900/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* Back Button & Header */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => router.push('/professor')}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-all w-fit cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Dashboard</span>
          </button>
          <div className="flex items-center gap-3 mt-2">
            <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-600 dark:text-indigo-400">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                Create Course
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Register a new course under your account.
              </p>
            </div>
          </div>
        </div>

        {/* Alerts */}
        {successMsg && (
          <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl p-4 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">{successMsg}</p>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-4 text-rose-800 dark:text-rose-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">{errorMsg}</p>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/80 p-6 sm:p-8 shadow-sm">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              <FormInput
                label="Course Code"
                placeholder="e.g. CS101"
                error={errors.courseCode?.message}
                {...register('courseCode')}
              />

              <FormInput
                label="Course Name"
                placeholder="e.g. Introduction to Computer Science"
                error={errors.courseName?.message}
                {...register('courseName')}
              />

              <FormSelect
                label="Semester"
                options={semesterOptions}
                error={errors.semester?.message}
                {...register('semester')}
              />

              <Controller
                name="academicYear"
                control={control}
                render={({ field }) => (
                  <SearchableSelect
                    label="Academic Year"
                    options={academicYearOptions}
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.academicYear?.message}
                    placeholder="Search/Select Academic Year"
                  />
                )}
              />

              <div className="md:col-span-2">
                <Controller
                  name="professor"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      label="Professor"
                      options={professorOptions}
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.professor?.message}
                      placeholder="Search/Select Professor"
                    />
                  )}
                />
              </div>

              <div className="md:col-span-2">
                <Controller
                  name="teachingAssistants"
                  control={control}
                  render={({ field }) => (
                    <SearchableMultiSelect
                      label="Teaching Assistants"
                      options={taOptions}
                      value={field.value || []}
                      onChange={field.onChange}
                      error={(errors.teachingAssistants as any)?.message}
                      placeholder="Search/Select Teaching Assistants"
                    />
                  )}
                />
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Optional. Select one or more teaching assistants.
                </p>
              </div>

            </div>

            {/* Actions */}
            <div className="flex justify-end items-center gap-4 pt-4 border-t border-slate-100 dark:border-slate-700/80">
              <button
                type="button"
                onClick={() => router.push('/professor')}
                className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750 font-medium transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-medium shadow-sm transition-all hover:scale-[1.02] cursor-pointer"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{loading ? 'Saving...' : 'Save Course'}</span>
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  );
}
