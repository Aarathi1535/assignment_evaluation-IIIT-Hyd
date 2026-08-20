'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Clock,
  FileText,
  Eye,
  RefreshCw,
  Upload
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

interface BatchItem {
  batchId: string;
  examId: string | null;
  examTitle: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  totalFiles: number;
  totalSize: number;
  totalPageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BatchListViewProps {
  role: 'PROFESSOR' | 'ADMIN';
}

export default function BatchListView({ role }: BatchListViewProps) {
  const { data: session, status: sessionStatus } = useSession();
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryTrigger, setRetryTrigger] = useState(0);

  // Derived unauthenticated states
  const isUnauthenticated = sessionStatus === 'unauthenticated' || (sessionStatus !== 'loading' && !session);
  const displayError = isUnauthenticated ? 'You must be logged in to view batches.' : error;
  const displayLoading = sessionStatus === 'loading' || (loading && !isUnauthenticated);

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !session) return;

    const fetchBatches = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/ingest');
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            setError('Access denied. You do not have permissions to view batches.');
          } else {
            setError(`Failed to retrieve batches: ${res.statusText}`);
          }
          return;
        }

        const result = await res.json();
        if (result.success && result.data) {
          setBatches(result.data);
          setError('');
        } else {
          setError(result.message || 'Failed to retrieve batches.');
        }
      } catch (err) {
        console.error('Fetch batches error:', err);
        setError('Network error: Failed to connect to the server.');
      } finally {
        setLoading(false);
      }
    };

    fetchBatches();
  }, [sessionStatus, session, retryTrigger]);

  const handleRetry = () => {
    setRetryTrigger(prev => prev + 1);
  };

  if (displayLoading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-brand-primary" />
        <p className="text-sm font-semibold text-slate-500">Loading your batches...</p>
      </div>
    );
  }

  if (displayError) {
    return (
      <div className="max-w-md mx-auto py-12 font-sans">
        <Card className="border border-slate-200 shadow-md">
          <div className="flex flex-col items-center text-center space-y-4 p-6">
            <div className="p-3 rounded-full bg-rose-50 text-rose-600">
              <AlertCircle className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Failed to Load Batches</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              {displayError}
            </p>
            <div className="pt-4 flex gap-2 w-full">
              {!isUnauthenticated && (
                <Button onClick={handleRetry} className="flex-1">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  <span>Retry</span>
                </Button>
              )}
              <Link href={role === 'PROFESSOR' ? '/professor' : '/admin'} className="flex-1">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  <span>Dashboard</span>
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="max-w-xl mx-auto py-12 font-sans text-center">
        <Card className="border border-slate-200 shadow-sm p-8 flex flex-col items-center space-y-4">
          <div className="p-4 rounded-full bg-slate-50 text-slate-400">
            <FileText className="h-12 w-12" />
          </div>
          <h3 className="text-lg font-extrabold text-slate-800">No batches yet</h3>
          <p className="text-sm text-slate-500 max-w-sm">
            You haven&apos;t uploaded any answer script PDF or image ingestion batches yet.
          </p>
          <div className="pt-4">
            <Link href={role === 'PROFESSOR' ? '/professor/exams/upload' : '/admin/exams/upload'}>
              <Button className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                <span>Upload a batch</span>
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Status badge helper
  const renderStatusBadge = (status: BatchItem['status']) => {
    const config = {
      queued: { label: 'Queued', bg: 'bg-slate-100 text-slate-700 border-slate-200', icon: Clock },
      processing: { label: 'Processing', bg: 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse', icon: Loader2 },
      done: { label: 'Completed', bg: 'bg-emerald-50 text-emerald-700 border-emerald-250', icon: CheckCircle2 },
      failed: { label: 'Failed', bg: 'bg-rose-50 text-rose-700 border-rose-250', icon: AlertCircle }
    };

    const c = config[status] || config.queued;
    const Icon = c.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-2xs font-extrabold border ${c.bg}`}>
        <Icon className={`h-3.5 w-3.5 ${status === 'processing' ? 'animate-spin' : ''}`} />
        <span>{c.label}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Header and Back Link */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="space-y-1">
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Ingestion Batches</h2>
          <p className="text-xs text-slate-500 font-medium">Manage and review all uploaded script ingestion batches.</p>
        </div>
        <Link href={role === 'PROFESSOR' ? '/professor' : '/admin'}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            <span>Dashboard</span>
          </Button>
        </Link>
      </div>

      {/* Batch Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {batches.map((batch) => (
          <Card key={batch.batchId} className="border border-slate-200 hover:border-slate-350 hover:shadow-sm transition-all duration-200 bg-white flex flex-col justify-between overflow-hidden">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-3xs font-mono font-bold text-slate-400 select-all max-w-[60%] truncate">
                  {batch.batchId}
                </span>
                {renderStatusBadge(batch.status)}
              </div>

              <div>
                <h4 className="text-sm font-extrabold text-slate-800 truncate" title={batch.examTitle}>
                  {batch.examTitle}
                </h4>
                <p className="text-3xs text-slate-400 mt-1 font-semibold">
                  Uploaded: {new Date(batch.createdAt).toLocaleString()}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded border border-slate-100 text-center">
                <div>
                  <div className="text-4xs text-slate-400 font-extrabold uppercase tracking-wide">Files</div>
                  <div className="text-sm font-black text-slate-700">{batch.totalFiles}</div>
                </div>
                <div>
                  <div className="text-4xs text-slate-400 font-extrabold uppercase tracking-wide">Total Pages</div>
                  <div className="text-sm font-black text-slate-700">{batch.totalPageCount}</div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 bg-slate-50/50 p-3 px-5 flex justify-end">
              <Link href={role === 'PROFESSOR' ? `/professor/exams/batches/${batch.batchId}` : `/admin/exams/batches/${batch.batchId}`} className="w-full">
                <Button size="sm" className="w-full flex items-center justify-center gap-1.5 text-2xs uppercase tracking-wider font-black">
                  <Eye className="h-3.5 w-3.5" />
                  <span>View Details</span>
                </Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
