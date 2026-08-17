'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { 
  AlertCircle, 
  ArrowLeft, 
  Loader2, 
  CheckCircle2, 
  HelpCircle,
  FileText
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { EmptyState } from './ui/EmptyState';
import { 
  ScriptInfo, 
  validateDataIntegrity, 
  checkOperatorPermission, 
  getIdentificationBadgeConfig 
} from '@/utils/previewHelpers';

interface BatchPreviewViewProps {
  batchId: string;
  role: 'PROFESSOR' | 'ADMIN';
}

interface ThumbnailImageProps {
  src: string;
  alt: string;
}

export function ThumbnailImage({ src, alt }: ThumbnailImageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center bg-slate-100 border border-slate-200 rounded-brand p-3 h-44 text-slate-400 text-center select-none">
        <AlertCircle className="h-6 w-6 text-rose-500 mb-1 shrink-0" />
        <span className="text-3xs font-extrabold uppercase tracking-wide text-slate-500">Failed to load</span>
        <span className="text-4xs text-slate-400 mt-0.5 leading-none">Thumbnail unavailable</span>
      </div>
    );
  }

  return (
    <div className="relative border border-slate-200 rounded-brand overflow-hidden bg-slate-50 flex items-center justify-center h-44 transition-all duration-200 hover:shadow-sm">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80">
          <Loader2 className="h-5 w-5 animate-spin text-brand-primary/45" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={`object-contain max-h-full max-w-full transition-opacity duration-300 ${
          loading ? 'opacity-0' : 'opacity-100'
        }`}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
    </div>
  );
}

