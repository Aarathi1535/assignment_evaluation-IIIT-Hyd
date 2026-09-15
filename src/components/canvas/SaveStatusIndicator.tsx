import React from 'react';
import type { SaveStatus } from './types';

export interface SaveStatusIndicatorProps {
  /** Current save status */
  status: SaveStatus;
  /** Callback to trigger a manual retry when in error state */
  onRetry?: () => void;
  /** Optional custom error message tooltip or label */
  errorMessage?: string;
  /** Additional CSS class names */
  className?: string;
}

export const SaveStatusIndicator: React.FC<SaveStatusIndicatorProps> = ({
  status,
  onRetry,
  errorMessage = 'Failed to save annotations',
  className = '',
}) => {
  if (status === 'idle') {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium backdrop-blur transition-all duration-200 shadow-sm ${
        status === 'saving'
          ? 'bg-amber-50/90 text-amber-700 border border-amber-200'
          : status === 'saved'
          ? 'bg-emerald-50/90 text-emerald-700 border border-emerald-200'
          : 'bg-rose-50/90 text-rose-700 border border-rose-200'
      } ${className}`}
      data-testid="save-status-indicator"
      data-status={status}
      role={status === 'error' ? 'alert' : 'status'}
      aria-live={status === 'error' ? 'assertive' : 'polite'}
    >
      {status === 'saving' && (
        <>
          <svg
            className="w-3.5 h-3.5 animate-spin text-amber-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          <span>Saving...</span>
        </>
      )}

      {status === 'saved' && (
        <>
          <svg
            className="w-3.5 h-3.5 text-emerald-600"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span>Saved</span>
        </>
      )}

      {status === 'error' && (
        <>
          <svg
            className="w-3.5 h-3.5 text-rose-600 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            {errorMessage && <title>{errorMessage}</title>}
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>Save failed</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-1 px-1.5 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-semibold focus:outline-none focus:ring-1 focus:ring-rose-400 transition-colors"
              aria-label="Retry saving annotations"
            >
              Retry
            </button>
          )}
        </>
      )}
    </div>
  );
};
