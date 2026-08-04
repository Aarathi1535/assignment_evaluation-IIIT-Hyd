'use client';

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { X, UploadCloud, AlertCircle, CheckCircle2, ChevronRight, HelpCircle } from 'lucide-react';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ImportSummary {
  imported: number;
  failed: number;
  errors: { row: number; email: string; errors: string[] }[];
}

export const CsvImportModal = ({ isOpen, onClose, onSuccess }: CsvImportModalProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSummary(null);
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
        setError('Please select a valid CSV file.');
        setFile(null);
      } else {
        setFile(selectedFile);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setError(null);
    setSummary(null);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      if (droppedFile.type !== 'text/csv' && !droppedFile.name.endsWith('.csv')) {
        setError('Please select a valid CSV file.');
        setFile(null);
      } else {
        setFile(droppedFile);
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setSummary(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/users/import', {
        method: 'POST',
        body: formData,
      });

      const body = await res.json();

      if (!res.ok) {
        setError(body.message || 'CSV Import failed');
      } else {
        setSummary(body.data);
        if (body.data.imported > 0) {
          onSuccess();
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setError(null);
    setSummary(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      {/* Modal Container */}
      <div className="bg-white rounded-brand-lg max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden p-6 relative animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-brand hover:bg-slate-50 cursor-pointer"
          aria-label="Close modal"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title */}
        <div className="mb-4">
          <h2 className="text-xl font-bold text-slate-900">Import Users from CSV</h2>
          <p className="text-xs text-slate-500 mt-1">Bulk create users using an uploaded template spreadsheet.</p>
        </div>

        {/* Drag and Drop Zone */}
        {!summary && (
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-brand-lg p-8 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
              file
                ? 'border-brand-primary/50 bg-brand-primary/5'
                : 'border-slate-300 hover:border-brand-primary bg-slate-50 hover:bg-slate-50/50'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".csv"
              className="hidden"
            />
            <UploadCloud className={`h-10 w-10 ${file ? 'text-brand-primary' : 'text-slate-400'}`} />
            <p className="text-sm font-semibold text-slate-700 text-center">
              {file ? file.name : 'Click or drag CSV here to upload'}
            </p>
            <p className="text-3xs text-slate-500 text-center uppercase tracking-wide font-bold">
              CSV file must contain columns: name, email, password, role
            </p>
          </div>
        )}

        {/* CSV Format Reference Helper */}
        {!file && !summary && (
          <div className="mt-3 p-3 rounded-brand bg-slate-50 border border-slate-200 text-2xs text-slate-650 flex gap-2">
            <HelpCircle className="h-4.5 w-4.5 text-slate-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-slate-700 block">Accepted Roles:</span>
              <span>ADMIN, PROFESSOR, TA, STUDENT</span>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mt-4 p-3 rounded-brand bg-rose-50 border border-rose-100 flex gap-2 text-xs text-rose-700 font-medium">
            <AlertCircle className="h-4.5 w-4.5 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Summary Screen */}
        {summary && (
          <div className="mt-4 flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-brand border border-emerald-100 bg-emerald-50/50 flex flex-col items-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 mb-1" />
                <span className="text-3xl font-black text-emerald-700">{summary.imported}</span>
                <span className="text-3xs font-bold text-emerald-600 uppercase tracking-wider mt-1">Successfully Imported</span>
              </div>
              <div className="p-4 rounded-brand border border-rose-100 bg-rose-50/50 flex flex-col items-center">
                <AlertCircle className="h-5 w-5 text-rose-600 mb-1" />
                <span className="text-3xl font-black text-rose-700">{summary.failed}</span>
                <span className="text-3xs font-bold text-rose-600 uppercase tracking-wider mt-1">Failed Rows</span>
              </div>
            </div>

            {/* Error logs */}
            {summary.errors.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Per-Row Failure Log</h3>
                <div className="border border-slate-200 rounded-brand-lg overflow-hidden max-h-48 overflow-y-auto bg-slate-50 p-2 divide-y divide-slate-100 text-2xs">
                  {summary.errors.map((err, idx) => (
                    <div key={idx} className="py-2 first:pt-1 last:pb-1 flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 font-bold text-slate-700">
                        <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />
                        <span>Row {err.row}</span>
                        {err.email && <span className="text-slate-505 font-medium">({err.email})</span>}
                      </div>
                      <ul className="list-disc list-inside text-rose-600 space-y-0.5 pl-4.5">
                        {err.errors.map((msg, mIdx) => (
                          <li key={mIdx}>{msg}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.errors.length === 0 && summary.imported > 0 && (
              <div className="p-3 rounded-brand bg-emerald-50 border border-emerald-100 flex gap-2 text-xs text-emerald-800 font-medium justify-center">
                All records imported successfully without errors!
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-6 shrink-0">
          {!summary ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleUpload}
                disabled={!file}
                isLoading={isLoading}
              >
                Upload & Process
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={handleClose}
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
