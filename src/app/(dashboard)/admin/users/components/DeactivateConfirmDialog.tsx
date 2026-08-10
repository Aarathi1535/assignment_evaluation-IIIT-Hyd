'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { X, AlertTriangle } from 'lucide-react';

interface DeactivateConfirmDialogProps {
  isOpen: boolean;
  user: { id: string; name: string; email: string } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const DeactivateConfirmDialog = ({
  isOpen,
  user,
  onClose,
  onSuccess,
}: DeactivateConfirmDialogProps) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen || !user) return null;

  const handleDeactivate = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Failed to deactivate user');
      } else {
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
      {/* Dialog Box */}
      <div className="bg-white rounded-brand-lg max-w-sm w-full border border-slate-200 shadow-xl overflow-hidden p-6 relative animate-in fade-in zoom-in-95 duration-200">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-brand hover:bg-slate-50 cursor-pointer"
          aria-label="Close dialog"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Warning Icon & Header */}
        <div className="flex flex-col items-center text-center mt-2 mb-4">
          <div className="h-12 w-12 rounded-full bg-rose-50 flex items-center justify-center text-rose-600 mb-3 border border-rose-100 animate-pulse">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Deactivate Account</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-[280px]">
            Are you sure you want to deactivate <span className="font-bold text-slate-800">{user.name}</span> (<span className="text-slate-600">{user.email}</span>)?
          </p>
        </div>

        {/* Warning Alert */}
        <div className="mb-5 p-3 rounded-brand bg-amber-50 border border-amber-100 text-2xs text-amber-850 font-medium text-center">
          Deactivating this user will revoke all active access permissions and soft-delete them from directories.
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 rounded-brand bg-rose-50 border border-rose-100 text-xs text-rose-700 font-medium text-center">
            {error}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex gap-3 justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDeactivate}
            isLoading={isLoading}
            className="flex-1"
          >
            Deactivate
          </Button>
        </div>
      </div>
    </div>
  );
};
