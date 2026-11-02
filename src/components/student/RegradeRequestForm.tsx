'use client';

import React, { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { isRegradeWindowOpen } from '@/utils/regradeWindow';

export interface RegradeRequestFormProps {
  scriptId: string;
  questionNumbers: number[];
  regradeWindowOpensAt?: Date | string | null;
  regradeWindowClosesAt?: Date | string | null;
}

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error';

function isWindowOpenAt(
  opensAt: Date | string | null | undefined,
  closesAt: Date | string | null | undefined,
  now: Date
): boolean {
  return isRegradeWindowOpen({
    regradeWindowOpensAt: opensAt ? (opensAt instanceof Date ? opensAt : new Date(opensAt)) : null,
    regradeWindowClosesAt: closesAt ? (closesAt instanceof Date ? closesAt : new Date(closesAt)) : null
  }, now);
}

export function RegradeRequestForm({
  scriptId,
  questionNumbers,
  regradeWindowOpensAt,
  regradeWindowClosesAt
}: RegradeRequestFormProps) {
  const [selectedQuestion, setSelectedQuestion] = useState(questionNumbers[0]?.toString() ?? '');
  const [reason, setReason] = useState('');
  const [submissionState, setSubmissionState] = useState<SubmissionState>('idle');
  const [message, setMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const activeQuestion = questionNumbers.some(questionNumber => (
    questionNumber.toString() === selectedQuestion
  )) ? selectedQuestion : questionNumbers[0]?.toString() ?? '';
  const windowOpen = isWindowOpenAt(
    regradeWindowOpensAt,
    regradeWindowClosesAt,
    new Date(currentTime)
  );
  const hasQuestions = questionNumbers.length > 0;
  const canSubmit = windowOpen && hasQuestions && submissionState !== 'submitting';

  useEffect(() => {
    const timerId = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timerId);
  }, []);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isWindowOpenAt(regradeWindowOpensAt, regradeWindowClosesAt, new Date())) {
      setCurrentTime(Date.now());
      setSubmissionState('error');
      setMessage('The regrade window is closed. You cannot submit a request now.');
      return;
    }

    setSubmissionState('submitting');
    setMessage('');
    try {
      const response = await fetch('/api/student/regrade-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          scriptId,
          questionNumber: Number(activeQuestion),
          reason
        })
      });
      const body = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || body.success !== true) {
        throw new Error(body.message || `Could not submit regrade request (${response.status}).`);
      }

      setSubmissionState('success');
      setMessage('Your regrade request was submitted successfully.');
      setReason('');
    } catch (error: unknown) {
      setSubmissionState('error');
      setMessage(error instanceof Error ? error.message : 'Could not submit your regrade request.');
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="regrade-request-heading">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <h3 id="regrade-request-heading" className="text-sm font-semibold text-slate-900">
          Request a regrade
        </h3>
      </div>

      <p role="status" className={`mt-2 text-sm ${windowOpen ? 'text-emerald-700' : 'text-amber-700'}`}>
        Regrade window is currently {windowOpen ? 'open' : 'closed'}.
      </p>

      {!hasQuestions && (
        <p className="mt-2 text-sm text-slate-600">No eligible questions are available for this result.</p>
      )}

      <form aria-label="Regrade request" className="mt-3 space-y-3" onSubmit={submitRequest}>
        <div>
          <label htmlFor="regrade-question" className="mb-1 block text-sm font-medium text-slate-700">
            Question
          </label>
          <select
            id="regrade-question"
            value={activeQuestion}
            onChange={event => setSelectedQuestion(event.target.value)}
            disabled={!canSubmit}
            required
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:bg-slate-100"
          >
            {questionNumbers.map(questionNumber => (
              <option key={questionNumber} value={questionNumber}>
                Question {questionNumber}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="regrade-reason" className="mb-1 block text-sm font-medium text-slate-700">
            Justification
          </label>
          <textarea
            id="regrade-reason"
            value={reason}
            onChange={event => setReason(event.target.value)}
            minLength={10}
            maxLength={2000}
            rows={4}
            required
            disabled={!canSubmit}
            placeholder="Explain why you believe this question should be regraded."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:bg-slate-100"
          />
          <p className="mt-1 text-right text-xs text-slate-500">{reason.length}/2000</p>
        </div>

        <Button type="submit" variant="primary" size="sm" isLoading={submissionState === 'submitting'} disabled={!canSubmit}>
          {submissionState === 'submitting' ? 'Submitting…' : 'Submit regrade request'}
        </Button>
      </form>

      {message && (
        <p
          role={submissionState === 'error' ? 'alert' : 'status'}
          className={`mt-3 flex items-start gap-2 text-sm ${
            submissionState === 'error' ? 'text-rose-700' : 'text-emerald-700'
          }`}
        >
          {submissionState === 'error'
            ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          {message}
        </p>
      )}
    </section>
  );
}
