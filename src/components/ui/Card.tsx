import React, { HTMLAttributes } from 'react';

export const Card = React.forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className = '', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`bg-white border border-slate-200 rounded-brand-lg p-5 shadow-sm ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Card.displayName = 'Card';

export const CardHeader = ({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={`mb-4 ${className}`} {...props}>
    {children}
  </div>
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = ({ className = '', children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={`text-lg font-bold text-slate-900 ${className}`} {...props}>
    {children}
  </h3>
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = ({ className = '', children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={`text-sm text-slate-600 mt-1 ${className}`} {...props}>
    {children}
  </p>
);
CardDescription.displayName = 'CardDescription';

export const CardContent = ({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={`${className}`} {...props}>
    {children}
  </div>
);
CardContent.displayName = 'CardContent';

export const CardFooter = ({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={`mt-5 pt-4 border-t border-slate-100 ${className}`} {...props}>
    {children}
  </div>
);
CardFooter.displayName = 'CardFooter';
