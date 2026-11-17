'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Send,
  Users,
  Calendar,
  Award,
  HelpCircle,
  X,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface StudentSummaryItem {
  id: string;
  name: string;
  email: string;
  rollNumber?: string | null;
}

export interface ExamSummary {
  _id: string;
  title: string;
  course?: string | { courseCode?: string; courseName?: string };
  courseCode?: string;
  courseName?: string;
  examDate?: string | Date;
  totalMarks?: number;
  numberOfQuestions?: number;
  status?: string;
}

export interface PublishPreviewData {
  totalEnrolled: number;
  readyToRelease: number;
  notReady: number;
  openFlags: number;
  warnings: string[];
}

export interface PublishResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  examId: string;
  initialExam?: ExamSummary | null;
  initialStudents?: StudentSummaryItem[] | null;
  initialPreview?: PublishPreviewData | null;
  onPublished?: (examId: string) => void;
}

type ModalContentProps = Omit<PublishResultsModalProps, 'isOpen'>;

function PublishResultsModalContent({
  onClose,
  examId,
  initialExam,
  initialStudents,
  initialPreview,
  onPublished,
}: ModalContentProps) {
  const [exam, setExam] = useState<ExamSummary | null>(initialExam || null);
  const [students, setStudents] = useState<StudentSummaryItem[]>(initialStudents || []);
  const [preview, setPreview] = useState<PublishPreviewData | null>(initialPreview || null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(!initialExam || !initialStudents);
  const [confirmed, setConfirmed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const isSubmittingRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      if (!examId) return;
      try {
        if (!initialExam) {
          const examRes = await fetch(`/api/exams/${encodeURIComponent(examId)}`);
          const examJson = await examRes.json().catch(() => ({}));
          if (!isCancelled) {
            if (examRes.ok && examJson.success && examJson.data) {
              setExam(examJson.data);
            }
          }
        }

        // Fetch server preview counts (released, not ready, open flags)
        if (!initialPreview) {
          const previewRes = await fetch(`/api/exams/${encodeURIComponent(examId)}/publish`);
          const previewJson = await previewRes.json().catch(() => ({}));
          if (!isCancelled && previewRes.ok && previewJson.success && previewJson.data) {
            setPreview(previewJson.data);
          }
        }

        if (!initialStudents) {
          const studentsRes = await fetch(`/api/exams/${encodeURIComponent(examId)}/students`);
          const studentsJson = await studentsRes.json().catch(() => ({}));
          if (!isCancelled) {
            if (!studentsRes.ok || !studentsJson.success) {
              const msg = studentsJson.message || `Failed to load roster (HTTP ${studentsRes.status})`;
              setError(msg);
              return;
            }
            if (Array.isArray(studentsJson.data)) {
              setStudents(studentsJson.data);
            }
          }
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load preview details';
          setError(msg);
        }
      } finally {
        if (!isCancelled) {
          setLoadingPreview(false);
        }
      }
    }

    if (!initialExam || !initialStudents || !initialPreview) {
      void loadData();
    }

    return () => {
      isCancelled = true;
    };
  }, [examId, initialExam, initialStudents, initialPreview]);

  const handlePublish = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Prevent duplicate submissions
    if (publishing || isSubmittingRef.current || !confirmed) {
      return;
    }

    isSubmittingRef.current = true;
    setPublishing(true);
    setError(null);

    try {
      const res = await fetch(`/api/exams/${encodeURIComponent(examId)}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        const message = data.message || `Failed to publish exam results (HTTP ${res.status})`;
        setError(message);
        setPublishing(false);
        isSubmittingRef.current = false;
        return;
      }

      setIsSuccess(true);
      setPublishing(false);
      isSubmittingRef.current = false;
      if (onPublished) {
        onPublished(examId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error while publishing results';
      setError(message);
      setPublishing(false);
      isSubmittingRef.current = false;
    }
  };

  const courseDisplayName =
    exam?.courseCode ||
    (typeof exam?.course === 'object' && exam?.course?.courseCode) ||
    'Course';

  const examDateStr = exam?.examDate
    ? new Date(exam.examDate).toLocaleDateString(undefined, {
        dateStyle: 'medium',
      })
    : 'Not scheduled';

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans"
      data-testid="publish-preview-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !publishing) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-modal-title"
        className="bg-white rounded-brand-lg p-6 max-w-lg w-full mx-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200 focus:outline-none flex flex-col max-h-[90vh]"
        data-testid="publish-preview-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-brand-primary" aria-hidden="true" />
            <h3 id="publish-modal-title" className="text-lg font-bold text-slate-900">
              Publish Exam Results
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={publishing}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-primary"
            aria-label="Close modal"
            data-testid="close-publish-modal-btn"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto py-4 space-y-4 flex-1">
          {loadingPreview ? (
            <div
              className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500"
              data-testid="publish-preview-loading"
            >
              <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
              <span className="text-sm font-medium">Loading exam and student summary...</span>
            </div>
          ) : isSuccess ? (
            <div
              className="p-4 bg-emerald-50 border border-emerald-200 rounded-brand text-emerald-900 space-y-3"
              data-testid="publish-success-message"
            >
              <div className="flex items-center gap-2 font-bold text-emerald-800">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span>Exam Results Published Successfully!</span>
              </div>
              <p className="text-sm text-emerald-700">
                Eligible students can now view their evaluated scores, itemized feedback, and watermarked scripts.
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div
                  className="p-3 bg-rose-50 border border-rose-200 rounded-brand text-rose-800 text-sm flex items-start justify-between gap-2"
                  data-testid="publish-error-message"
                >
                  <div className="flex items-start gap-2 flex-1">
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="flex-1 font-medium">{error}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="text-xs font-semibold text-rose-700 underline hover:text-rose-900 shrink-0 cursor-pointer"
                    data-testid="dismiss-publish-error-btn"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Exam Overview Summary */}
              <div
                className="bg-slate-50 rounded-brand p-3 border border-slate-200 space-y-2 text-sm text-slate-700"
                data-testid="publish-exam-summary"
              >
                <div className="flex items-center justify-between font-bold text-slate-900">
                  <span className="truncate">{exam?.title || 'Exam'}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-800">
                    {exam?.status || 'REVIEW_PENDING'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-slate-400" />
                    <span>{courseDisplayName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>{examDateStr}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Award className="h-3.5 w-3.5 text-slate-400" />
                    <span>{exam?.totalMarks ?? '--'} Total Marks</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
                    <span>{exam?.numberOfQuestions ?? '--'} Questions</span>
                  </div>
                </div>
              </div>

              {/* Release Breakdown Preview */}
              {preview && (
                <div
                  className="bg-slate-50 rounded-brand p-3 border border-slate-200 space-y-2 text-xs"
                  data-testid="publish-release-preview"
                >
                  <span className="font-semibold text-slate-900 text-sm block">Release Evaluation Preview</span>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-emerald-50 rounded border border-emerald-200" data-testid="preview-released-count">
                      <div className="text-base font-bold text-emerald-800">{preview.readyToRelease}</div>
                      <div className="text-emerald-700 text-[11px] font-medium">Ready to Release</div>
                    </div>
                    <div className="p-2 bg-amber-50 rounded border border-amber-200" data-testid="preview-not-ready-count">
                      <div className="text-base font-bold text-amber-800">{preview.notReady}</div>
                      <div className="text-amber-700 text-[11px] font-medium">Not Ready (Pending)</div>
                    </div>
                    <div className="p-2 bg-rose-50 rounded border border-rose-200" data-testid="preview-open-flags-count">
                      <div className="text-base font-bold text-rose-800">{preview.openFlags}</div>
                      <div className="text-rose-700 text-[11px] font-medium">Open Flags</div>
                    </div>
                  </div>

                  {preview.warnings && preview.warnings.length > 0 && (
                    <div
                      className="p-2.5 bg-amber-50 border border-amber-200 rounded text-amber-900 text-xs space-y-1"
                      data-testid="publish-preview-warnings"
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        <span>Publication Warnings</span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                        {preview.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Students Summary */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm font-semibold text-slate-900">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-slate-500" />
                    <span>Students Receiving Results</span>
                  </div>
                  <span
                    className="text-xs font-bold text-brand-primary bg-brand-primary/10 px-2 py-0.5 rounded-full"
                    data-testid="publish-student-count"
                  >
                    {students.length} {students.length === 1 ? 'Student' : 'Students'}
                  </span>
                </div>

                {students.length === 0 ? (
                  <p className="text-xs text-slate-500 italic p-2 bg-slate-50 rounded border border-slate-200">
                    No enrolled students found in roster for this exam.
                  </p>
                ) : (
                  <div
                    className="max-h-36 overflow-y-auto border border-slate-200 rounded-brand divide-y divide-slate-100 text-xs bg-white"
                    data-testid="publish-student-roster"
                  >
                    {students.map((student) => (
                      <div
                        key={student.id || student.email}
                        className="px-3 py-1.5 flex items-center justify-between hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-800">{student.name}</span>
                        <span className="text-slate-500">
                          {student.rollNumber || student.email}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Explicit Confirmation Checkbox */}
              <div className="pt-2">
                <label className="flex items-start gap-2.5 p-3 rounded-brand bg-amber-50/60 border border-amber-200 text-xs text-amber-950 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    disabled={publishing || !!error}
                    className="mt-0.5 h-4 w-4 rounded border-amber-300 text-brand-primary focus:ring-brand-primary"
                    data-testid="confirm-publish-checkbox"
                  />
                  <span className="leading-relaxed">
                    <strong>I confirm</strong> that evaluations and reviews for this exam are finalized. I authorize publishing results so that students may immediately view their graded submissions.
                  </span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-200 flex justify-end gap-2.5">
          {isSuccess ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onClose}
              data-testid="publish-done-btn"
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={publishing}
                data-testid="cancel-publish-btn"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!confirmed || publishing || loadingPreview || !!error}
                onClick={() => handlePublish()}
                data-testid="confirm-publish-btn"
              >
                {publishing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" data-testid="publish-submitting-spinner" />
                    <span>Publishing...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-1.5" />
                    <span>Publish Results</span>
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PublishResultsModal(props: PublishResultsModalProps) {
  if (!props.isOpen) return null;
  return <PublishResultsModalContent {...props} />;
}

