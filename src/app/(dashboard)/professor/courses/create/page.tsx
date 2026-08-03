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
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ArrowLeft, BookOpen, CheckCircle2, AlertCircle } from 'lucide-react';

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-5">
        
        {/* Back Button & Header */}
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => router.push('/professor')}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-all w-fit cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Dashboard</span>
          </button>
          
          <div className="flex items-center gap-3 mt-2">
            <div className="p-2.5 bg-brand-primary/10 rounded text-brand-primary flex items-center justify-center">
              <BookOpen className="h-5 w-5" />
            </div>
            <PageHeader
              title="Create Course"
              description="Register a new course under your account."
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

        {/* Form Card */}
        <Card>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
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
                      error={(errors.teachingAssistants as { message?: string })?.message}
                      placeholder="Search/Select Teaching Assistants"
                    />
                  )}
                />
                <p className="text-xs text-slate-500 font-medium mt-1">
                  Optional. Select one or more teaching assistants.
                </p>
              </div>

            </div>

            {/* Actions */}
            <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/professor')}
              >
                Cancel
              </Button>
              
              <Button
                type="submit"
                variant="primary"
                isLoading={loading}
              >
                Save Course
              </Button>
            </div>
          </form>
        </Card>

      </div>
    </div>
  );
}
