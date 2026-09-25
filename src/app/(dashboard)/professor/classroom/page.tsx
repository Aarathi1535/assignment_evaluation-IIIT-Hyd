/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Plus, 
  CheckCircle, 
  FileText, 
  Trash2, 
  Eye, 
  Radio, 
  X,
  ChevronDown,
  ChevronUp,
  User,
  Award
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
  status: string;
  createdAt: string;
}

interface StudentSubmission {
  _id: string;
  question: string;
  student: {
    _id: string;
    name: string;
    email: string;
  };
  imagePath: string;
  status: string;
  score: number;
  maxMarks: number;
  feedback: string;
  criterionScores: Array<{
    criterionName: string;
    marksAwarded: number;
    maxMarks: number;
    feedback?: string;
    evidence?: string;
  }>;
  submittedAt: string;
  evaluatedAt?: string;
}

export default function ProfessorClassroomAssessmentPage() {
  const [questions, setQuestions] = useState<ClassroomQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Form State
  const [title, setTitle] = useState('');
  const [questionPrompt, setQuestionPrompt] = useState('');
  const [maxMarks, setMaxMarks] = useState('10');
  const [criteria, setCriteria] = useState<Criterion[]>([
    { criterionName: 'Formulation & Steps', points: 5, description: 'Correct setup of initial formulas' },
    { criterionName: 'Calculation & Accuracy', points: 5, description: 'Final numerical result and clarity' }
  ]);
  const [activateImmediately, setActivateImmediately] = useState(true);
  const [creating, setCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Submissions expansion
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  const fetchQuestions = async () => {
    try {
      const res = await fetch('/api/classroom/questions');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setQuestions(json.data);
      }
    } catch (err) {
      console.error('Failed to load questions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      try {
        const res = await fetch('/api/classroom/questions');
        const json = await res.json();
        if (!ignore && json.success && Array.isArray(json.data)) {
          setQuestions(json.data);
        }
      } catch (err) {
        console.error('Failed to load questions:', err);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadData();
    return () => { ignore = true; };
  }, []);

  const handleAddCriterion = () => {
    setCriteria([...criteria, { criterionName: '', points: 2, description: '' }]);
  };

  const handleRemoveCriterion = (index: number) => {
    setCriteria(criteria.filter((_, i) => i !== index));
  };

  const handleCriterionChange = (index: number, field: keyof Criterion, value: string | number) => {
    const updated = [...criteria];
    updated[index] = { ...updated[index], [field]: value };
    setCriteria(updated);
  };

  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setCreating(true);

    try {
      const parsedMaxMarks = Number(maxMarks);
      if (isNaN(parsedMaxMarks) || parsedMaxMarks <= 0) {
        setErrorMessage('Maximum marks must be a positive number');
        setCreating(false);
        return;
      }

      // Filter out empty criteria
      const validCriteria = criteria
        .filter(c => c.criterionName.trim().length > 0)
        .map(c => ({
          criterionName: c.criterionName.trim(),
          points: Number(c.points) || 0,
          description: c.description?.trim() || undefined
        }));

      const payload = {
        title: title.trim(),
        questionPrompt: questionPrompt.trim(),
        maxMarks: parsedMaxMarks,
        rubricCriteria: validCriteria,
        isActive: activateImmediately
      };

      const res = await fetch('/api/classroom/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorMessage(json.message || 'Failed to create question');
      } else {
        setSuccessMessage('Classroom assessment question created successfully!');
        setShowCreateModal(false);
        setTitle('');
        setQuestionPrompt('');
        fetchQuestions();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (questionId: string, currentStatus: boolean) => {
    try {
      const res = await fetch(`/api/classroom/questions/${questionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus })
      });
      const json = await res.json();
      if (json.success) {
        fetchQuestions();
      }
    } catch (err) {
      console.error('Failed to toggle question status:', err);
    }
  };

  const handleViewSubmissions = async (questionId: string) => {
    if (selectedQuestionId === questionId) {
      setSelectedQuestionId(null);
      return;
    }

    setSelectedQuestionId(questionId);
    setLoadingSubmissions(true);
    try {
      const res = await fetch(`/api/classroom/questions/${questionId}/submissions`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSubmissions(json.data);
      } else {
        setSubmissions([]);
      }
    } catch (err) {
      console.error('Failed to load submissions:', err);
      setSubmissions([]);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const activeQuestionCount = questions.filter(q => q.isActive).length;

  const stats = [
    {
      title: 'Total Questions',
      value: String(questions.length),
      icon: FileText,
      color: 'text-indigo-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-indigo-50 text-indigo-600',
    },
    {
      title: 'Active Live Assessment',
      value: activeQuestionCount > 0 ? '1 Active' : 'None',
      icon: Radio,
      color: activeQuestionCount > 0 ? 'text-emerald-600' : 'text-slate-500',
      borderColor: 'border-slate-200',
      iconBg: activeQuestionCount > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500',
    },
    {
      title: 'Mode',
      value: 'Prototype',
      icon: Sparkles,
      color: 'text-amber-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-amber-50 text-amber-600',
    },
    {
      title: 'Auto-Evaluator',
      value: 'Enabled',
      icon: CheckCircle,
      color: 'text-blue-600',
      borderColor: 'border-slate-200',
      iconBg: 'bg-blue-50 text-blue-600',
    },
  ];

  const quickActions = (
    <Button 
      variant="primary" 
      size="md" 
      onClick={() => setShowCreateModal(true)}
      className="flex items-center gap-2"
    >
      <Plus className="h-4 w-4" />
      <span>New Classroom Question</span>
    </Button>
  );

  return (
    <DashboardLayout
      title="Classroom Assessment (Research Prototype)"
      description="Interactive real-time classroom assessment: publish a live question, allow handwritten answer uploads, and evaluate responses instantly."
      stats={stats}
      quickActions={quickActions}
    >
      <div className="space-y-6 font-sans">
        {successMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-brand text-sm flex items-center justify-between">
            <span>{successMessage}</span>
            <button onClick={() => setSuccessMessage('')} className="text-emerald-600 hover:text-emerald-900">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Modal for creating a new question */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6 border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded bg-brand-primary/10 text-brand-primary flex items-center justify-center font-bold">
                    <Sparkles className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Create Classroom Assessment Question</h3>
                    <p className="text-xs text-slate-500">Provide the question prompt and evaluation rubric criteria</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowCreateModal(false)}
                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-brand text-sm">
                  {errorMessage}
                </div>
              )}

              <form onSubmit={handleCreateQuestion} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Question Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Signal Processing: Fourier Transform Derivation"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-brand text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Question Prompt / Instructions *
                  </label>
                  <textarea
                    required
                    rows={4}
                    placeholder="Write the complete question prompt that students will solve and write by hand..."
                    value={questionPrompt}
                    onChange={(e) => setQuestionPrompt(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-brand text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Max Marks *
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={maxMarks}
                      onChange={(e) => setMaxMarks(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-brand text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                    />
                  </div>

                  <div className="flex items-center pt-6">
                    <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={activateImmediately}
                        onChange={(e) => setActivateImmediately(e.target.checked)}
                        className="h-4 w-4 text-brand-primary rounded border-slate-300 focus:ring-brand-primary"
                      />
                      <span>Make active immediately for students</span>
                    </label>
                  </div>
                </div>

                {/* Rubric Criteria Section */}
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Evaluation Rubric Criteria
                    </label>
                    <button
                      type="button"
                      onClick={handleAddCriterion}
                      className="text-xs font-bold text-brand-primary hover:underline flex items-center gap-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Criterion</span>
                    </button>
                  </div>

                  {criteria.map((c, idx) => (
                    <div key={idx} className="flex gap-2 items-center bg-slate-50 p-2.5 rounded-brand border border-slate-200">
                      <input
                        type="text"
                        placeholder="Criterion name (e.g., Step 1 Derivation)"
                        value={c.criterionName}
                        onChange={(e) => handleCriterionChange(idx, 'criterionName', e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:border-brand-primary"
                      />
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        placeholder="Points"
                        value={c.points}
                        onChange={(e) => handleCriterionChange(idx, 'points', Number(e.target.value))}
                        className="w-20 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:border-brand-primary"
                      />
                      {criteria.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCriterion(idx)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="md" 
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    variant="primary" 
                    size="md" 
                    disabled={creating}
                  >
                    {creating ? 'Creating...' : 'Publish Question'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Questions List */}
        {loading ? (
          <div className="py-12 flex justify-center">
            <LoadingSpinner size="lg" />
          </div>
        ) : questions.length === 0 ? (
          <EmptyState
            title="No classroom assessment questions"
            description="Create your first classroom assessment question to start interactive live evaluation."
            icon={Sparkles}
            action={
              <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                <span>Create Question</span>
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Your Classroom Assessment Questions</h2>
            
            {questions.map((q) => {
              const isExpanded = selectedQuestionId === q._id;

              return (
                <Card key={q._id} className="border border-slate-200 overflow-hidden">
                  <div className="p-5 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2.5">
                          {q.isActive ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                              ACTIVE FOR STUDENTS
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              INACTIVE
                            </span>
                          )}
                          <span className="text-xs font-semibold text-slate-500">
                            Max Marks: {q.maxMarks}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-slate-900">{q.title}</h3>
                        <p className="text-sm text-slate-600 line-clamp-2 whitespace-pre-wrap">{q.questionPrompt}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant={q.isActive ? 'outline' : 'primary'}
                          size="sm"
                          onClick={() => handleToggleActive(q._id, q.isActive)}
                        >
                          {q.isActive ? 'Deactivate' : 'Set Active'}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleViewSubmissions(q._id)}
                          className="flex items-center gap-1.5"
                        >
                          <span>Submissions</span>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    {/* Rubric criteria chips */}
                    {q.rubricCriteria && q.rubricCriteria.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2 items-center">
                        <span className="text-xs font-bold text-slate-500 uppercase">Rubric Criteria:</span>
                        {q.rubricCriteria.map((c, i) => (
                          <span 
                            key={i} 
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-medium border border-slate-200"
                          >
                            <span>{c.criterionName}</span>
                            <span className="text-slate-400 font-bold">({c.points} pts)</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Submissions Drawer */}
                  {isExpanded && (
                    <div className="bg-slate-50/70 border-t border-slate-200 p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                          <User className="h-4 w-4 text-brand-primary" />
                          <span>Student Submissions ({submissions.length})</span>
                        </h4>
                      </div>

                      {loadingSubmissions ? (
                        <div className="py-6 flex justify-center">
                          <LoadingSpinner size="md" />
                        </div>
                      ) : submissions.length === 0 ? (
                        <div className="text-center py-6 text-sm text-slate-500">
                          No student submissions received yet for this question.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {submissions.map((sub) => (
                            <div 
                              key={sub._id}
                              className="bg-white p-4 rounded-brand border border-slate-200 space-y-3 shadow-2xs"
                            >
                              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-slate-900">
                                      {sub.student?.name || 'Student'}
                                    </span>
                                    <span className="text-xs text-slate-500">
                                      ({sub.student?.email})
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-400">
                                    Submitted at: {new Date(sub.submittedAt).toLocaleString()}
                                  </p>
                                </div>

                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 border border-indigo-200 rounded-brand text-indigo-800 font-bold text-sm">
                                    <Award className="h-4 w-4 text-indigo-600" />
                                    <span>{sub.score} / {sub.maxMarks}</span>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setViewingImage(`/api/classroom/image?path=${sub.imagePath}`)}
                                    className="flex items-center gap-1"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span>View Image</span>
                                  </Button>
                                </div>
                              </div>

                              {/* Feedback / observations */}
                              {sub.feedback && (
                                <div className="p-2.5 bg-slate-50 rounded text-xs text-slate-700 border border-slate-100">
                                  <span className="font-bold text-slate-800">Evaluator Feedback: </span>
                                  {sub.feedback}
                                </div>
                              )}

                              {/* Criterion Score Breakdown */}
                              {sub.criterionScores && sub.criterionScores.length > 0 && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                                  {sub.criterionScores.map((cs, cIdx) => (
                                    <div key={cIdx} className="text-2xs p-2 bg-slate-50 rounded border border-slate-200 space-y-0.5">
                                      <div className="flex justify-between font-bold text-slate-800">
                                        <span>{cs.criterionName}</span>
                                        <span>{cs.marksAwarded} / {cs.maxMarks}</span>
                                      </div>
                                      {cs.feedback && (
                                        <p className="text-slate-500">{cs.feedback}</p>
                                      )}
                                      {cs.evidence && (
                                        <p className="text-3xs text-slate-400 italic">Evidence: {cs.evidence}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {/* Modal for viewing uploaded handwritten answer image */}
        {viewingImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-4 space-y-4 border border-slate-200">
              <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                <h4 className="text-base font-bold text-slate-900">Submitted Handwritten Answer</h4>
                <button 
                  onClick={() => setViewingImage(null)}
                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex justify-center bg-slate-100 p-2 rounded-brand overflow-hidden">
                <img 
                  src={viewingImage} 
                  alt="Student handwritten answer" 
                  className="max-h-[70vh] object-contain rounded"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
