'use client';

import React, { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { isRegradeWindowOpen } from '@/utils/regradeWindow';

export interface RegradeRequestFormProps {
  scriptId: string;
  questionNumbers: number[];
  regradeWindowOpensAt?: Date | string | null;
  regradeWindowClosesAt?: Date | string | null;
  openQuestionNumbers?: number[];
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

function formatWindowDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function getWindowDetailText(
  opensAt: Date | string | null | undefined,
  closesAt: Date | string | null | undefined,
  now: Date
): string | null {
  const openStr = formatWindowDate(opensAt);
  const closeStr = formatWindowDate(closesAt);
  const openTime = opensAt ? new Date(opensAt).getTime() : null;
  const closeTime = closesAt ? new Date(closesAt).getTime() : null;
  const nowTime = now.getTime();

  if (openStr && closeStr) {
    if (openTime !== null && nowTime < openTime) {
      return `Window opens on ${openStr} and closes on ${closeStr}.`;
    }
    if (closeTime !== null && nowTime > closeTime) {
      return `Window closed on ${closeStr} (opened ${openStr}).`;
    }
    return `Open until ${closeStr} (opened ${openStr}).`;
  }
  if (closeStr) {
    if (closeTime !== null && nowTime > closeTime) {
      return `Window closed on ${closeStr}.`;
    }
    return `Open until ${closeStr}.`;
  }
  if (openStr) {
    if (openTime !== null && nowTime < openTime) {
      return `Window opens on ${openStr}.`;
    }
    return `Opened on ${openStr}.`;
  }
  return null;
}

export function RegradeRequestForm({
  scriptId,
  questionNumbers,
  regradeWindowOpensAt,
  regradeWindowClosesAt,
  openQuestionNumbers
}: RegradeRequestFormProps) {
  const [openRequests, setOpenRequests] = useState<number[]>(() => openQuestionNumbers || []);
  const [reason, setReason] = useState('');
  const [submissionState, setSubmissionState] = useState<SubmissionState>('idle');
  const [message, setMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    if (openQuestionNumbers && openQuestionNumbers.length > 0) {
      setOpenRequests(prev => Array.from(new Set([...prev, ...openQuestionNumbers])));
    }
  }, [openQuestionNumbers]);

  // Find first eligible question that does not already have an open request
  const firstAvailableQuestion = questionNumbers.find(q => !openRequests.includes(q));
  const [selectedQuestion, setSelectedQuestion] = useState(
    (firstAvailableQuestion ?? questionNumbers[0])?.toString() ?? ''
  );

  const activeQuestion = questionNumbers.some(q => q.toString() === selectedQuestion)
    ? selectedQuestion
    : (firstAvailableQuestion ?? questionNumbers[0])?.toString() ?? '';

  const isCurrentQuestionOpen = openRequests.includes(Number(activeQuestion));
  const allQuestionsHaveRequests = questionNumbers.length > 0 && questionNumbers.every(q => openRequests.includes(q));

  const windowOpen = isWindowOpenAt(
    regradeWindowOpensAt,
    regradeWindowClosesAt,
    new Date(currentTime)
  );
  const windowDetails = getWindowDetailText(
    regradeWindowOpensAt,
    regradeWindowClosesAt,
    new Date(currentTime)
  );
  const hasQuestions = questionNumbers.length > 0;
  const canSubmit = windowOpen && hasQuestions && !isCurrentQuestionOpen && submissionState !== 'submitting';

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

    if (isCurrentQuestionOpen) {
      setSubmissionState('error');
      setMessage(`An open regrade request already exists for Question ${activeQuestion}.`);
      return;
    }

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 10) {
      setSubmissionState('error');
      setMessage('Please provide a justification with at least 10 non-whitespace characters.');
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
          reason: trimmedReason
        })
      });
      const body = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || body.success !== true) {
        if (response.status === 409) {
          setOpenRequests(prev => Array.from(new Set([...prev, Number(activeQuestion)])));
        }
        throw new Error(body.message || `Could not submit regrade request (${response.status}).`);
      }

      setOpenRequests(prev => Array.from(new Set([...prev, Number(activeQuestion)])));
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

      <div role="status" className={`mt-2 text-sm ${windowOpen ? 'text-emerald-700' : 'text-amber-700'}`}>
        <span>Regrade window is currently {windowOpen ? 'open' : 'closed'}.</span>
        {windowDetails && (
          <span className="block text-xs text-slate-500 mt-0.5">{windowDetails}</span>
        )}
      </div>

      {!hasQuestions && (
        <p className="mt-2 text-sm text-slate-600">No eligible questions are available for this result.</p>
      )}

      {allQuestionsHaveRequests && (
        <p className="mt-2 text-sm text-amber-700">
          All eligible questions already have open regrade requests.{' '}
          <Link href="/student/regrade-requests" className="font-medium underline hover:text-amber-800">
            Track your requests
          </Link>.
        </p>
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
            disabled={!windowOpen || !hasQuestions || submissionState === 'submitting'}
            required
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:bg-slate-100"
          >
            {questionNumbers.map(questionNumber => {
              const isOpen = openRequests.includes(questionNumber);
              return (
                <option key={questionNumber} value={questionNumber} disabled={isOpen}>
                  Question {questionNumber}{isOpen ? ' (Request already open)' : ''}
                </option>
              );
            })}
          </select>
          {isCurrentQuestionOpen && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                A regrade request for Question {activeQuestion} is already pending review. Track its status on the{' '}
                <Link href="/student/regrade-requests" className="font-medium underline hover:text-amber-800">
                  Regrade Requests
                </Link>{' '}
                page.
              </span>
            </p>
          )}
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
        <div
          role={submissionState === 'error' ? 'alert' : 'status'}
          className={`mt-3 flex items-start gap-2 text-sm ${
            submissionState === 'error' ? 'text-rose-700' : 'text-emerald-700'
          }`}
        >
          {submissionState === 'error'
            ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <div>
            <span>{message}</span>
            {submissionState === 'success' && (
              <span className="block mt-1">
                You can track its progress on the{' '}
                <Link
                  href="/student/regrade-requests"
                  className="font-medium underline hover:text-emerald-800"
                >
                  Regrade Requests
                </Link>{' '}
                page.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
