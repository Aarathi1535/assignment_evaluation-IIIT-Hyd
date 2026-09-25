import React from 'react';
import type { SaveStatus } from './types';

export interface SaveStatusIndicatorProps {
  /** Current save status */
  status: SaveStatus;
  /** Callback to trigger a manual retry when in error state */
  onRetry?: () => void;
  /** Callback to resolve conflict by keeping local changes */
  onKeepMine?: () => void;
  /** Callback to resolve conflict by loading server changes */
  onLoadServer?: () => void;
  /** Callback to restore recovered local draft (AE-172) */
  onRestoreDraft?: () => void;
  /** Callback to discard recovered local draft (AE-172) */
  onDiscardDraft?: () => void;
  /** Optional custom error message tooltip or label */
  errorMessage?: string;
  /** Additional CSS class names */
  className?: string;
}

export const SaveStatusIndicator: React.FC<SaveStatusIndicatorProps> = ({
  status,
  onRetry,
  onKeepMine,
  onLoadServer,
  onRestoreDraft,
  onDiscardDraft,
  errorMessage = 'Failed to save annotations',
  className = '',
}) => {
  if (status === 'idle') {
    return null;
  }

  const isAlertRole = status === 'error' || status === 'conflict';

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium backdrop-blur transition-all duration-200 shadow-sm ${
        status === 'saving' || status === 'syncing'
          ? 'bg-amber-50/90 text-amber-700 border border-amber-200'
          : status === 'saved'
          ? 'bg-emerald-50/90 text-emerald-700 border border-emerald-200'
          : status === 'submitted'
          ? 'bg-emerald-100/90 text-emerald-900 border border-emerald-300'
          : status === 'pending_sync'
          ? 'bg-sky-50/90 text-sky-800 border border-sky-300'
          : status === 'conflict'
          ? 'bg-amber-100/90 text-amber-900 border border-amber-400'
          : status === 'recovery_available'
          ? 'bg-indigo-50/90 text-indigo-900 border border-indigo-300'
          : 'bg-rose-50/90 text-rose-700 border border-rose-200'
      } ${className}`}
      data-testid="save-status-indicator"
      data-status={status}
      role={isAlertRole ? 'alert' : 'status'}
      aria-live={isAlertRole ? 'assertive' : 'polite'}
    >
      {(status === 'saving' || status === 'syncing') && (
        <>
          <svg
            className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0"
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
          <span>{status === 'syncing' ? 'Syncing...' : 'Saving...'}</span>
        </>
      )}

      {status === 'saved' && (
        <>
          <svg
            className="w-3.5 h-3.5 text-emerald-600 shrink-0"
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

      {status === 'submitted' && (
        <>
          <svg
            className="w-3.5 h-3.5 text-emerald-700 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-semibold">Submitted</span>
        </>
      )}

      {status === 'pending_sync' && (
        <>
          <svg
            className="w-3.5 h-3.5 text-sky-600 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
              clipRule="evenodd"
            />
          </svg>
          <span>Pending sync (Saved locally)</span>
        </>
      )}

      {status === 'conflict' && (
        <>
          <svg
            className="w-3.5 h-3.5 text-amber-700 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-semibold">Conflict detected</span>
          <div className="flex items-center gap-1 ml-1">
            {onKeepMine && (
              <button
                type="button"
                onClick={onKeepMine}
                className="px-1.5 py-0.5 rounded bg-amber-200/90 hover:bg-amber-300 text-amber-900 font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
                aria-label="Keep local changes and overwrite server"
              >
                Keep Mine
              </button>
            )}
            {onLoadServer && (
              <button
                type="button"
                onClick={onLoadServer}
                className="px-1.5 py-0.5 rounded bg-white hover:bg-amber-50 text-amber-800 border border-amber-300 font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
                aria-label="Discard local changes and load server version"
              >
                Load Server
              </button>
            )}
          </div>
        </>
      )}

      {status === 'recovery_available' && (
        <>
          <svg
            className="w-3.5 h-3.5 text-indigo-600 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-semibold">Unsaved work recovered</span>
          <div className="flex items-center gap-1 ml-1">
            {onRestoreDraft && (
              <button
                type="button"
                onClick={onRestoreDraft}
                className="px-1.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-400 transition-colors"
                aria-label="Restore recovered local draft"
              >
                Restore
              </button>
            )}
            {onDiscardDraft && (
              <button
                type="button"
                onClick={onDiscardDraft}
                className="px-1.5 py-0.5 rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold focus:outline-none focus:ring-1 focus:ring-slate-400 transition-colors"
                aria-label="Discard recovered local draft"
              >
                Discard
              </button>
            )}
          </div>
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
