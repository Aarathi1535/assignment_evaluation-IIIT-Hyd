'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FormInput } from '@/components/ui/FormInput';
import { FormSelect } from '@/components/ui/FormSelect';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { registerSchema, RegisterInput } from '@/validations/authValidation';
import { UserPlus, AlertCircle, CheckCircle2 } from 'lucide-react';

const roleOptions = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'TA', label: 'Teaching Assistant (TA)' },
  { value: 'PROFESSOR', label: 'Professor' },
  { value: 'ADMIN', label: 'Administrator' },
];

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      role: 'STUDENT',
    },
  });

  const onSubmit = async (values: RegisterInput) => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Registration failed');
        setIsLoading(false);
        return;
      }

      setSuccess('Account created successfully! Redirecting to login...');
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-brand flex items-center justify-center bg-brand-primary/10 text-brand-primary">
            <UserPlus className="h-6 w-6" />
          </div>
          <CardTitle className="mt-4 text-3xl font-black text-slate-900 tracking-tight">
            Create account
          </CardTitle>
          <CardDescription className="mt-1 text-sm text-slate-600 font-medium">
            Get started by creating your account
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            {error && (
              <div className="flex items-center gap-2.5 p-3.5 rounded bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2.5 p-3.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span>{success}</span>
              </div>
            )}

            <div className="space-y-4">
              <FormInput
                label="Full Name"
                type="text"
                placeholder="John Doe"
                error={errors.name?.message}
                {...register('name')}
              />

              <FormInput
                label="Email Address"
                type="email"
                placeholder="name@university.edu"
                error={errors.email?.message}
                {...register('email')}
              />

              <FormInput
                label="Password"
                type="password"
                placeholder="••••••••"
                error={errors.password?.message}
                {...register('password')}
              />

              <FormSelect
                label="Role"
                options={roleOptions}
                error={errors.role?.message}
                {...register('role')}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
              className="w-full mt-6"
            >
              Register
            </Button>
          </form>
        </CardContent>

        <CardFooter className="text-center text-sm text-slate-600 mt-6">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-bold text-brand-primary hover:text-brand-primary/80 transition-colors"
          >
            Sign in
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
