'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  Clock, 
  ArrowLeft,
  HelpCircle
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

interface IngestionJobData {
  batchId: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  totalPages: number;
  processedPages: number;
  failedPages: number;
  scriptCount?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  failureReason?: string | null;
}

interface BatchStatusViewProps {
  batchId: string;
  role: 'PROFESSOR' | 'ADMIN';
}

export default function BatchStatusView({ batchId, role }: BatchStatusViewProps) {
  const [job, setJob] = useState<IngestionJobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // State for dynamic duration tracker
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/ingest/${batchId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('Batch not found or access denied.');
          } else {
            setError(`Error retrieving status: ${res.statusText}`);
          }
          setLoading(false);
          return;
        }

        const result = await res.json();
        if (result.success && result.data) {
          if (!isMounted) return;
          setJob(result.data);
          setError('');
          setLoading(false);

          const status = result.data.status;
          if (status === 'done' || status === 'failed') {
            // Stop polling once terminal state is reached
            if (pollTimerRef.current) {
              clearTimeout(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            return;
          }

          // Continue polling
          pollTimerRef.current = setTimeout(fetchStatus, 2000);
        } else {
          setError(result.message || 'Failed to retrieve ingestion status.');
          setLoading(false);
        }
      } catch (err) {
        console.error('Fetch status connection error:', err);
        // Continue polling despite temporary network issues
        pollTimerRef.current = setTimeout(fetchStatus, 2500);
      }
    };

    fetchStatus();

    return () => {
      isMounted = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [batchId]);

  // Set up duration tracking timer
  useEffect(() => {
    if (!job) return;

    const calculateElapsed = () => {
      const start = job.startedAt || job.createdAt;
      if (!start) return 0;
      
      const startTime = new Date(start).getTime();
      const endTime = job.completedAt ? new Date(job.completedAt).getTime() : Date.now();
      
      const diffSecs = Math.max(0, Math.floor((endTime - startTime) / 1000));
      setElapsedSeconds(diffSecs);
    };

    calculateElapsed();

    // Only update dynamically if in non-terminal states
    if (job.status === 'queued' || job.status === 'processing') {
      durationTimerRef.current = setInterval(calculateElapsed, 1000);
    } else {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }

    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [job]);

  // Format elapsed seconds to human readable form
  const getDurationString = () => {
    if (elapsedSeconds <= 0) return '0 seconds';
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    
    if (mins > 0) {
      return `${mins} minute${mins !== 1 ? 's' : ''} ${secs} second${secs !== 1 ? 's' : ''}`;
    }
    return `${secs} second${secs !== 1 ? 's' : ''}`;
  };

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-brand-primary" />
        <p className="text-sm font-semibold text-slate-500">Retrieving ingestion details...</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-md mx-auto py-12">
        <Card className="border border-slate-200 shadow-md">
          <div className="flex flex-col items-center text-center space-y-4 p-4">
            <div className="p-3 rounded-full bg-rose-50 text-rose-600">
              <AlertCircle className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Access Denied or Not Found</h3>
            <p className="text-sm text-slate-650 leading-relaxed">
              {error || 'Unable to locate ingestion details. You may not be authorized to view this batch.'}
            </p>
            <div className="pt-4 w-full">
              <Link href={role === 'PROFESSOR' ? '/professor/exams' : '/admin'}>
                <Button className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  <span>Back to Dashboard</span>
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const { status, totalPages, processedPages, failedPages, scriptCount, failureReason } = job;
  const progressPercent = totalPages > 0 ? Math.round((processedPages / totalPages) * 100) : 0;
  
  // Status styling configurations
  const statusConfig = {
    queued: {
      label: 'Queued',
      bg: 'bg-slate-100 text-slate-700 border-slate-250',
      icon: Clock,
      pulse: false
    },
    processing: {
      label: 'Processing',
      bg: 'bg-brand-primary/10 text-brand-primary border-brand-primary/20',
      icon: Loader2,
      pulse: true
    },
    done: {
      label: 'Completed',
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-250',
      icon: CheckCircle2,
      pulse: false
    },
    failed: {
      label: 'Failed',
      bg: 'bg-rose-50 text-rose-700 border-rose-250',
      icon: AlertCircle,
      pulse: false
    }
  };

  const currentStatus = statusConfig[status] || statusConfig.queued;
  const StatusIcon = currentStatus.icon;

  const isStuck = (status === 'queued' || status === 'processing') && elapsedSeconds > 180;

  return (
    <div className="max-w-3xl mx-auto space-y-6 font-sans">
      
      {/* Stuck Processing Warn Banner */}
      {isStuck && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-brand p-4 text-amber-900 text-sm font-semibold shadow-2xs leading-relaxed animate-pulse">
          <HelpCircle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p className="font-extrabold">Batch processing is taking longer than expected ({getDurationString()})</p>
            <p className="text-xs text-amber-700 mt-0.5 font-medium">
              This can happen when processing multiple high-resolution images/PDFs, or if system ingestion workers are reclaiming other jobs.
              Your request is still in the queue and will update automatically.
            </p>
          </div>
        </div>
      )}

      {/* Failure Info Alert */}
      {status === 'failed' && (
        <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-brand p-4 text-rose-900 text-sm font-semibold shadow-2xs leading-relaxed">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
          <div>
            <p className="font-extrabold">Ingestion Pipeline Failed</p>
            <p className="text-xs text-rose-700 mt-0.5 font-medium">
              {failureReason || 'An unexpected worker crash occurred during PDF splitting or QR identification.'}
            </p>
          </div>
        </div>
      )}

      <Card className="shadow-md border border-slate-200 bg-white p-6 space-y-6">
        {/* Header Metadata */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="space-y-1">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Batch Identity</div>
            <h3 className="text-lg font-black text-slate-800 tracking-tight font-mono">{batchId}</h3>
          </div>
          <div>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${currentStatus.bg}`}>
              <StatusIcon className={`h-3.5 w-3.5 ${currentStatus.pulse ? 'animate-spin' : ''}`} />
              <span>{currentStatus.label}</span>
            </span>
          </div>
        </div>

        {/* Ingestion Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-brand text-center space-y-1">
            <div className="text-2xs font-extrabold text-slate-500 uppercase tracking-wider">Total Pages</div>
            <div className="text-2xl font-black text-slate-900">{totalPages}</div>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-brand text-center space-y-1">
            <div className="text-2xs font-extrabold text-slate-500 uppercase tracking-wider">Processed</div>
            <div className="text-2xl font-black text-emerald-600">{processedPages}</div>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-brand text-center space-y-1">
            <div className="text-2xs font-extrabold text-slate-500 uppercase tracking-wider">Failed Pages</div>
            <div className="text-2xl font-black text-rose-600">{failedPages}</div>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-brand text-center space-y-1">
            <div className="text-2xs font-extrabold text-slate-500 uppercase tracking-wider">Scripts Created</div>
            <div className="text-2xl font-black text-brand-primary">{scriptCount !== undefined ? scriptCount : '--'}</div>
          </div>
        </div>

        {/* Progress Bar */}
        {status !== 'failed' && (
          <div className="space-y-2 pt-2">
            <div className="flex justify-between text-xs font-bold text-slate-500">
              <span>Overall Page Processing</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="relative w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div 
                className={`absolute inset-y-0 left-0 transition-all duration-500 rounded-full ${
                  status === 'done' ? 'bg-emerald-500' : 'bg-brand-primary'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Time and Duration Information */}
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 bg-slate-50/50 p-3.5 border border-slate-100 rounded-brand">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            <span>Processing Duration:</span>
          </div>
          <span className="font-extrabold text-slate-800">{getDurationString()}</span>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <Link href={role === 'PROFESSOR' ? '/professor/exams' : '/admin'}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              <span>Dashboard</span>
            </Button>
          </Link>

          {(status === 'done' || status === 'failed') && (
            <div className="flex gap-2">
              {status === 'done' && (
                <Link href={role === 'PROFESSOR' ? `/professor/exams/batches/${batchId}/preview` : `/admin/exams/batches/${batchId}/preview`}>
                  <Button variant="primary" size="sm">
                    <span>Preview Scripts</span>
                  </Button>
                </Link>
              )}
              <Link href={role === 'PROFESSOR' ? '/professor/exams/upload' : '/admin/exams/upload'}>
                <Button variant={status === 'done' ? 'outline' : 'primary'} size="sm">
                  <span>Upload Another</span>
                </Button>
              </Link>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
