import React, { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean | string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={`w-full px-4 py-2 rounded-brand border border-slate-300 bg-white text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all ${
          error ? 'border-rose-500 focus:ring-rose-500/20 focus:border-rose-500' : ''
        } ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
