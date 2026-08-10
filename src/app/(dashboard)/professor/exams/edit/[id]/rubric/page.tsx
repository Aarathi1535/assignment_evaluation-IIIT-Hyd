'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, CheckCircle2, AlertCircle, Plus, Trash2, Save } from 'lucide-react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { validateRubricClient } from '@/utils/rubricBuilderUtils';

interface Criterion {
  criterionName: string;
  description: string;
  points: number;
}

interface Question {
  questionNumber: number;
  maxMarks: number;
  criteria: Criterion[];
}

interface ExamDetails {
  _id: string;
  title: string;
  totalMarks: number;
  numberOfQuestions: number;
}

export default function RubricBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: examId } = use(params);
  const router = useRouter();

  const [exam, setExam] = useState<ExamDetails | null>(null);
  const [rubricId, setRubricId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [examRes, rubricRes] = await Promise.all([
          fetch(`/api/exams/${examId}`),
          fetch(`/api/rubrics?exam=${examId}`)
        ]);

        const examData = await examRes.json();
        const rubricData = await rubricRes.json();

        if (examData.success && examData.data) {
          setExam(examData.data);
        } else {
          setErrorMsg(examData.message || 'Failed to load exam details.');
        }

        if (rubricData.success && rubricData.data) {
          setRubricId(rubricData.data._id);
          setQuestions(rubricData.data.questions || []);
          setIsLocked(rubricData.data.isLocked || false);
        } else {
          // Initialize with one empty question if no rubric exists yet
          setQuestions([
            {
              questionNumber: 1,
              maxMarks: 10,
              criteria: [
                { criterionName: '', description: '', points: 10 }
              ]
            }
          ]);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
        setErrorMsg('An error occurred while loading page details.');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [examId]);

  // Dynamic calculations
  const calculateQuestionPointsSum = (question: Question) => {
    return question.criteria.reduce((sum, c) => sum + (Number(c.points) || 0), 0);
  };

  const calculateRubricTotalMarks = () => {
    return questions.reduce((sum, q) => sum + (Number(q.maxMarks) || 0), 0);
  };

  // State modification helpers
  const handleAddQuestion = () => {
    const nextNum = questions.length > 0 
      ? Math.max(...questions.map(q => q.questionNumber)) + 1 
      : 1;

    setQuestions([
      ...questions,
      {
        questionNumber: nextNum,
        maxMarks: 10,
        criteria: [
          { criterionName: '', description: '', points: 10 }
        ]
      }
    ]);
  };

  const handleRemoveQuestion = (qIndex: number) => {
    setQuestions(questions.filter((_, idx) => idx !== qIndex));
  };

  const handleQuestionChange = (qIndex: number, field: keyof Question, value: unknown) => {
    const updated = [...questions];
    updated[qIndex] = {
      ...updated[qIndex],
      [field]: value
    };
    setQuestions(updated);
  };

  const handleAddCriterion = (qIndex: number) => {
    const updated = [...questions];
    updated[qIndex].criteria.push({
      criterionName: '',
      description: '',
      points: 5
    });
    setQuestions(updated);
  };

  const handleRemoveCriterion = (qIndex: number, cIndex: number) => {
    const updated = [...questions];
    updated[qIndex].criteria = updated[qIndex].criteria.filter((_, idx) => idx !== cIndex);
    setQuestions(updated);
  };

  const handleCriterionChange = (
    qIndex: number, 
    cIndex: number, 
    field: keyof Criterion, 
    value: unknown
  ) => {
    const updated = [...questions];
    updated[qIndex].criteria[cIndex] = {
      ...updated[qIndex].criteria[cIndex],
      [field]: value
    };
    setQuestions(updated);
  };

  // Validation
  const validateClientSide = (): boolean => {
    const errors = validateRubricClient(questions);
    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleSave = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setValidationErrors([]);

    if (!validateClientSide()) {
      return;
    }

    setSaving(true);

    const payload = {
      exam: examId,
      questions: questions.map(q => ({
        questionNumber: Number(q.questionNumber),
        maxMarks: Number(q.maxMarks),
        criteria: q.criteria.map(c => ({
          criterionName: c.criterionName.trim(),
          description: c.description.trim() || undefined,
          points: Number(c.points)
        }))
      }))
    };

    try {
      let res;
      if (rubricId) {
        // Update existing rubric
        res = await fetch(`/api/rubrics/${rubricId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        // Create new rubric
        res = await fetch('/api/rubrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccessMsg(rubricId ? 'Rubric updated successfully!' : 'Rubric created successfully!');
        setTimeout(() => {
          router.push('/professor/exams');
        }, 1500);
      } else {
        throw new Error(data.message || 'Failed to save rubric.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred while saving.';
      setErrorMsg(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
        <div className="text-center space-y-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-semibold text-slate-500">Loading rubric details...</p>
        </div>
      </div>
    );
  }

  const rubricTotal = calculateRubricTotalMarks();

  return (
    <DashboardLayout
      title="Rubric Builder"
      description={`Design and configure grading guidelines for assessment: ${exam?.title || 'Exam'}`}
    >
      <div className="max-w-4xl mx-auto space-y-6 font-sans pb-12">
        {/* Back navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <button
            onClick={() => router.push('/professor/exams')}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-all w-fit cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Exams</span>
          </button>

          {exam && (
            <div className="text-xs sm:text-sm font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-brand px-3 py-1.5 shrink-0 self-start sm:self-auto">
              Exam Target: {exam.numberOfQuestions} Questions ({exam.totalMarks} Marks)
            </div>
          )}
        </div>

        {/* Global Alerts */}
        {isLocked && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-brand p-3.5 text-amber-800 text-sm font-semibold shadow-2xs">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
            <span>This rubric is locked because grading has already started for this exam. It is displayed in read-only mode.</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-brand p-3.5 text-emerald-800 text-sm font-semibold shadow-2xs">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-brand p-3.5 text-rose-800 text-sm font-semibold shadow-2xs">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {validationErrors.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-brand p-4 space-y-2 text-rose-800 text-sm shadow-2xs">
            <div className="flex items-center gap-2 font-bold mb-1.5">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>Please resolve the following errors:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 font-semibold pl-1.5">
              {validationErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Questions Loop */}
        <div className="space-y-6">
          {questions.map((q, qIndex) => {
            const pointsSum = calculateQuestionPointsSum(q);
            const sumExceedsMax = pointsSum > q.maxMarks;

            return (
              <Card key={qIndex} className="border border-slate-200 shadow-sm relative overflow-hidden">
                <CardHeader className="bg-slate-50/50 border-b border-slate-100 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-bold text-slate-700">Question #</label>
                      <input
                        type="number"
                        min="1"
                        disabled={isLocked}
                        value={q.questionNumber || ''}
                        onChange={(e) => handleQuestionChange(qIndex, 'questionNumber', Number(e.target.value))}
                        className="w-16 px-2 py-1 rounded border border-slate-300 text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-brand-primary/20 text-center"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-sm font-bold text-slate-700">Max Marks</label>
                      <input
                        type="number"
                        min="0.5"
                        step="any"
                        disabled={isLocked}
                        value={q.maxMarks || ''}
                        onChange={(e) => handleQuestionChange(qIndex, 'maxMarks', Number(e.target.value))}
                        className="w-20 px-2 py-1 rounded border border-slate-300 text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-brand-primary/20 text-center"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-brand border ${
                      sumExceedsMax 
                        ? 'bg-rose-50 text-rose-700 border-rose-200' 
                        : pointsSum === q.maxMarks 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      Sum of Points: {pointsSum} / {q.maxMarks || 0}
                    </span>

                    {!isLocked && questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveQuestion(qIndex)}
                        className="p-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700 rounded transition-all cursor-pointer"
                        title="Remove Question"
                      >
                        <Trash2 className="h-4.5 w-4.5" />
                      </button>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="p-5 space-y-4">
                  {/* Criteria header */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-slate-400" />
                      <span>Grading Criteria (Sub-parts)</span>
                    </h4>
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => handleAddCriterion(qIndex)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-brand-primary hover:text-brand-primary/95 transition-all cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add Sub-part</span>
                      </button>
                    )}
                  </div>

                  {q.criteria.length === 0 ? (
                    <div className="text-center py-4 bg-slate-50/55 rounded border border-dashed border-slate-200 text-xs text-slate-500 font-semibold">
                      No criteria added yet. Click &quot;Add Sub-part&quot; to define grading guidelines.
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {q.criteria.map((c, cIndex) => (
                        <div key={cIndex} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start border-b border-slate-50/70 pb-3 last:border-0 last:pb-0">
                          <div className="md:col-span-4">
                            <input
                              type="text"
                              placeholder="e.g. Logic / Correctness"
                              disabled={isLocked}
                              value={c.criterionName}
                              onChange={(e) => handleCriterionChange(qIndex, cIndex, 'criterionName', e.target.value)}
                              className="w-full px-3 py-1.5 rounded border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 text-sm font-semibold"
                            />
                          </div>

                          <div className="md:col-span-5">
                            <input
                              type="text"
                              placeholder="Description / details (optional)"
                              disabled={isLocked}
                              value={c.description}
                              onChange={(e) => handleCriterionChange(qIndex, cIndex, 'description', e.target.value)}
                              className="w-full px-3 py-1.5 rounded border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 text-sm font-medium"
                            />
                          </div>

                          <div className="md:col-span-2 flex items-center gap-2">
                            <input
                              type="number"
                              min="0.5"
                              step="any"
                              placeholder="Points"
                              disabled={isLocked}
                              value={c.points || ''}
                              onChange={(e) => handleCriterionChange(qIndex, cIndex, 'points', Number(e.target.value))}
                              className="w-full px-3 py-1.5 rounded border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 text-sm font-bold text-center"
                            />
                            <span className="text-xs text-slate-500 font-bold">pts</span>
                          </div>

                          <div className="md:col-span-1 flex justify-end md:justify-center">
                            {!isLocked && q.criteria.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveCriterion(qIndex, cIndex)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded transition-all cursor-pointer mt-0.5"
                                title="Delete Criterion"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Global Actions Block */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white border border-slate-200 rounded-brand-lg p-5 shadow-sm">
          <div className="flex flex-col gap-1 text-slate-800">
            <span className="text-sm font-bold">
              Total Rubric Marks: {rubricTotal}
            </span>
            {exam && (
              <span className={`text-xs font-semibold ${
                rubricTotal === exam.totalMarks ? 'text-emerald-700' : 'text-slate-500'
              }`}>
                {rubricTotal === exam.totalMarks 
                  ? '✓ Matches exam total marks successfully!' 
                  : `Note: Current total (${rubricTotal}) differs from exam target total (${exam.totalMarks})`}
              </span>
            )}
          </div>

          {!isLocked && (
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleAddQuestion()}
                className="flex-1 sm:flex-initial"
              >
                <Plus className="h-4 w-4" />
                <span>Add Question</span>
              </Button>

              <Button
                type="button"
                variant="primary"
                isLoading={saving}
                onClick={handleSave}
                className="flex-1 sm:flex-initial"
              >
                <Save className="h-4 w-4" />
                <span>Save Rubric</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