export default function BatchPreviewView({ batchId, role }: BatchPreviewViewProps) {
  const { data: session, status: sessionStatus } = useSession();
  const [scripts, setScripts] = useState<ScriptInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [duplicatePages, setDuplicatePages] = useState<string[]>([]);

  const sessionUser = session?.user;
  const userRole = sessionUser?.role?.toUpperCase();
  const isAuthorized = checkOperatorPermission(userRole);
  const isUnauthorizedUser = sessionStatus !== 'loading' && (!session || !isAuthorized);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (isUnauthorizedUser) return;

    const fetchScripts = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/ingest/${batchId}/scripts`);

        if (res.status === 401 || res.status === 403) {
          setUnauthorized(true);
          setLoading(false);
          return;
        }

        if (!res.ok) {
          if (res.status === 404) {
            setError('Batch not found or access denied.');
          } else {
            setError(`Error retrieving batch scripts: ${res.statusText}`);
          }
          setLoading(false);
          return;
        }

        const result = await res.json();
        if (result.success && result.data) {
          setScripts(result.data);
          const integrity = validateDataIntegrity(result.data);
          setDuplicatePages(integrity.duplicatePageIds);
          setError('');
        } else {
          setError(result.message || 'Failed to retrieve batch scripts.');
        }
      } catch (err) {
        console.error('Fetch scripts error:', err);
        setError('Network error: Failed to connect to the server.');
      } finally {
        setLoading(false);
      }
    };

    fetchScripts();
  }, [batchId, session, sessionStatus, isAuthorized, isUnauthorizedUser]);

  if (sessionStatus === 'loading' || (loading && !error && !unauthorized && !isUnauthorizedUser)) {
    return (
      <div className="py-24 flex flex-col items-center justify-center space-y-4">
        <LoadingSpinner size="lg" />
        <p className="text-sm font-semibold text-slate-500">Loading batch preview...</p>
      </div>
    );
  }

  if (unauthorized || isUnauthorizedUser) {
    return (
      <div className="max-w-md mx-auto py-12 font-sans">
        <Card className="border border-slate-200 shadow-md">
          <div className="flex flex-col items-center text-center space-y-4 p-4">
            <div className="p-3 rounded-full bg-rose-50 text-rose-600">
              <AlertCircle className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Unauthorized Access</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              You do not have the required permissions to view this batch preview. This page is restricted to operators.
            </p>
            <div className="pt-4 w-full">
              <Link href={role === 'PROFESSOR' ? '/professor' : '/admin'}>
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

  if (error) {
    return (
      <div className="max-w-md mx-auto py-12 font-sans">
        <Card className="border border-slate-200 shadow-md">
          <div className="flex flex-col items-center text-center space-y-4 p-4">
            <div className="p-3 rounded-full bg-rose-50 text-rose-600">
              <AlertCircle className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Failed to Load Preview</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              {error}
            </p>
            <div className="pt-4 w-full">
              <Link href={role === 'PROFESSOR' ? `/professor/exams/batches/${batchId}` : `/admin/exams/batches/${batchId}`}>
                <Button className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  <span>Back to Ingestion Status</span>
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (scripts.length === 0) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 font-sans">
        <EmptyState
          title="No Scripts Found"
          description="There are no processed answer scripts associated with this batch yet."
          icon={FileText}
          action={
            <Link href={role === 'PROFESSOR' ? `/professor/exams/batches/${batchId}` : `/admin/exams/batches/${batchId}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                <span>Ingestion Status</span>
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 font-sans">
      
      {/* Header and Back Action */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="space-y-1">
          <div className="text-2xs font-extrabold text-slate-400 uppercase tracking-wider">Processed Batch Preview</div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight font-mono">{batchId}</h2>
        </div>
        <Link href={role === 'PROFESSOR' ? `/professor/exams/batches/${batchId}` : `/admin/exams/batches/${batchId}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            <span>Batch Status</span>
          </Button>
        </Link>
      </div>

      {/* Data Integrity Warning Banner */}
      {duplicatePages.length > 0 && (
        <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-brand p-4 text-rose-950 text-sm font-semibold shadow-2xs leading-relaxed">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5 animate-pulse" />
          <div>
            <p className="font-extrabold text-rose-900">Data Integrity Violation Detected</p>
            <p className="text-xs text-rose-700 mt-0.5 font-medium leading-relaxed">
              Assertion Failure: The same Page ID was found mapped across multiple scripts. 
              Duplicate page ID(s): <span className="font-mono bg-rose-100 px-1 py-0.5 rounded text-rose-800 text-3xs font-bold">{duplicatePages.join(', ')}</span>.
              This indicates an inconsistent database state. Please contact the administrator.
            </p>
          </div>
        </div>
      )}

      {/* Script Grouping Cards */}
      <div className="space-y-6">
        {scripts.map((script, index) => {
          const badgeConfig = getIdentificationBadgeConfig(script);
          const isIdentified = badgeConfig.variant === 'success';

          return (
            <Card key={script._id} className="shadow-sm border border-slate-200 overflow-hidden bg-white p-5 hover:border-slate-300 transition-colors">
              {/* Script Card Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4 mb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-md font-black text-slate-800">
                      Script #{index + 1}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-extrabold bg-slate-100 text-slate-700 border border-slate-200">
                      <FileText className="h-3 w-3 text-slate-400" />
                      <span>Pages {script.startPageNumber} - {script.endPageNumber} ({script.pageCount} total)</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono tracking-tight">ID: {script._id}</p>
                </div>

                {/* Identity status display */}
                <div>
                  <span className={`inline-flex items-start md:items-center gap-2 px-3 py-1.5 rounded-brand text-xs font-bold border transition-colors ${
                    isIdentified 
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                      : 'bg-amber-50 text-amber-900 border-amber-250'
                  }`}>
                    {isIdentified ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <HelpCircle className="h-4 w-4 shrink-0 text-amber-600" />
                    )}
                    <div className="flex flex-col md:flex-row md:items-center gap-0.5 md:gap-2">
                      <span className="uppercase tracking-wider text-2xs font-extrabold">{badgeConfig.label}</span>
                      <span className="text-3xs font-semibold md:border-l md:border-current md:pl-2 leading-none mt-0.5 md:mt-0 opacity-90">
                        {badgeConfig.description}
                      </span>
                    </div>
                  </span>
                </div>
              </div>

              {/* Pages Grid */}
              {(!script.pages || script.pages.length === 0) ? (
                <div className="text-center py-6 text-slate-400 text-xs font-semibold border border-dashed border-slate-200 rounded-brand bg-slate-50/50">
                  No pages associated with this script.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {script.pages.map((page) => (
                    <div key={page._id} className="group relative flex flex-col space-y-1.5">
                      <ThumbnailImage 
                        src={page.thumbnailUrl} 
                        alt={`Page ${page.pageNumber}`} 
                      />
                      <div className="flex items-center justify-between text-2xs font-bold text-slate-500 px-1">
                        <span>Page {page.pageNumber}</span>
                        {page.fileIndex !== undefined && (
                          <span className="text-slate-400 font-mono text-3xs font-semibold">File #{page.fileIndex}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
