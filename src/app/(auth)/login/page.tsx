'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FormInput } from '@/components/ui/FormInput';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { KeyRound, AlertCircle } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().trim().email({ message: 'Invalid email address' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginValues) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      });

      if (res?.error) {
        setError('Invalid email or password.');
        setIsLoading(false);
      } else {
        router.push('/');
        router.refresh();
      }
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
            Welcome back
          </CardTitle>
          <CardDescription className="mt-1 text-sm text-slate-600 font-medium">
            Sign in to your account to continue
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

            <div className="space-y-4">
              <FormInput
                label="Email Address"
                type="email"
                placeholder="name@university.edu"
                error={errors.email?.message}
                {...register('email')}
              />

              <div className="space-y-1">
                <FormInput
                  label="Password"
                  type="password"
                  placeholder="••••••••"
                  error={errors.password?.message}
                  {...register('password')}
                />
                <div className="flex justify-end">
                  <Link
                    href="/forgot-password"
                    className="text-xs font-semibold text-brand-primary hover:text-brand-primary/80 transition-colors"
                  >
                    Forgot Password?
                  </Link>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
              className="w-full mt-6"
            >
              Sign In
            </Button>
          </form>
        </CardContent>

        <CardFooter className="text-center text-sm text-slate-600 mt-6">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-bold text-brand-primary hover:text-brand-primary/80 transition-colors"
          >
            Create an account
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
