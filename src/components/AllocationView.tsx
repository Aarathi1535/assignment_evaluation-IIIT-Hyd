'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Users, 
  Settings, 
  HelpCircle, 
  CheckCircle2, 
  Eye, 
  AlertCircle, 
  ArrowLeft,
  RefreshCw,
  Clock
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { LoadingSpinner } from './ui/LoadingSpinner';
import Link from 'next/link';

interface AllocationViewProps {
  examId: string;
}

interface ExamInfo {
  _id: string;
  title: string;
  numberOfQuestions: number;
  ingestionApprovalStatus: 'PENDING_REVIEW' | 'APPROVED';
}

interface TeachingAssistant {
  _id: string;
  name: string;
  email: string;
  isActive: boolean;
}

interface PreviewData {
  allocationCounts: Record<string, number>;
  totalEligibleScripts: number;
  totalExcludedScripts: number;
  excludedCountsByReason: Record<string, number>;
}

export default function AllocationView({ examId }: AllocationViewProps) {
  const router = useRouter();
  
  // Loading & Error States
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Data States
  const [exam, setExam] = useState<ExamInfo | null>(null);
  const [tas, setTas] = useState<TeachingAssistant[]>([]);
  
  // Form Configuration States
  const [selectedTaIds, setSelectedTaIds] = useState<string[]>([]);
  const [rule, setRule] = useState<'EQUAL' | 'QUESTION' | 'RANDOM'>('EQUAL');
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 1000000));
  
  // Action States
  const [previewing, setPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [allocating, setAllocating] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load Initial Settings (Exam Details + TAs)
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      
      const res = await fetch(`/api/exams/${examId}/allocate`);
      const json = await res.json();
      
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to load allocation settings');
      }
      
      setExam(json.data.exam);
      setTas(json.data.teachingAssistants || []);
      
      // Auto-select all TAs by default
      const taIds = (json.data.teachingAssistants || [])
        .filter((ta: TeachingAssistant) => ta.isActive)
        .map((ta: TeachingAssistant) => ta._id);
      setSelectedTaIds(taIds);
      
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error fetching allocation settings');
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
  }, [loadSettings]);

  // Handle TA Selection Toggle
  const handleTaToggle = (taId: string) => {
    setSelectedTaIds((prev) => 
      prev.includes(taId) ? prev.filter(id => id !== taId) : [...prev, taId]
    );
    // Clear preview when parameters change to prevent stale submissions
    setPreviewData(null);
  };

  const handleSelectAllTAs = () => {
    setSelectedTaIds(tas.map(ta => ta._id));
    setPreviewData(null);
  };

  const handleClearAllTAs = () => {
    setSelectedTaIds([]);
    setPreviewData(null);
  };

  // Generate a random seed
  const handleRegenerateSeed = () => {
    setSeed(Math.floor(Math.random() * 1000000));
    setPreviewData(null);
  };

  // Safe Preview Handler
  const handlePreview = async () => {
    if (selectedTaIds.length === 0) {
      setErrorMsg('Please select at least one Teaching Assistant.');
      return;
    }
    
    setPreviewing(true);
    setErrorMsg(null);
    setPreviewData(null);
    
    try {
      const payload = {
        rule,
        taIds: selectedTaIds,
        seed: rule === 'RANDOM' ? seed : undefined
      };
      
      const res = await fetch(`/api/exams/${examId}/allocate/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const json = await res.json();
      
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to generate allocation preview.');
      }
      
      setPreviewData(json.data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error creating preview.');
    } finally {
      setPreviewing(false);
    }
  };

  // Real Allocation Handler
  const handleAllocate = async () => {
    if (selectedTaIds.length === 0) {
      setErrorMsg('Please select at least one Teaching Assistant.');
      return;
    }
    
    setAllocating(true);
    setErrorMsg(null);
    
    try {
      const payload = {
        rule,
        taIds: selectedTaIds,
        seed: rule === 'RANDOM' ? seed : undefined
      };
      
      const res = await fetch(`/api/exams/${examId}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const json = await res.json();
      
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to execute allocation.');
      }
      
      setSuccessMsg('Allocation committed successfully! Redirecting...');
      setTimeout(() => {
        router.push('/professor/exams');
      }, 1500);
      
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error committing allocation.');
    } finally {
      setAllocating(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center space-y-4">
        <LoadingSpinner size="lg" />
        <p className="text-sm font-semibold text-slate-500">Loading allocation details...</p>
      </div>
    );
  }

  const isApproved = exam?.ingestionApprovalStatus === 'APPROVED';

  return (
    <div className="max-w-4xl mx-auto space-y-6 font-sans">
      {/* Back to Exams */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="space-y-1">
          <button
            onClick={() => router.push('/professor/exams')}
            className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-all cursor-pointer mb-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Exams</span>
          </button>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Professor Allocation</h2>
          <p className="text-xs font-semibold text-slate-500">
            Configure how scripts are allocated to TAs for grading: {exam?.title}
          </p>
        </div>
      </div>

      {/* Error & Success Messages */}
      {errorMsg && (
        <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-brand p-4 text-rose-800 text-sm font-semibold transition-all">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
          <div className="space-y-1">
            <p>{errorMsg}</p>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-brand p-4 text-emerald-800 text-sm font-semibold transition-all">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Ingestion Gate Alert */}
      {!isApproved && (
        <div className="border-2 border-amber-300 rounded-brand bg-amber-50/50 p-5 flex gap-4">
          <div className="p-2 bg-amber-100 rounded-full text-amber-600 h-fit self-start">
            <Clock className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h3 className="font-bold text-amber-900 text-sm">Ingestion Approval Required</h3>
            <p className="text-xs text-amber-800 leading-relaxed font-medium">
              The answer script ingestion for this exam has not yet been approved.
              Allocation rules can only be previewed and executed once ingestion is approved and sealed.
            </p>
            <div className="pt-2 flex gap-3">
              <Link href={`/professor/exams/${examId}/review-dashboard`}>
                <Button variant="outline" size="sm" className="bg-white border-amber-300 text-amber-900 hover:bg-amber-100">
                  Go to Ingestion Review Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        {/* Left Column: Configuration Form */}
        <div className="md:col-span-2 space-y-6">
          {/* Rule Selection Card */}
          <Card className="p-5 border border-slate-200 shadow-3xs space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Settings className="h-4 w-4 text-brand-primary" aria-hidden="true" />
              <h3 id="allocation-method-label" className="font-extrabold text-sm text-slate-800 uppercase tracking-wider">Allocation Method</h3>
            </div>

            <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-labelledby="allocation-method-label">
              {(['EQUAL', 'QUESTION', 'RANDOM'] as const).map((r) => {
                const isSelected = rule === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={!isApproved}
                    onClick={() => {
                      setRule(r);
                      setPreviewData(null);
                    }}
                    className={`border-2 rounded-brand p-3 text-center flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-150 select-none outline-none focus:ring-2 focus:ring-brand-primary/40 ${
                      !isApproved ? 'opacity-40 cursor-not-allowed' : ''
                    } ${
                      isSelected
                        ? 'border-brand-primary bg-brand-primary/5 text-brand-primary font-bold shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <span className="text-2xs font-extrabold tracking-wider">{r}</span>
                    <span className="text-4xs text-slate-400 font-semibold uppercase">
                      {r === 'EQUAL' && 'Equal Scripts'}
                      {r === 'QUESTION' && 'By Question'}
                      {r === 'RANDOM' && 'Seeded Random'}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Seed parameter for RANDOM */}
            {rule === 'RANDOM' && (
              <div className="bg-slate-50 border border-slate-200 rounded-brand p-4 space-y-2 mt-2">
                <label className="block text-2xs font-extrabold text-slate-600 uppercase tracking-wider">
                  Deterministic Seed Value
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    disabled={!isApproved}
                    value={seed}
                    onChange={(e) => {
                      setSeed(parseInt(e.target.value, 10) || 0);
                      setPreviewData(null);
                    }}
                    className="flex-1 px-3 py-2 text-sm font-semibold rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary bg-white text-slate-900 shadow-2xs disabled:opacity-50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!isApproved}
                    onClick={handleRegenerateSeed}
                    className="h-9 px-3 cursor-pointer"
                  >
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    <span>Regenerate</span>
                  </Button>
                </div>
                <p className="text-4xs font-medium text-slate-500 leading-normal">
                  The random algorithm uses a seed so that allocations are 100% deterministic and reproducible when previewed and saved.
                </p>
              </div>
            )}

            {rule === 'QUESTION' && (
              <div className="bg-slate-50 border border-slate-200 rounded-brand p-4 mt-2 flex gap-3.5 items-center">
                <HelpCircle className="h-5 w-5 text-brand-primary shrink-0" />
                <p className="text-5xs font-semibold text-slate-500 uppercase tracking-wider">
                  The exam is configured with <span className="text-brand-primary font-black">{exam?.numberOfQuestions} questions</span>. Each question slot will be distributed equally among TAs.
                </p>
              </div>
            )}
          </Card>

          {/* TA Selection Card */}
          <Card className="p-5 border border-slate-200 shadow-3xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-brand-primary" aria-hidden="true" />
                <h3 id="ta-selection-label" className="font-extrabold text-sm text-slate-800 uppercase tracking-wider">Selected TAs</h3>
              </div>
              {isApproved && tas.length > 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllTAs}
                    className="text-4xs font-extrabold uppercase text-brand-primary hover:underline cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300 text-4xs">|</span>
                  <button
                    type="button"
                    onClick={handleClearAllTAs}
                    className="text-4xs font-extrabold uppercase text-slate-500 hover:underline cursor-pointer focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {tas.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-slate-200 text-slate-500 text-xs font-semibold rounded-brand text-center">
                No teaching assistants are enrolled in the course. Enroll TAs in Course settings first.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3" role="group" aria-labelledby="ta-selection-label">
                {tas.map((ta) => {
                  const isChecked = selectedTaIds.includes(ta._id);
                  return (
                    <button
                      key={ta._id}
                      type="button"
                      role="checkbox"
                      aria-checked={isChecked}
                      aria-label={`${ta.name} (${ta.email})`}
                      disabled={!isApproved || !ta.isActive}
                      onClick={() => handleTaToggle(ta._id)}
                      className={`border-2 rounded-brand p-3 text-left transition-all duration-150 flex items-center justify-between cursor-pointer outline-none select-none focus:ring-2 focus:ring-brand-primary/40 ${
                        !isApproved || !ta.isActive ? 'opacity-40 cursor-not-allowed' : ''
                      } ${
                        isChecked 
                          ? 'border-brand-primary bg-brand-primary/5 shadow-2xs' 
                          : 'border-slate-200 hover:border-slate-350 bg-white'
                      }`}
                    >
                      <div className="space-y-0.5 max-w-[80%]">
                        <p className="text-xs font-bold text-slate-800 truncate">{ta.name}</p>
                        <p className="text-4xs font-semibold text-slate-500 truncate">{ta.email}</p>
                      </div>
                      <div className={`w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isChecked
                          ? 'border-brand-primary bg-brand-primary text-white'
                          : 'border-slate-300 bg-white'
                      }`}>
                        {isChecked && (
                          <svg className="w-3 h-3 fill-current" viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Execution Buttons / Stats Summary */}
        <div className="space-y-6">
          <Card className="p-5 border border-slate-200 shadow-3xs space-y-4">
            <h3 className="font-extrabold text-sm text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3">Actions</h3>
            
            <Button
              type="button"
              variant="primary"
              className="w-full justify-center cursor-pointer"
              disabled={!isApproved || selectedTaIds.length === 0 || previewing}
              isLoading={previewing}
              onClick={handlePreview}
            >
              <Eye className="h-4 w-4 mr-2" />
              <span>Preview Allocation</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full justify-center border-emerald-500 text-emerald-800 hover:bg-emerald-50 cursor-pointer disabled:opacity-50"
              disabled={!isApproved || selectedTaIds.length === 0 || !previewData || allocating}
              isLoading={allocating}
              onClick={handleAllocate}
            >
              <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-600" />
              <span>Confirm & Allocate</span>
            </Button>

            <p className="text-5xs font-medium text-slate-500 leading-relaxed pt-2">
              Note: Running allocation deletes existing allocations for this exam. It will not modify any data if grading has already commenced.
            </p>
          </Card>

          {/* Settings quick info */}
          <Card className="p-4 border border-slate-200 bg-slate-50/50 space-y-2">
            <h4 className="text-4xs font-extrabold text-slate-600 uppercase tracking-wider">Exam Parameters</h4>
            <div className="text-xs space-y-1.5 font-medium text-slate-700">
              <div className="flex justify-between">
                <span>Ingestion Status:</span>
                <span className={`font-bold ${isApproved ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {isApproved ? 'Approved' : 'Pending'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Questions:</span>
                <span className="font-bold">{exam?.numberOfQuestions}</span>
              </div>
              <div className="flex justify-between">
                <span>Course TAs:</span>
                <span className="font-bold">{tas.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Selected TAs:</span>
                <span className="font-bold text-brand-primary">{selectedTaIds.length}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Bottom Section: Preview Results */}
      {previewData && (
        <Card className="p-5 border-2 border-slate-350 shadow-md bg-white space-y-6">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <h3 className="font-black text-slate-800 tracking-tight">Safe Allocation Preview Result</h3>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-slate-50 rounded p-4 text-center border border-slate-200 space-y-1 shadow-3xs">
              <p className="text-4xs font-extrabold text-slate-400 uppercase tracking-wider">Eligible Answer Scripts</p>
              <p className="text-3xl font-black text-slate-800">{previewData.totalEligibleScripts}</p>
            </div>
            
            <div className="bg-slate-50 rounded p-4 text-center border border-slate-200 space-y-1 shadow-3xs">
              <p className="text-4xs font-extrabold text-slate-400 uppercase tracking-wider">Excluded Answer Scripts</p>
              <p className="text-3xl font-black text-rose-700">{previewData.totalExcludedScripts}</p>
            </div>

            <div className="bg-slate-50 rounded p-4 text-center border border-slate-200 space-y-1 shadow-3xs">
              <p className="text-4xs font-extrabold text-slate-400 uppercase tracking-wider">Allocations per TA</p>
              <p className="text-3xl font-black text-brand-primary">
                {selectedTaIds.length > 0 ? (previewData.totalEligibleScripts * (rule === 'QUESTION' ? (exam?.numberOfQuestions || 1) : 1) / selectedTaIds.length).toFixed(1) : 0}
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6 pt-2">
            {/* TA Counts Table */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Counts per TA</h4>
              <div className="border border-slate-200 rounded-brand overflow-hidden shadow-3xs">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-5xs font-extrabold text-slate-500 uppercase tracking-wider">Teaching Assistant</th>
                      <th scope="col" className="px-4 py-2 text-right text-5xs font-extrabold text-slate-500 uppercase tracking-wider">Allocated Count</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-150">
                    {tas.filter(ta => selectedTaIds.includes(ta._id)).map((ta) => {
                      const count = previewData.allocationCounts[ta._id] || 0;
                      return (
                        <tr key={ta._id} className="text-xs font-semibold text-slate-700">
                          <td className="px-4 py-3">
                            <div>{ta.name}</div>
                            <div className="text-5xs font-medium text-slate-400 truncate">{ta.email}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900">
                            {count} {rule === 'QUESTION' ? 'questions' : 'scripts'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Excluded Scripts List */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Exclusion Summary</h4>
              {previewData.totalExcludedScripts === 0 ? (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-brand text-emerald-800 text-xs font-semibold text-center flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                  <span>All active scripts are fully identified and eligible for allocation.</span>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-brand overflow-hidden shadow-3xs max-h-60 overflow-y-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th scope="col" className="px-4 py-2 text-left text-5xs font-extrabold text-slate-500 uppercase tracking-wider">Exclusion Reason</th>
                        <th scope="col" className="px-4 py-2 text-right text-5xs font-extrabold text-slate-500 uppercase tracking-wider">Count</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-150">
                      {Object.entries(previewData.excludedCountsByReason).map(([reason, count], idx) => (
                        <tr key={idx} className="text-xs font-semibold text-slate-700">
                          <td className="px-4 py-3 text-left">
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-50 border border-rose-100 text-rose-800 text-5xs font-bold">
                              {reason}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-black text-rose-700">
                            {count} {count === 1 ? 'script' : 'scripts'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
