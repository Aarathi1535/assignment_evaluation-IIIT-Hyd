/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GradingWorkspace } from '../components/grading/GradingWorkspace';
import { GradingSubmissionControls } from '../components/grading/GradingSubmissionControls';
import * as offlineDrafts from '../lib/offlineDrafts';

// Mock offline drafts
vi.mock('../lib/offlineDrafts', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    clearDraftOnSubmit: vi.fn(),
  };
});

// Mock dependencies
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'TA-SUBMIT-123' } },
    status: 'authenticated',
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

vi.mock('next/link', () => ({
  default: ({ children }: any) => children,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    Loader2: () => <div />,
    ArrowLeft: () => <div />,
    FileText: () => <div />,
    Layers: () => <div />,
    Target: () => <div />,
    BookOpen: () => <div />,
    CheckCircle2: () => <div />,
    AlertCircle: () => <div />,
    XCircle: () => <div />,
    User: () => <div />,
    Clock: () => <div />,
    Flag: () => <div />,
    Lock: () => <div />,
  };
});

// Mock GradingSubmissionControls at boundary to extract onSubmitted
vi.mock('../components/grading/GradingSubmissionControls', () => ({
  GradingSubmissionControls: vi.fn(() => <div data-testid="submission-controls" />),
}));

// Mock AnswerSheetCanvas
vi.mock('../components/canvas/AnswerSheetCanvas', () => ({
  AnswerSheetCanvas: vi.fn(() => <div />),
}));

// Mock RubricSidebar
vi.mock('../components/grading/RubricSidebar', () => ({
  RubricSidebar: vi.fn(() => <div />),
}));

// Mock React to bypass the initial loading state of GradingWorkspace.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useState: (initialState: any) => {
      if (initialState === true) return [false, vi.fn()];
      if (Array.isArray(initialState) && initialState.length === 0) {
        return [[{ _id: 'page-1', pageNumber: 1, imageUrl: 'test.png' }], vi.fn()];
      }
      return actual.useState(initialState);
    }
  };
});

describe('GradingSubmission Draft Clearance (AE-170)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT clear drafts if submission fails (onSubmitted not called)', () => {
    renderToStaticMarkup(
      React.createElement(GradingWorkspace, { scriptId: 'test-script-123' })
    );

    expect(GradingSubmissionControls).toHaveBeenCalled();
    // If onSubmitted is never called (e.g. failed submit or canceled), clearDraftOnSubmit should NOT run
    expect(offlineDrafts.clearDraftOnSubmit).not.toHaveBeenCalled();
  });

  it('clears drafts ONLY after script submission succeeds via onSubmitted', () => {
    renderToStaticMarkup(
      React.createElement(GradingWorkspace, { scriptId: 'test-script-123' })
    );

    expect(GradingSubmissionControls).toHaveBeenCalled();
    const props = vi.mocked(GradingSubmissionControls).mock.calls[0][0];

    // Simulate successful submission by invoking the extracted callback
    props.onSubmitted?.({});

    expect(offlineDrafts.clearDraftOnSubmit).toHaveBeenCalledTimes(1);
    expect(offlineDrafts.clearDraftOnSubmit).toHaveBeenCalledWith('test-script-123', undefined, 'TA-SUBMIT-123');
  });
});
