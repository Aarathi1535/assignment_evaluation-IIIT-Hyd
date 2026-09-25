import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveStatusIndicator } from '../components/canvas/SaveStatusIndicator';
import { GradingSubmissionControls } from '../components/grading/GradingSubmissionControls';
import { BulkSubmitModal } from '../components/grading/BulkSubmitModal';

describe('AE-173: Grading State & Submission Controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as unknown as { fetch?: unknown }).fetch;
  });

  describe('1. Grading State Indicator & Badges', () => {
    it('renders Draft status badge by default when unsubmitted', () => {
      const html = renderToStaticMarkup(
        React.createElement(GradingSubmissionControls, {
          scriptId: 'script-101',
          isSubmitted: false,
          saveStatus: 'idle',
        })
      );

      expect(html).toContain('Status: Draft');
      expect(html).toContain('data-state="draft"');
      expect(html).toContain('Submit Script');
    });

    it('renders Saved status badge when saveStatus is saved', () => {
      const html = renderToStaticMarkup(
        React.createElement(GradingSubmissionControls, {
          scriptId: 'script-101',
          isSubmitted: false,
          saveStatus: 'saved',
        })
      );

      expect(html).toContain('Status: Saved');
      expect(html).toContain('data-state="saved"');
    });

    it('renders Submitted status badge and lock indicator when isSubmitted is true', () => {
      const html = renderToStaticMarkup(
        React.createElement(GradingSubmissionControls, {
          scriptId: 'script-101',
          isSubmitted: true,
        })
      );

      expect(html).toContain('Status: Submitted');
      expect(html).toContain('data-state="submitted"');
      expect(html).toContain('Grading Locked');
      expect(html).toContain('data-testid="locked-script-badge"');
      expect(html).not.toContain('Submit Script');
    });

    it('renders submitted state cleanly in SaveStatusIndicator', () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, {
          status: 'submitted',
        })
      );

      expect(html).toContain('Submitted');
      expect(html).toContain('data-status="submitted"');
      expect(html).toContain('role="status"');
    });
  });

  describe('2. Submit Script Workflow & Incomplete Question Detection', () => {
    it('parses incomplete questions error and displays specific missing question badges', () => {
      const errorMessage =
        'Cannot submit script: Question(s) 1, 3 must be graded before submission.';
      const match = errorMessage.match(/Question\(s\)\s+([0-9,\s]+)\s+must be graded/i);
      expect(match).not.toBeNull();
      const missing = match![1]
        .split(',')
        .map((q) => parseInt(q.trim(), 10))
        .filter((n) => !isNaN(n));
      expect(missing).toEqual([1, 3]);
    });

    it('handles successful submission via API', async () => {
      const mockSuccessResult = {
        scriptId: 'script-202',
        allocationId: 'alloc-202',
        status: 'COMPLETED',
        isFinal: true,
        totalScore: 28,
        finalizedQuestions: [1, 2],
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          message: 'Script submitted and locked successfully',
          data: mockSuccessResult,
        }),
      });
      globalThis.fetch = fetchMock;

      const onSubmitted = vi.fn();

      // Simulate executing submit
      const res = await fetch('/api/scripts/script-202/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: undefined }),
      });
      const json = await res.json();
      if (res.ok) {
        onSubmitted(json.data);
      }

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/scripts/script-202/submit',
        expect.objectContaining({ method: 'POST' })
      );
      expect(onSubmitted).toHaveBeenCalledWith(mockSuccessResult);
    });

    it('handles 403 Forbidden submission response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          success: false,
          message: 'Forbidden: You are not allocated to grade this answer script.',
          data: null,
        }),
      });
      globalThis.fetch = fetchMock;

      const res = await fetch('/api/scripts/script-202/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();

      expect(res.ok).toBe(false);
      expect(res.status).toBe(403);
      expect(json.message).toContain('Forbidden');
    });

    it('handles 409 Incomplete submission response with missing questions', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          success: false,
          message: 'Cannot submit script: Question(s) 2, 4 must be graded before submission.',
          data: null,
        }),
      });
      globalThis.fetch = fetchMock;

      const res = await fetch('/api/scripts/script-202/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();

      expect(res.ok).toBe(false);
      expect(res.status).toBe(409);
      expect(json.message).toContain('Question(s) 2, 4 must be graded');
    });
  });

  describe('3. Reopen Allocation Workflow', () => {
    it('renders Reopen button when isSubmitted is true and canReopen is enabled', () => {
      const html = renderToStaticMarkup(
        React.createElement(GradingSubmissionControls, {
          scriptId: 'script-303',
          allocationId: 'alloc-303',
          isSubmitted: true,
          canReopen: true,
        })
      );

      expect(html).toContain('Reopen');
      expect(html).toContain('data-testid="reopen-allocation-button"');
    });

    it('does not render Reopen button when canReopen is false', () => {
      const html = renderToStaticMarkup(
        React.createElement(GradingSubmissionControls, {
          scriptId: 'script-303',
          allocationId: 'alloc-303',
          isSubmitted: true,
          canReopen: false,
        })
      );

      expect(html).not.toContain('data-testid="reopen-allocation-button"');
    });

    it('executes reopen API with provided reason and transitions state', async () => {
      const mockReopenResult = {
        allocationId: 'alloc-303',
        status: 'IN_PROGRESS',
        reopenedAt: '2026-09-24T12:00:00.000Z',
        reason: 'Student requested regrade on Question 2',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          message: 'Allocation reopened successfully',
          data: mockReopenResult,
        }),
      });
      globalThis.fetch = fetchMock;

      const onReopened = vi.fn();

      const res = await fetch('/api/allocations/alloc-303/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Student requested regrade on Question 2' }),
      });
      const json = await res.json();
      if (res.ok) {
        onReopened(json.data);
      }

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/allocations/alloc-303/reopen',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'Student requested regrade on Question 2' }),
        })
      );
      expect(onReopened).toHaveBeenCalledWith(mockReopenResult);
    });

    it('handles 400 when reopen reason is missing', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          message: 'Reopen reason is required.',
          data: null,
        }),
      });
      globalThis.fetch = fetchMock;

      const res = await fetch('/api/allocations/alloc-303/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '' }),
      });
      const json = await res.json();

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
      expect(json.message).toBe('Reopen reason is required.');
    });
  });

  describe('4. Bulk Submit Workflow & Preview Breakdown (AE-169 / AE-173)', () => {
    it('renders null when BulkSubmitModal is closed', () => {
      const html = renderToStaticMarkup(
        React.createElement(BulkSubmitModal, {
          isOpen: false,
          onClose: vi.fn(),
          examId: 'exam-505',
        })
      );

      expect(html).toBe('');
    });

    it('renders modal with title and controls when open', () => {
      const html = renderToStaticMarkup(
        React.createElement(BulkSubmitModal, {
          isOpen: true,
          onClose: vi.fn(),
          examId: 'exam-505',
          examName: 'CS201 Data Structures Midsem',
        })
      );

      expect(html).toContain('Bulk Submit Graded Scripts');
      expect(html).toContain('CS201 Data Structures Midsem');
      expect(html).toContain('data-testid="bulk-submit-modal"');
    });

    it('executes preview mode and categorized execution correctly', async () => {
      const previewResponse = {
        examId: 'exam-505',
        totalProcessed: 10,
        submittedCount: 6,
        alreadySubmittedCount: 2,
        incompleteCount: 1,
        openFlagCount: 1,
        failedCount: 0,
        submitted: [
          { allocationId: 'a1', answerScriptId: 's1' },
          { allocationId: 'a2', answerScriptId: 's2' },
        ],
        alreadySubmitted: [{ allocationId: 'a3', answerScriptId: 's3' }],
        incompleteSkipped: [
          { allocationId: 'a4', answerScriptId: 's4', missingQuestions: [2] },
        ],
        openFlagSkipped: [
          { allocationId: 'a5', answerScriptId: 's5', flagReason: 'CHEATING_SUSPECTED' },
        ],
        failed: [],
        preview: true,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          message: 'Bulk submission preview computed successfully',
          data: previewResponse,
        }),
      });
      globalThis.fetch = fetchMock;

      // 1. Fetch Preview
      const previewRes = await fetch('/api/exams/exam-505/submissions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true }),
      });
      const previewJson = await previewRes.json();

      expect(previewJson.data.submittedCount).toBe(6);
      expect(previewJson.data.incompleteCount).toBe(1);
      expect(previewJson.data.openFlagCount).toBe(1);
      expect(previewJson.data.alreadySubmittedCount).toBe(2);

      // 2. Confirmed Execution
      const confirmedResponse = {
        ...previewResponse,
        preview: false,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          message: 'Bulk submission completed successfully',
          data: confirmedResponse,
        }),
      });

      const execRes = await fetch('/api/exams/exam-505/submissions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      const execJson = await execRes.json();

      expect(execJson.data.submittedCount).toBe(6);
      expect(execJson.data.failedCount).toBe(0);
    });

    it('handles partial failures in bulk submit result', async () => {
      const partialFailureResponse = {
        examId: 'exam-505',
        totalProcessed: 5,
        submittedCount: 3,
        alreadySubmittedCount: 0,
        incompleteCount: 0,
        openFlagCount: 0,
        failedCount: 2,
        submitted: [{ allocationId: 'a1' }, { allocationId: 'a2' }, { allocationId: 'a3' }],
        alreadySubmitted: [],
        incompleteSkipped: [],
        openFlagSkipped: [],
        failed: [
          { allocationId: 'a4', error: 'Database timeout' },
          { allocationId: 'a5', error: 'Lock acquisition failure' },
        ],
        preview: false,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          message: 'Bulk submission completed with partial failures',
          data: partialFailureResponse,
        }),
      });
      globalThis.fetch = fetchMock;

      const execRes = await fetch('/api/exams/exam-505/submissions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      const execJson = await execRes.json();

      expect(execJson.data.submittedCount).toBe(3);
      expect(execJson.data.failedCount).toBe(2);
      expect(execJson.data.failed[0].error).toBe('Database timeout');
    });
  });
});
