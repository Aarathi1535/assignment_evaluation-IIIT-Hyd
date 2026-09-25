/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  UploadCloud, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Award, 
  HelpCircle,
  Clock,
  ArrowRight,
  Trash2
} from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface Criterion {
  criterionName: string;
  points: number;
  description?: string;
}

interface ClassroomQuestion {
  _id: string;
  title: string;
  questionPrompt: string;
  maxMarks: number;
  rubricCriteria: Criterion[];
  isActive: boolean;
  createdAt: string;
}

interface CriterionScore {
  criterionName: string;
  marksAwarded: number;
  maxMarks: number;
  feedback?: string;
  evidence?: string;
}

interface EvaluationResult {
  _id: string;
  score: number;
  maxMarks: number;
  feedback: string;
  criterionScores: CriterionScore[];
  imagePath: string;
  submittedAt: string;
  evaluatedAt: string;
}

export default function StudentClassroomAssessmentPage() {
  const [activeQuestion, setActiveQuestion] = useState<ClassroomQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchActiveQuestionAndSubmission = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      // 1. Fetch active question
      const res = await fetch('/api/classroom/questions/active');
      const json = await res.json();
      
      if (json.success && json.data) {
        setActiveQuestion(json.data);
        
        // 2. Fetch any prior submission for this active question
        const subRes = await fetch(`/api/classroom/submissions?questionId=${json.data._id}`);
        const subJson = await subRes.json();
        if (subJson.success && Array.isArray(subJson.data) && subJson.data.length > 0) {
          setEvaluationResult(subJson.data[0]);
        } else {
          setEvaluationResult(null);
        }
      } else {
        setActiveQuestion(null);
        setEvaluationResult(null);
      }
    } catch (err) {
      console.error('Failed to load active classroom question:', err);
      setErrorMessage('Could not load classroom question. Please refresh.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      try {
        const res = await fetch('/api/classroom/questions/active');
        const json = await res.json();
        
        if (!ignore && json.success && json.data) {
          setActiveQuestion(json.data);
          
          const subRes = await fetch(`/api/classroom/submissions?questionId=${json.data._id}`);
          const subJson = await subRes.json();
          if (!ignore && subJson.success && Array.isArray(subJson.data) && subJson.data.length > 0) {
            setEvaluationResult(subJson.data[0]);
          } else if (!ignore) {
            setEvaluationResult(null);
          }
        } else if (!ignore) {
          setActiveQuestion(null);
          setEvaluationResult(null);
        }
      } catch (err) {
        console.error('Failed to load active classroom question:', err);
        if (!ignore) setErrorMessage('Could not load classroom question. Please refresh.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadData();
    return () => { ignore = true; };
  }, []);

  const handleFileChange = (file: File | null) => {
    setErrorMessage('');
    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    // Validate mime type
    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!validMimes.includes(file.type.toLowerCase())) {
      setErrorMessage('Please upload a valid image file (JPEG, PNG, or WebP).');
      return;
    }

    // Validate size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('File size exceeds the 10MB limit. Please upload a smaller image.');
      return;
    }

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuestion) {
      setErrorMessage('No active assessment question is available.');
      return;
    }

    if (!selectedFile) {
      setErrorMessage('Please select or capture an image of your handwritten answer.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const formData = new FormData();
      formData.append('questionId', activeQuestion._id);
      formData.append('file', selectedFile);

      const res = await fetch('/api/classroom/submit', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorMessage(json.message || 'Submission failed. Please try again.');
      } else {
        setEvaluationResult(json.data);
        setSelectedFile(null);
        setPreviewUrl(null);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error during submission');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForNewSubmission = () => {
    setEvaluationResult(null);
    setSelectedFile(null);
    setPreviewUrl(null);
    setErrorMessage('');
    fetchActiveQuestionAndSubmission();
  };

  const stats = [
    {
      title: 'Current Status',
      value: activeQuestion ? 'Active Live Question' : 'Idle',
      icon: activeQuestion ? Sparkles : Clock,
      color: activeQuestion ? 'text-indigo-600' : 'text-slate-500',
      borderColor: 'border-slate-200',
      iconBg: activeQuestion ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500',
    },
    {
      title: 'Submission Status',
      value: evaluationResult ? 'Evaluated' : activeQuestion ? 'Open' : 'No Activity',
      icon: evaluationResult ? CheckCircle2 : ArrowRight,
      color: evaluationResult ? 'text-emerald-600' : 'text-amber-600',
      borderColor: 'border-slate-200',
      iconBg: evaluationResult ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
    },
    {
      title: 'Assigned Score',
      value: evaluationResult ? `${evaluationResult.score} / ${evaluationResult.maxMarks}` : '—',
      icon: Award,
      color: 'text-purple-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-purple-50 text-purple-600',
    },
  ];

  return (
    <DashboardLayout
      title="Classroom Assessment (Interactive Mode)"
      description="Engage in live classroom assessments: view the active question, upload your handwritten solution, and receive immediate evaluated feedback."
      stats={stats}
    >
      <div className="space-y-6 font-sans max-w-5xl">
        {errorMessage && (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-brand text-sm flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-3">
            <LoadingSpinner size="lg" />
            <p className="text-sm font-semibold text-slate-500">Connecting to classroom live session...</p>
          </div>
        ) : !activeQuestion ? (
          <EmptyState
            title="No Active Classroom Assessment"
            description="Your professor has not opened an active classroom assessment question at this moment. Please check back when your instructor initiates the activity."
            icon={HelpCircle}
            action={
              <Button variant="primary" size="md" onClick={fetchActiveQuestionAndSubmission}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                <span>Check for Active Question</span>
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Question Details */}
            <div className="lg:col-span-5 space-y-4">
              <Card className="border border-slate-200 p-5 space-y-4 bg-white">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      LIVE ACTIVE QUESTION
                    </span>
                    <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      Max Marks: {activeQuestion.maxMarks}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 pt-1">{activeQuestion.title}</h2>
                </div>

                <div className="p-4 bg-slate-50 rounded-brand border border-slate-200">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Question Prompt:</h3>
                  <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {activeQuestion.questionPrompt}
                  </p>
                </div>

                {activeQuestion.rubricCriteria && activeQuestion.rubricCriteria.length > 0 && (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Evaluation Rubric:</h3>
                    <div className="space-y-1.5">
                      {activeQuestion.rubricCriteria.map((criterion, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs p-2 bg-white rounded border border-slate-200">
                          <div>
                            <span className="font-semibold text-slate-800">{criterion.criterionName}</span>
                            {criterion.description && (
                              <p className="text-3xs text-slate-500">{criterion.description}</p>
                            )}
                          </div>
                          <span className="font-bold text-brand-primary shrink-0 ml-2">{criterion.points} pts</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Right Column: Upload Form OR Evaluation Result */}
            <div className="lg:col-span-7">
              {evaluationResult ? (
                /* Evaluation Result Display */
                <Card className="border border-emerald-200 bg-emerald-50/20 p-6 space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-100 pb-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        <h3 className="text-base font-bold text-emerald-950">Assessment Evaluated</h3>
                      </div>
                      <p className="text-xs text-slate-500">
                        Evaluated at {new Date(evaluationResult.evaluatedAt || evaluationResult.submittedAt).toLocaleTimeString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-brand shadow-xs">
                      <Award className="h-5 w-5" />
                      <div className="text-right">
                        <p className="text-3xs font-extrabold uppercase tracking-wider">Score Awarded</p>
                        <p className="text-xl font-black leading-none">
                          {evaluationResult.score} <span className="text-sm font-normal">/ {evaluationResult.maxMarks}</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Feedback summary */}
                  <div className="p-4 bg-white rounded-brand border border-emerald-200 space-y-1 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Overall Feedback</h4>
                    <p className="text-sm text-slate-800 leading-relaxed font-medium">
                      {evaluationResult.feedback}
                    </p>
                  </div>

                  {/* Criterion breakdown */}
                  {evaluationResult.criterionScores && evaluationResult.criterionScores.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Criterion Breakdown</h4>
                      <div className="space-y-2">
                        {evaluationResult.criterionScores.map((cs, i) => (
                          <div key={i} className="p-3 bg-white rounded-brand border border-slate-200 space-y-1 shadow-2xs">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-bold text-slate-900">{cs.criterionName}</span>
                              <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                                {cs.marksAwarded} / {cs.maxMarks} pts
                              </span>
                            </div>
                            {cs.feedback && (
                              <p className="text-xs text-slate-600">{cs.feedback}</p>
                            )}
                            {cs.evidence && (
                              <p className="text-2xs text-slate-500 font-medium bg-slate-50 p-1.5 rounded border border-slate-100">
                                <span className="font-bold text-slate-700">Observed Evidence: </span>
                                {cs.evidence}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Uploaded answer thumbnail */}
                  {evaluationResult.imagePath && (
                    <div className="border-t border-emerald-100 pt-4 space-y-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Submitted Handwritten Answer</h4>
                      <div className="bg-slate-100 p-2 rounded-brand flex justify-center max-h-60 overflow-hidden">
                        <img
                          src={`/api/classroom/image?path=${evaluationResult.imagePath}`}
                          alt="Submitted handwritten response"
                          className="object-contain max-h-56 rounded"
                        />
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex justify-end">
                    <Button variant="outline" size="sm" onClick={handleResetForNewSubmission}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      <span>Refresh / Re-check Question</span>
                    </Button>
                  </div>
                </Card>
              ) : (
                /* Upload Form */
                <Card className="border border-slate-200 p-6 space-y-5 bg-white">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Upload Handwritten Answer</h3>
                    <p className="text-xs text-slate-500">
                      Write your solution on paper, snap a photo or scan, and upload it here for immediate evaluation.
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Drag and Drop Zone */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
                        dragOver 
                          ? 'border-brand-primary bg-brand-primary/5' 
                          : previewUrl 
                            ? 'border-emerald-300 bg-emerald-50/20' 
                            : 'border-slate-300 hover:border-slate-400 bg-slate-50/50'
                      }`}
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/png,image/jpeg,image/webp,image/jpg"
                        onChange={(e) => handleFileChange(e.target.files ? e.target.files[0] : null)}
                        className="hidden"
                      />

                      {previewUrl ? (
                        <div className="space-y-3">
                          <img
                            src={previewUrl}
                            alt="Answer preview"
                            className="max-h-48 mx-auto rounded shadow-xs object-contain border border-slate-200"
                          />
                          <p className="text-xs font-bold text-slate-700">{selectedFile?.name}</p>
                          <p className="text-3xs text-slate-500">Click or drag another image to replace</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="h-12 w-12 rounded-full bg-brand-primary/10 text-brand-primary mx-auto flex items-center justify-center">
                            <UploadCloud className="h-6 w-6" />
                          </div>
                          <p className="text-sm font-bold text-slate-800">
                            Click to upload or drag and drop
                          </p>
                          <p className="text-xs text-slate-500">
                            PNG, JPEG, or WebP up to 10MB
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      {selectedFile && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleFileChange(null)}
                          className="text-rose-600 hover:bg-rose-50 border-rose-200"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          <span>Clear Image</span>
                        </Button>
                      )}

                      <div className="ml-auto">
                        <Button
                          type="submit"
                          variant="primary"
                          size="md"
                          disabled={!selectedFile || isSubmitting}
                          className="min-w-[160px]"
                        >
                          {isSubmitting ? (
                            <div className="flex items-center gap-2">
                              <LoadingSpinner size="sm" />
                              <span>Evaluating...</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span>Submit for Evaluation</span>
                              <ArrowRight className="h-4 w-4" />
                            </div>
                          )}
                        </Button>
                      </div>
                    </div>
                  </form>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
