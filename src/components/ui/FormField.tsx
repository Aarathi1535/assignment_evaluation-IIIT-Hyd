import React, { HTMLAttributes } from 'react';

export interface FormFieldProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
  error?: string;
}

export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ children, label, error, className = '', ...props }, ref) => {
    return (
      <div ref={ref} className={`space-y-1.5 w-full ${className}`} {...props}>
        {label && (
          <label className="text-sm font-bold text-slate-850">
            {label}
          </label>
        )}
        {children}
        {error && (
          <p className="text-xs font-semibold text-rose-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);

FormField.displayName = 'FormField';
