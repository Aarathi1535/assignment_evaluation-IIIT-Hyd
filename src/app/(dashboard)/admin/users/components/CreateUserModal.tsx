'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, CreateUserInput } from '@/validations/userValidation';
import { FormInput } from '@/components/ui/FormInput';
import { FormSelect } from '@/components/ui/FormSelect';
import { Button } from '@/components/ui/Button';
import { X, AlertCircle } from 'lucide-react';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const roleOptions = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'TA', label: 'Teaching Assistant (TA)' },
  { value: 'PROFESSOR', label: 'Professor' },
  { value: 'ADMIN', label: 'Administrator' },
];

export const CreateUserModal = ({ isOpen, onClose, onSuccess }: CreateUserModalProps) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      role: 'STUDENT',
    },
  });

  if (!isOpen) return null;

  const onSubmit = async (values: CreateUserInput) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Failed to create user');
      } else {
        reset();
        onSuccess();
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      {/* Modal Card */}
      <div className="bg-white rounded-brand-lg max-w-md w-full border border-slate-200 shadow-xl overflow-hidden p-6 relative animate-in fade-in zoom-in-95 duration-200">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-brand hover:bg-slate-50 cursor-pointer"
          aria-label="Close modal"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-900">Create New User</h2>
          <p className="text-xs text-slate-500 mt-1">Add a new user account with specified access role.</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 rounded-brand bg-rose-50 border border-rose-100 flex gap-2.5 text-xs text-rose-700 font-medium">
            <AlertCircle className="h-4.5 w-4.5 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormInput
            label="Name"
            placeholder="John Doe"
            error={errors.name?.message}
            {...register('name')}
          />

          <FormInput
            label="Email Address"
            type="email"
            placeholder="johndoe@university.edu"
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
            label="Access Role"
            options={roleOptions}
            error={errors.role?.message}
            {...register('role')}
          />

          {/* Footer Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
            >
              Create Account
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
