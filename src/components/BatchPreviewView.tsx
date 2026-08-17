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
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Plus
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
import { SearchableSelect } from './ui/SearchableSelect';

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

  const [filterUnidentified, setFilterUnidentified] = useState(false);
  const [selectedScriptForId, setSelectedScriptForId] = useState<string | null>(null);
  const [rosterMap, setRosterMap] = useState<Record<string, { id: string; name: string; email: string; rollNumber: string | null }[]>>({});
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [savingId, setSavingId] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Correction UI states
  const [activeScriptIdForReorder, setActiveScriptIdForReorder] = useState<string | null>(null);
  const [reorderPageIds, setReorderPageIds] = useState<string[]>([]);
  const [activeScriptIdForSplit, setActiveScriptIdForSplit] = useState<string | null>(null);
  const [splitPoints, setSplitPoints] = useState<Set<number>>(new Set());
  const [activeScriptIdForMerge, setActiveScriptIdForMerge] = useState<string | null>(null);
  const [mergeTargetScriptId, setMergeTargetScriptId] = useState('');
  const [activePageIdForMove, setActivePageIdForMove] = useState<string | null>(null);
  const [moveTargetScriptId, setMoveTargetScriptId] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState('');

  // Extracted script fetching
  const fetchScripts = useCallback(async () => {
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
  }, [batchId]);

  const handleStartReorder = (script: ScriptInfo) => {
    setActiveScriptIdForReorder(script._id);
    setReorderPageIds(script.pages.map(p => p._id));
    setCorrectionError('');
  };

  const handleShiftPage = (index: number, direction: 'left' | 'right') => {
    setReorderPageIds(prev => {
      const next = [...prev];
      const targetIndex = direction === 'left' ? index - 1 : index + 1;
      if (targetIndex >= 0 && targetIndex < next.length) {
        const temp = next[index];
        next[index] = next[targetIndex];
        next[targetIndex] = temp;
      }
      return next;
    });
  };

  const handleSaveReorder = async (script: ScriptInfo) => {
    try {
      setSavingCorrection(true);
      setCorrectionError('');
      const res = await fetch(`/api/ingest/${batchId}/scripts/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptId: script._id,
          version: script.__v ?? 0,
          orderedPageIds: reorderPageIds
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || 'Failed to reorder pages');
      }
      await fetchScripts();
      setActiveScriptIdForReorder(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error reordering pages';
      setCorrectionError(msg);
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleStartSplit = (script: ScriptInfo) => {
    setActiveScriptIdForSplit(script._id);
    setSplitPoints(new Set());
    setCorrectionError('');
  };

  const handleToggleSplitPoint = (index: number) => {
    setSplitPoints(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleSaveSplit = async (script: ScriptInfo) => {
    try {
      setSavingCorrection(true);
      setCorrectionError('');

      const groups: string[][] = [];
      let currentGroup: string[] = [];

      for (let i = 0; i < script.pages.length; i++) {
        currentGroup.push(script.pages[i]._id);
        if (splitPoints.has(i)) {
          groups.push(currentGroup);
          currentGroup = [];
        }
      }
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }

      if (groups.length < 2) {
        throw new Error('Please add at least one split point to split the script.');
      }

      const res = await fetch(`/api/ingest/${batchId}/scripts/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptId: script._id,
          version: script.__v ?? 0,
          groups
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || 'Failed to split script');
      }
      await fetchScripts();
      setActiveScriptIdForSplit(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error splitting script';
      setCorrectionError(msg);
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleStartMerge = (script: ScriptInfo) => {
    setActiveScriptIdForMerge(script._id);
    setMergeTargetScriptId('');
    setCorrectionError('');
  };

  const handleSaveMerge = async (script: ScriptInfo) => {
    if (!mergeTargetScriptId) {
      setCorrectionError('Please select a target script to merge into.');
      return;
    }

    const targetScript = scripts.find(s => s._id === mergeTargetScriptId);
    if (!targetScript) {
      setCorrectionError('Target script not found.');
      return;
    }

    try {
      setSavingCorrection(true);
      setCorrectionError('');

      const res = await fetch(`/api/ingest/${batchId}/scripts/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceScriptId: script._id,
          targetScriptId: mergeTargetScriptId,
          versions: {
            [script._id]: script.__v ?? 0,
            [mergeTargetScriptId]: targetScript.__v ?? 0
          }
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || 'Failed to merge scripts');
      }
      await fetchScripts();
      setActiveScriptIdForMerge(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error merging scripts';
      setCorrectionError(msg);
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleStartMovePage = (pageId: string) => {
    setActivePageIdForMove(pageId);
    setMoveTargetScriptId('');
    setCorrectionError('');
  };

  const handleSaveMovePage = async (script: ScriptInfo, pageId: string) => {
    if (!moveTargetScriptId) {
      setCorrectionError('Please select a target script.');
      return;
    }

    const targetScript = scripts.find(s => s._id === moveTargetScriptId);
    if (!targetScript) {
      setCorrectionError('Target script not found.');
      return;
    }

    try {
      setSavingCorrection(true);
      setCorrectionError('');

      const res = await fetch(`/api/ingest/${batchId}/scripts/remap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId,
          targetScriptId: moveTargetScriptId,
          versions: {
            [script._id]: script.__v ?? 0,
            [moveTargetScriptId]: targetScript.__v ?? 0
          }
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || 'Failed to move page');
      }
      await fetchScripts();
      setActivePageIdForMove(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error moving page';
      setCorrectionError(msg);
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleOpenIdentify = async (scriptId: string, examId: string) => {
    setSelectedScriptForId(scriptId);
    setSelectedStudentId('');
    setSaveError('');

    if (rosterMap[examId]) {
      return;
    }

    try {
      setLoadingRoster(true);
      const res = await fetch(`/api/exams/${examId}/students`);
      if (!res.ok) {
        throw new Error(`Failed to fetch student roster: ${res.statusText}`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        setRosterMap(prev => ({ ...prev, [examId]: json.data }));
      } else {
        throw new Error(json.message || 'Failed to fetch student roster');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Error loading roster.';
      setSaveError(errMsg);
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
        const updatedScript = json.data;
        setScripts(prev => prev.map(s => s._id === scriptId ? {
          ...s,
          student: updatedScript.student,
          candidateStudentId: updatedScript.candidateStudentId,
          identificationSource: updatedScript.identificationSource,
          identificationStatus: updatedScript.identificationStatus,
          needsManualId: updatedScript.needsManualId,
          manualIdReason: updatedScript.manualIdReason
        } : s));
        setSelectedScriptForId(null);
      } else {
        throw new Error(json.message || 'Failed to save identification');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Network error: Failed to save identification.';
      setSaveError(errMsg);
    } finally {
      setSavingId(false);
    }
  };

  const sessionUser = session?.user;
  const userRole = sessionUser?.role?.toUpperCase();
  const isAuthorized = checkOperatorPermission(userRole);
  const isUnauthorizedUser = sessionStatus !== 'loading' && (!session || !isAuthorized);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (isUnauthorizedUser) return;

    const timer = setTimeout(() => {
      fetchScripts();
    }, 0);
    return () => clearTimeout(timer);
  }, [sessionStatus, isUnauthorizedUser, fetchScripts]);

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

  const filteredScripts = filterUnidentified
    ? scripts.filter(s => s.identificationStatus !== 'IDENTIFIED' || s.needsManualId)
    : scripts;

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

      {/* Filtering Options */}
      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-brand p-4 shadow-3xs">
        <span className="text-xs font-bold text-slate-700">Filter options</span>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-extrabold text-slate-600">
          <input
            type="checkbox"
            checked={filterUnidentified}
            onChange={(e) => setFilterUnidentified(e.target.checked)}
            className="rounded border-slate-350 text-brand-primary focus:ring-brand-primary/20 cursor-pointer h-4 w-4"
          />
          <span>Show only unidentified scripts requiring review</span>
        </label>
      </div>

      {/* Script Grouping Cards */}
      <div className="space-y-6">
        {filteredScripts.map((script, index) => {
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
                <div className="flex items-center gap-3">
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

                  {!isIdentified && selectedScriptForId !== script._id && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleOpenIdentify(script._id, script.exam)}
                      disabled={savingCorrection || activeScriptIdForReorder !== null || activeScriptIdForSplit !== null || activeScriptIdForMerge !== null || activePageIdForMove !== null}
                    >
                      Identify
                    </Button>
                  )}
                </div>
              </div>

              {/* Manual Identification Form */}
              {selectedScriptForId === script._id && (
                <div className="mb-6 p-4 border border-brand-primary/20 rounded-brand bg-slate-50/50 space-y-4 shadow-3xs">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">Manual Student Identification</h4>
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
                      <span className="text-xs text-slate-500 font-semibold pl-2">Loading exam student roster...</span>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {saveError && (
                        <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-brand p-3 text-rose-900 text-xs font-bold leading-normal">
                          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                          <span>{saveError}</span>
                        </div>
                      )}

                      <div className="max-w-md">
                        <SearchableSelect
                          label="Select Student from Exam Roster"
                          placeholder="Search student by name, roll number, or email..."
                          value={selectedStudentId}
                          onChange={(val) => setSelectedStudentId(val)}
                          options={(rosterMap[script.exam] || []).map(stud => ({
                            value: stud.id,
                            label: `${stud.name} (${stud.rollNumber || 'No Roll Number'}) — ${stud.email}`
                          }))}
                        />
                      </div>

                      <div className="flex gap-3">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleSaveIdentify(script._id)}
                          disabled={savingId || !selectedStudentId}
                        >
                          {savingId ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                              <span>Saving...</span>
                            </>
                          ) : (
                            <span>Save Identification</span>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* General Correction Error Alert */}
              {correctionError && (
                (activeScriptIdForMerge === script._id) ||
                (activeScriptIdForSplit === script._id) ||
                (activeScriptIdForReorder === script._id) ||
                (activePageIdForMove && script.pages.some(p => p._id === activePageIdForMove))
              ) && (
                <div className="mb-4 flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-brand p-3 text-rose-900 text-xs font-bold leading-normal shadow-3xs">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                  <span>{correctionError}</span>
                </div>
              )}

              {/* Merge Script Mode */}
              {activeScriptIdForMerge === script._id && (
                <div className="mb-6 p-4 border border-rose-200 rounded-brand bg-rose-50/20 space-y-4 shadow-3xs">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-rose-900 uppercase tracking-wider flex items-center gap-2">
                      <ArrowRight className="h-4 w-4 text-rose-600" />
                      <span>Merge Script</span>
                    </h4>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveScriptIdForMerge(null)}
                      disabled={savingCorrection}
                    >
                      Cancel
                    </Button>
                  </div>

                  <div className="max-w-md space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">Select Target Script to Merge Into:</label>
                      <select
                        value={mergeTargetScriptId}
                        onChange={(e) => setMergeTargetScriptId(e.target.value)}
                        className="w-full px-3 py-2 rounded-brand border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary cursor-pointer"
                        disabled={savingCorrection}
                      >
                        <option value="">Choose target script...</option>
                        {scripts
                          .filter(s => s._id !== script._id)
                          .map((s) => (
                            <option key={s._id} value={s._id}>
                              Script #{scripts.findIndex(x => x._id === s._id) + 1} (Pages {s.startPageNumber}-{s.endPageNumber}) - {s.pages.length} pages
                            </option>
                          ))
                        }
                      </select>
                    </div>

                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-brand text-amber-900 text-xs font-semibold leading-relaxed">
                      ⚠️ WARNING: This will merge all pages from this script into the target script. This script will be permanently deleted.
                    </div>

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSaveMerge(script)}
                      disabled={savingCorrection || !mergeTargetScriptId}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
                    >
                      {savingCorrection ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          <span>Merging...</span>
                        </>
                      ) : (
                        <span>Confirm & Merge</span>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Split Script Mode */}
              {activeScriptIdForSplit === script._id && (
                <div className="mb-6 p-4 border border-brand-primary/20 rounded-brand bg-slate-50/50 space-y-4 shadow-3xs">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <Plus className="h-4 w-4 text-brand-primary" />
                      <span>Split Script into Groups</span>
                    </h4>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveScriptIdForSplit(null)}
                      disabled={savingCorrection}
                    >
                      Cancel
                    </Button>
                  </div>

                  <div className="text-xs text-slate-600 leading-relaxed bg-blue-50 border border-blue-100 rounded-brand p-3 font-medium">
                    💡 Click the dashed lines between pages below to place split boundaries. The script will be split into multiple scripts at those boundaries.
                  </div>

                  <div className="flex flex-wrap items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-brand text-amber-900 text-xs font-bold">
                    <span>Preview:</span>
                    <span className="font-extrabold">This will split the script into {splitPoints.size + 1} scripts.</span>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSaveSplit(script)}
                      disabled={savingCorrection || splitPoints.size === 0}
                    >
                      {savingCorrection ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          <span>Splitting...</span>
                        </>
                      ) : (
                        <span>Confirm & Split</span>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Reorder Pages Mode control bar */}
              {activeScriptIdForReorder === script._id && (
                <div className="mb-6 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-brand p-4 shadow-3xs">
                  <span className="text-xs font-bold text-slate-700">Reordering Mode: Shift page positions using arrows.</span>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSaveReorder(script)}
                      disabled={savingCorrection}
                    >
                      {savingCorrection ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <span>Save Order</span>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveScriptIdForReorder(null)}
                      disabled={savingCorrection}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Pages Grid or Reorder Grid or Split Grid */}
              {(!script.pages || script.pages.length === 0) ? (
                <div className="text-center py-6 text-slate-400 text-xs font-semibold border border-dashed border-slate-200 rounded-brand bg-slate-50/50">
                  No pages associated with this script.
                </div>
              ) : activeScriptIdForSplit === script._id ? (
                /* Interactive Split Grid */
                <div className="flex flex-wrap items-center gap-y-6 gap-x-2 py-4">
                  {script.pages.map((page, idx) => {
                    const isSplitPoint = splitPoints.has(idx);
                    const isLast = idx === script.pages.length - 1;

                    return (
                      <React.Fragment key={page._id}>
                        <div className="relative border border-slate-200 rounded-brand overflow-hidden bg-slate-50 flex flex-col items-center justify-center p-2 w-32 h-44 shadow-2xs">
                          {page.nearBlank && (
                            <div className="absolute top-2 left-2 z-10 bg-amber-500 text-white px-1.5 py-0.5 rounded text-4xs font-black uppercase tracking-wider shadow-2xs select-none">
                              Blank
                            </div>
                          )}
                          {page.isDuplicate && (
                            <div className="absolute top-2 right-2 z-10 bg-rose-500 text-white px-1.5 py-0.5 rounded text-4xs font-black uppercase tracking-wider shadow-2xs select-none">
                              Duplicate
                            </div>
                          )}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={page.thumbnailUrl}
                            alt={`Page ${page.pageNumber}`}
                            className="object-contain max-h-32 max-w-full select-none"
                          />
                          <div className="text-3xs font-extrabold text-slate-500 mt-2">Page {page.pageNumber}</div>
                        </div>

                        {!isLast && (
                          <button
                            type="button"
                            onClick={() => handleToggleSplitPoint(idx)}
                            disabled={savingCorrection}
                            className={`group relative flex flex-col items-center justify-center w-8 h-44 border-y border-dashed transition-all cursor-pointer ${
                              isSplitPoint
                                ? 'border-rose-400 bg-rose-50/50 hover:bg-rose-100/50'
                                : 'border-slate-200 bg-transparent hover:bg-slate-50'
                            }`}
                          >
                            <div className={`absolute w-0.5 h-full border-l border-dashed transition-all ${
                              isSplitPoint ? 'border-rose-500 scale-x-125' : 'border-slate-300 group-hover:border-slate-400'
                            }`} />

                            <div className={`z-10 p-1 rounded-full shadow-2xs transition-all ${
                              isSplitPoint
                                ? 'bg-rose-500 text-white'
                                : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:scale-110'
                            }`}>
                              <Plus className="h-3 w-3" />
                            </div>
                          </button>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              ) : activeScriptIdForReorder === script._id ? (
                /* Reorder Grid */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 py-2">
                  {reorderPageIds.map((pageId, idx) => {
                    const page = script.pages.find(p => p._id === pageId);
                    if (!page) return null;

                    return (
                      <div key={pageId} className="relative flex flex-col space-y-2 border border-slate-200 rounded-brand p-2 bg-slate-50 shadow-3xs">
                        {page.nearBlank && (
                          <div className="absolute top-2 left-2 z-10 bg-amber-500 text-white px-1.5 py-0.5 rounded text-4xs font-black uppercase tracking-wider shadow-2xs select-none">
                            Blank
                          </div>
                        )}
                        {page.isDuplicate && (
                          <div className="absolute top-2 right-2 z-10 bg-rose-500 text-white px-1.5 py-0.5 rounded text-4xs font-black uppercase tracking-wider shadow-2xs select-none">
                            Duplicate
                          </div>
                        )}
                        <ThumbnailImage
                          src={page.thumbnailUrl}
                          alt={`Page ${page.pageNumber}`}
                        />
                        <div className="flex items-center justify-between text-2xs font-bold text-slate-500">
                          <span>Page {page.pageNumber}</span>
                        </div>

                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleShiftPage(idx, 'left')}
                            disabled={idx === 0 || savingCorrection}
                            className="flex-1 flex items-center justify-center p-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-30 disabled:hover:bg-white cursor-pointer"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleShiftPage(idx, 'right')}
                            disabled={idx === reorderPageIds.length - 1 || savingCorrection}
                            className="flex-1 flex items-center justify-center p-1 rounded border border-slate-350 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-30 disabled:hover:bg-white cursor-pointer"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Regular Grid */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {script.pages.map((page) => (
                    <div key={page._id} className="group relative flex flex-col space-y-1.5">
                      {page.nearBlank && (
                        <div className="absolute top-2 left-2 z-10 bg-amber-500 text-white px-1.5 py-0.5 rounded text-4xs font-black uppercase tracking-wider shadow-2xs select-none">
                          Blank
                        </div>
                      )}
                      {page.isDuplicate && (
                        <div className="absolute top-2 right-2 z-10 bg-rose-500 text-white px-1.5 py-0.5 rounded text-4xs font-black uppercase tracking-wider shadow-2xs select-none">
                          Duplicate
                        </div>
                      )}
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

                      {/* Move Page controls */}
                      {isAuthorized && activePageIdForMove !== page._id && (
                        <button
                          type="button"
                          onClick={() => handleStartMovePage(page._id)}
                          className="w-full mt-1 py-1 text-4xs uppercase tracking-wider font-extrabold text-slate-500 border border-dashed border-slate-300 rounded hover:bg-slate-50 hover:text-slate-700 cursor-pointer transition-colors"
                          disabled={savingCorrection || activeScriptIdForReorder !== null || activeScriptIdForSplit !== null || activeScriptIdForMerge !== null || selectedScriptForId !== null}
                        >
                          Move Page
                        </button>
                      )}

                      {activePageIdForMove === page._id && (
                        <div className="mt-1 p-2 border border-brand-primary/30 rounded bg-slate-100 space-y-2 shadow-2xs">
                          <select
                            value={moveTargetScriptId}
                            onChange={(e) => setMoveTargetScriptId(e.target.value)}
                            className="w-full p-1 rounded border border-slate-350 bg-white text-slate-800 text-3xs focus:outline-none cursor-pointer"
                            disabled={savingCorrection}
                          >
                            <option value="">Move to...</option>
                            {scripts
                              .filter(s => s._id !== script._id)
                              .map((s) => (
                                <option key={s._id} value={s._id}>
                                  Script #{scripts.findIndex(x => x._id === s._id) + 1}
                                </option>
                              ))
                            }
                          </select>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleSaveMovePage(script, page._id)}
                              disabled={savingCorrection || !moveTargetScriptId}
                              className="flex-1 py-0.5 rounded bg-brand-primary hover:bg-brand-primary/95 text-white text-4xs font-extrabold cursor-pointer"
                            >
                              Go
                            </button>
                            <button
                              type="button"
                              onClick={() => setActivePageIdForMove(null)}
                              disabled={savingCorrection}
                              className="flex-1 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-4xs font-extrabold cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Action Toolbar */}
              {isAuthorized && (
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartReorder(script)}
                    disabled={savingCorrection || activeScriptIdForReorder !== null || activeScriptIdForSplit !== null || activeScriptIdForMerge !== null || selectedScriptForId !== null || activePageIdForMove !== null}
                  >
                    <ArrowRight className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
                    <span>Reorder Pages</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartSplit(script)}
                    disabled={savingCorrection || activeScriptIdForReorder !== null || activeScriptIdForSplit !== null || activeScriptIdForMerge !== null || selectedScriptForId !== null || activePageIdForMove !== null}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
                    <span>Split Script</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartMerge(script)}
                    disabled={savingCorrection || activeScriptIdForReorder !== null || activeScriptIdForSplit !== null || activeScriptIdForMerge !== null || selectedScriptForId !== null || activePageIdForMove !== null}
                  >
                    <ArrowRight className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
                    <span>Merge Script</span>
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
