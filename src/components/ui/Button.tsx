import React, { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = 'primary', size = 'md', isLoading, disabled, className = '', ...props }, ref) => {
    const baseStyle = 'inline-flex items-center justify-center gap-2 font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary disabled:opacity-50 disabled:pointer-events-none cursor-pointer';
    
    const variants = {
      primary: 'bg-brand-primary hover:bg-brand-primary/95 text-white shadow-sm hover:shadow-brand-primary/10',
      secondary: 'bg-brand-secondary hover:bg-brand-secondary/95 text-white shadow-sm hover:shadow-brand-secondary/10',
      outline: 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 focus:ring-brand-primary/20',
      ghost: 'hover:bg-slate-100 text-slate-700 hover:text-slate-900',
      destructive: 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm focus:ring-rose-500/20',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-xs rounded-brand-sm',
      md: 'px-4 py-2 text-sm rounded-brand',
      lg: 'px-5 py-2.5 text-base rounded-brand-lg',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-current" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
