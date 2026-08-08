import React from 'react';
import { Loader2 } from 'lucide-react';

export interface LoadingSpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner = ({ className = '', size = 'md' }: LoadingSpinnerProps) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <div className={`flex justify-center items-center ${className}`}>
      <Loader2 className={`${sizeClasses[size]} animate-spin text-brand-primary`} />
    </div>
  );
};

LoadingSpinner.displayName = 'LoadingSpinner';
