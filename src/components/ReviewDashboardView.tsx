'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { 
  AlertCircle, 
  ArrowLeft, 
  Loader2, 
  CheckCircle2, 
  HelpCircle, 
  FileText, 
  ShieldAlert, 
  Search, 
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { EmptyState } from './ui/EmptyState';
import { SearchableSelect } from './ui/SearchableSelect';
import { ThumbnailImage } from './BatchPreviewView';
import { getIdentificationBadgeConfig } from '@/utils/previewHelpers';

interface ReviewDashboardViewProps {
  examId: string;
  role: 'PROFESSOR' | 'ADMIN';
}

interface IngestionCounts {
  totalScripts: number;
  unmatched: number;
  blank: number;
  duplicate: number;
  conflict: number;
}

interface ScriptData {
  _id: string;
  exam: string;
  batchId: string;
  fileIndex: number;
  startPageNumber: number;
  endPageNumber: number;
  pageCount: number;
  identificationSource: 'QR' | 'OMR' | 'OPERATOR' | 'OCR' | null;
  identificationStatus: 'IDENTIFIED' | 'UNIDENTIFIED';
  needsManualId: boolean;
  manualIdReason: string | null;
  hasIdentificationConflict: boolean;
  student: string | null;
  pages: {
    _id: string;
    pageNumber: number;
    fileIndex: number;
    thumbnailUrl: string;
    nearBlank: boolean;
    isDuplicate: boolean;
    duplicateOf: string | null;
  }[];
  omrResolvedStudent?: {
    _id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  qrResolvedStudent?: {
    _id: string;
    name: string;
    email: string;
    role: string;
  } | null;
}

export default function ReviewDashboardView({ examId, role }: ReviewDashboardViewProps) {
  const { status: sessionStatus } = useSession();
  const [counts, setCounts] = useState<IngestionCounts | null>(null);
  const [activeCategory, setActiveCategory] = useState<'total' | 'unmatched' | 'blank' | 'duplicate' | 'conflict' | null>(null);
  const [scripts, setScripts] = useState<ScriptData[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);

  // Manual Identification States
  const [selectedScriptForId, setSelectedScriptForId] = useState<string | null>(null);
  const [roster, setRoster] = useState<{ id: string; name: string; email: string; rollNumber: string | null }[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [savingId, setSavingId] = useState(false);
  const [saveError, setSaveError] = useState('');

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/exams/${examId}/ingestion-summary`);
      
      if (res.status === 401 || res.status === 403) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }
      
      if (!res.ok) {
        throw new Error(`Failed to load review summary: ${res.statusText}`);
      }

      const json = await res.json();
      if (json.success && json.data) {
        setCounts(json.data.counts);
        // Default to total scripts category if it exists
        if (json.data.counts.totalScripts > 0) {
          setActiveCategory('total');
        }
      } else {
        throw new Error(json.message || 'Failed to parse review summary.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading ingestion review summary.');
    } finally {
      setLoading(false);
    }
  }, [examId]);

  const loadScriptsForCategory = useCallback(async (cat: 'total' | 'unmatched' | 'blank' | 'duplicate' | 'conflict') => {
    try {
      setLoadingScripts(true);
      setScripts([]);
      setSelectedScriptForId(null);
      const res = await fetch(`/api/exams/${examId}/ingestion-summary?category=${cat}`);
      if (!res.ok) {
        throw new Error(`Failed to retrieve category scripts: ${res.statusText}`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        setScripts(json.data.scripts || []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading scripts.');
    } finally {
      setLoadingScripts(false);
    }
  }, [examId]);

  const handleOpenIdentify = async (script: ScriptData) => {
    setSelectedScriptForId(script._id);
    setSelectedStudentId('');
    setSaveError('');

    if (roster.length > 0) return;

    try {
      setLoadingRoster(true);
      const res = await fetch(`/api/exams/${examId}/students`);
      if (!res.ok) {
        throw new Error(`Failed to fetch student roster: ${res.statusText}`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        setRoster(json.data);
      } else {
        throw new Error(json.message || 'Failed to fetch student roster');
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Error loading roster.');
    } finally {
      setLoadingRoster(false);
    }
  };

  const handleSaveIdentify = async (scriptId: string) => {
    if (!selectedStudentId) {
      setSaveError('Please select a student');
      return;
    }

    try {
      setSavingId(true);
      setSaveError('');

      const res = await fetch(`/api/answerscripts/${scriptId}/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: selectedStudentId })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || `Failed to save identification: ${res.statusText}`);
      }

      if (json.success && json.data) {
        setSelectedScriptForId(null);
        // Refresh counts and script lists
        await loadSummary();
        if (activeCategory) {
          await loadScriptsForCategory(activeCategory);
        }
      } else {
        throw new Error(json.message || 'Failed to save identification');
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Network error: Failed to save identification.');
    } finally {
      setSavingId(false);
    }
  };

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary();
  }, [sessionStatus, loadSummary]);

  useEffect(() => {
    if (activeCategory) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadScriptsForCategory(activeCategory);
    }
  }, [activeCategory, loadScriptsForCategory]);

  if (sessionStatus === 'loading' || loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center space-y-4">
        <LoadingSpinner size="lg" />
        <p className="text-sm font-semibold text-slate-500">Loading review dashboard...</p>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="max-w-md mx-auto py-12 font-sans">
        <Card className="border border-slate-200 shadow-md">
          <div className="flex flex-col items-center text-center space-y-4 p-4">
            <div className="p-3 rounded-full bg-rose-50 text-rose-600">
              <AlertCircle className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Unauthorized Access</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              You do not have permission to view this exam review dashboard.
            </p>
            <div className="pt-4 w-full">
              <Link href={role === 'PROFESSOR' ? '/professor/exams' : '/admin/exams/batches'}>
                <Button className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  <span>Back to Exams</span>
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (error && !counts) {
    return (
      <div className="max-w-md mx-auto py-12 font-sans">
        <Card className="border border-slate-200 shadow-md">
          <div className="flex flex-col items-center text-center space-y-4 p-4">
            <div className="p-3 rounded-full bg-rose-50 text-rose-600">
              <AlertCircle className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Failed to Load Dashboard</h3>
            <p className="text-sm text-slate-600 leading-relaxed">{error}</p>
            <Button onClick={loadSummary} className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" />
              <span>Retry</span>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const categoryConfigs = [
    {
      key: 'total' as const,
      label: 'Total Scripts',
      count: counts?.totalScripts ?? 0,
      icon: FileText,
      color: 'border-slate-200 hover:border-slate-400 bg-white text-slate-800'
    },
    {
      key: 'unmatched' as const,
      label: 'Unmatched',
      count: counts?.unmatched ?? 0,
      icon: Search,
      color: 'border-amber-200 hover:border-amber-400 bg-amber-50/20 text-amber-800'
    },
    {
      key: 'blank' as const,
      label: 'Blank Scripts',
      count: counts?.blank ?? 0,
      icon: FileText,
      color: 'border-blue-200 hover:border-blue-400 bg-blue-50/20 text-blue-800'
    },
    {
      key: 'duplicate' as const,
      label: 'Duplicates',
      count: counts?.duplicate ?? 0,
      icon: ShieldAlert,
      color: 'border-rose-200 hover:border-rose-400 bg-rose-50/20 text-rose-855'
    },
    {
      key: 'conflict' as const,
      label: 'ID Conflicts',
      count: counts?.conflict ?? 0,
      icon: AlertTriangle,
      color: 'border-violet-200 hover:border-violet-400 bg-violet-50/20 text-violet-855'
    }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6 font-sans">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="space-y-1">
          <div className="text-2xs font-extrabold text-slate-400 uppercase tracking-wider">Ingestion Summary Dashboard</div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Review Exam Ingest</h2>
        </div>
        <Link href={role === 'PROFESSOR' ? '/professor/exams' : '/admin/exams/batches'}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            <span>Back to Exams</span>
          </Button>
        </Link>
      </div>

      {/* Aggregate Counts Card Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {categoryConfigs.map((cfg) => {
          const Icon = cfg.icon;
          const isSelected = activeCategory === cfg.key;

          return (
            <button
              key={cfg.key}
              onClick={() => setActiveCategory(cfg.key)}
              className={`border-2 rounded-brand p-4 text-left transition-all duration-150 flex flex-col justify-between h-28 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-brand-primary/20 ${cfg.color} ${
                isSelected 
                  ? 'ring-2 ring-brand-primary scale-102 border-transparent shadow-sm'
                  : 'shadow-3xs'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-2xs font-extrabold uppercase tracking-wider opacity-75">{cfg.label}</span>
                <Icon className="h-4 w-4 opacity-60" />
              </div>
              <div className="text-3xl font-black tracking-tight">{cfg.count}</div>
            </button>
          );
        })}
      </div>

      {/* Drill-down Results Header */}
      {activeCategory && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-slate-50 border border-slate-250 rounded-brand p-4 shadow-3xs">
            <div>
              <span className="text-xs font-bold text-slate-700 capitalize">
                Showing Category: {activeCategory} Scripts
              </span>
              <span className="ml-2 text-3xs font-extrabold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                {scripts.length} found
              </span>
            </div>
            <span className="text-3xs text-slate-500 font-semibold italic">Click a summary tile above to change category filter</span>
          </div>

          {/* Scripts List */}
          {loadingScripts ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="h-6 w-6 animate-spin text-brand-primary/60" />
              <p className="text-xs text-slate-500 font-semibold">Filtering scripts list...</p>
            </div>
          ) : scripts.length === 0 ? (
            <EmptyState
              title={`No scripts in ${activeCategory}`}
              description={`There are no processed scripts matching the ${activeCategory} criteria.`}
              icon={FileText}
            />
          ) : (
            <div className="space-y-6">
              {scripts.map((script, index) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const badgeConfig = getIdentificationBadgeConfig(script as any);
                const isIdentified = badgeConfig.variant === 'success';

                return (
                  <Card key={script._id} className="shadow-sm border border-slate-200 overflow-hidden bg-white p-5 hover:border-slate-350 transition-colors">
                    {/* Header */}
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
                        <p className="text-xs text-slate-400 font-mono tracking-tight">Batch: {script.batchId} | ID: {script._id}</p>
                      </div>

                      {/* Status and Edit */}
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-brand text-xs font-bold border transition-colors ${
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
                            <span className="text-3xs font-semibold md:border-l md:border-current md:pl-2 leading-none mt-0.5 md:mt-0 opacity-90 font-mono">
                              {badgeConfig.description}
                            </span>
                          </div>
                        </span>

                        {!isIdentified && selectedScriptForId !== script._id && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleOpenIdentify(script)}
                          >
                            Identify
                          </Button>
                        )}

                        <Link href={role === 'PROFESSOR' 
                          ? `/professor/exams/batches/${script.batchId}/preview?scriptId=${script._id}` 
                          : `/admin/exams/batches/${script.batchId}/preview?scriptId=${script._id}`}
                        >
                          <Button variant="outline" size="sm">
                            Edit Script Composition
                          </Button>
                        </Link>
                      </div>
                    </div>

                    {/* Inline Manual Identification Form */}
                    {selectedScriptForId === script._id && (
                      <div className="mb-6 p-4 border border-brand-primary/20 rounded-brand bg-slate-50/50 space-y-4 shadow-3xs font-sans">
                        <div className="flex items-center justify-between border-b border-slate-200/60 pb-3">
                          <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">Student Identification Helper</h4>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedScriptForId(null)}
                            disabled={savingId}
                          >
                            Cancel
                          </Button>
                        </div>

                        {loadingRoster ? (
                          <div className="flex items-center space-x-2 py-4 justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-brand-primary" />
                            <span className="text-xs text-slate-500 font-semibold pl-2">Loading student roster...</span>
                          </div>
                        ) : (
                          <div className="grid md:grid-cols-2 gap-6 pt-1">
                            <div className="space-y-4 border-r border-slate-200/60 pr-0 md:pr-6">
                              <div className="p-3.5 rounded bg-white border border-slate-200 space-y-1">
                                <div className="text-4xs text-slate-400 font-extrabold uppercase tracking-wider">Identified Student Info</div>
                                {script.student ? (
                                  <div className="text-xs font-bold text-slate-700">Currently bound student ID: {script.student}</div>
                                ) : (
                                  <div className="text-xs text-slate-500 font-semibold italic">Unmatched (No student bound)</div>
                                )}
                                {script.identificationSource && (
                                  <div className="text-4xs text-slate-400 mt-1 font-semibold uppercase">Source: {script.identificationSource}</div>
                                )}
                              </div>
                            </div>

                            <div className="space-y-4 flex flex-col justify-between">
                              <div className="space-y-4">
                                {saveError && (
                                  <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded p-3 text-rose-900 text-xs font-bold">
                                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                                    <span>{saveError}</span>
                                  </div>
                                )}
                                <div className="max-w-md">
                                  <SearchableSelect
                                    label="Select Student from Exam Roster"
                                    placeholder="Search student..."
                                    value={selectedStudentId}
                                    onChange={(val) => setSelectedStudentId(val)}
                                    options={roster.map(stud => ({
                                      value: stud.id,
                                      label: `${stud.name} (${stud.rollNumber || 'No Roll Number'}) — ${stud.email}`
                                    }))}
                                  />
                                </div>
                              </div>

                              <div className="pt-4 border-t border-slate-100 flex justify-end">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleSaveIdentify(script._id)}
                                  disabled={savingId || !selectedStudentId}
                                >
                                  {savingId ? 'Saving...' : 'Save Identification'}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Page Thumbnails Preview */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4 pt-2">
                      {script.pages.map((p) => (
                        <div key={p._id} className="space-y-1">
                          <ThumbnailImage 
                            src={p.thumbnailUrl} 
                            alt={`Page ${p.pageNumber}`} 
                          />
                          <div className="flex justify-between items-center text-5xs px-1 text-slate-500 font-extrabold uppercase">
                            <span>Pg {p.pageNumber}</span>
                            {p.nearBlank && (
                              <span className="bg-amber-100 text-amber-800 px-1 py-0.5 rounded tracking-wide scale-90">Blank</span>
                            )}
                            {p.isDuplicate && (
                              <span className="bg-rose-100 text-rose-800 px-1 py-0.5 rounded tracking-wide scale-90">Dup</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
