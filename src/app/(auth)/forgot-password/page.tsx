'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { FormInput } from '@/components/ui/FormInput';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { Mail, AlertCircle, CheckCircle2 } from 'lucide-react';

const forgotPasswordSchema = z.object({
  email: z.string().trim().email({ message: 'Invalid email address' }),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  const onSubmit = async (values: ForgotPasswordValues) => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Something went wrong. Please try again.');
        setIsLoading(false);
        return;
      }

      setSuccess('If an account with that email exists, a password reset link has been sent.');
      reset();
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-brand flex items-center justify-center bg-brand-primary/10 text-brand-primary">
            <Mail className="h-6 w-6" />
          </div>
          <CardTitle className="mt-4 text-3xl font-black text-slate-900 tracking-tight">
            Forgot password
          </CardTitle>
          <CardDescription className="mt-1 text-sm text-slate-600 font-medium">
            Enter your email address and we&apos;ll send you a recovery link
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
                label="Email Address"
                type="email"
                placeholder="name@university.edu"
                error={errors.email?.message}
                {...register('email')}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
              className="w-full mt-6"
            >
              Send Reset Link
            </Button>
          </form>
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
