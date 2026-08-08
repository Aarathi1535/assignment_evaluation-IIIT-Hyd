'use client';

import React, { useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormInput } from '@/components/ui/FormInput';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';

const resetPasswordFormSchema = z.object({
  newPassword: z.string().min(8, { message: 'Password must be at least 8 characters long' }),
  confirmPassword: z.string().min(8, { message: 'Confirm password must be at least 8 characters long' }),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: {
      newPassword: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async (values: ResetPasswordFormValues) => {
    if (!token) {
      setError('Password reset token is missing. Please request a new link.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          newPassword: values.newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Invalid or expired token.');
        setIsLoading(false);
        return;
      }

      setSuccess('Your password has been reset successfully. Redirecting to login...');
      
      setTimeout(() => {
        router.push('/login');
      }, 3000);
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
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle className="mt-4 text-3xl font-black text-slate-900 tracking-tight">
            Reset Password
          </CardTitle>
          <CardDescription className="mt-1 text-sm text-slate-600 font-medium">
            Please enter your new password below
          </CardDescription>
        </CardHeader>

        <CardContent>
          {!token ? (
            <div className="flex items-center gap-2.5 p-3.5 rounded bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>Reset token is missing from the URL. Please check your link.</span>
            </div>
          ) : (
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
                  label="New Password"
                  type="password"
                  placeholder="••••••••"
                  error={errors.newPassword?.message}
                  {...register('newPassword')}
                />

                <FormInput
                  label="Confirm Password"
                  type="password"
                  placeholder="••••••••"
                  error={errors.confirmPassword?.message}
                  {...register('confirmPassword')}
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                isLoading={isLoading}
                className="w-full mt-6"
              >
                Reset Password
              </Button>
            </form>
          )}
        </CardContent>

        <CardFooter className="text-center text-sm text-slate-600 mt-6">
          <Link
            href="/login"
            className="font-bold text-brand-primary hover:text-brand-primary/80 transition-colors"
          >
            Back to Login
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
        <div className="text-center text-slate-600 font-medium">Loading form...</div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
