import React, { InputHTMLAttributes } from 'react';
import { FormField } from './FormField';
import { Input } from './Input';

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <FormField label={label} error={error}>
        <Input ref={ref} error={!!error} className={className} {...props} />
      </FormField>
    );
  }
);

FormInput.displayName = 'FormInput';
