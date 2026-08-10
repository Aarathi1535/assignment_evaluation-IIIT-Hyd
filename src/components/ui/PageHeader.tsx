import React, { HTMLAttributes } from 'react';

export interface PageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
}

export const PageHeader = ({ title, description, className = '', children, ...props }: PageHeaderProps) => {
  return (
    <div className={`flex flex-col gap-1.5 md:flex-row md:justify-between md:items-center ${className}`} {...props}>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-slate-650 font-medium">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2 mt-4 md:mt-0">
          {children}
        </div>
      )}
    </div>
  );
};

PageHeader.displayName = 'PageHeader';
