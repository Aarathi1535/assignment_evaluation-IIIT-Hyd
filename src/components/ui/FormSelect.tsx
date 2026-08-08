import React, { SelectHTMLAttributes } from 'react';
import { FormField } from './FormField';

interface FormSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const FormSelect = React.forwardRef<HTMLSelectElement, FormSelectProps>(
  ({ label, error, options, className = '', ...props }, ref) => {
    return (
      <FormField label={label} error={error}>
        <select
          ref={ref}
          className={`w-full px-4 py-2 rounded-brand border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all ${
            error ? 'border-rose-500 focus:ring-rose-500/20 focus:border-rose-500' : ''
          } ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="text-slate-900 bg-white">
              {opt.label}
            </option>
          ))}
        </select>
      </FormField>
    );
  }
);

FormSelect.displayName = 'FormSelect';
