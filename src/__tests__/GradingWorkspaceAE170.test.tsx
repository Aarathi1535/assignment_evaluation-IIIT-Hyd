/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GradingWorkspace } from '../components/grading/GradingWorkspace';
import * as nextAuthReact from 'next-auth/react';
import { AnswerSheetCanvas } from '../components/canvas/AnswerSheetCanvas';

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
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
  };
});

// Mock AnswerSheetCanvas at the component boundary to capture props
vi.mock('../components/canvas/AnswerSheetCanvas', () => ({
  AnswerSheetCanvas: vi.fn(() => React.createElement('div', { 'data-testid': 'answer-sheet-canvas' }))
}));

// Mock React to bypass the initial loading state of GradingWorkspace.
// Since GradingWorkspace uses a named import `import { useState } from 'react'`,
// vi.spyOn(React, 'useState') does not work. We must mock the module to force
// loading=false and pages=[{}] so that AnswerSheetCanvas is actually rendered 
// in a synchronous react-dom/server renderToStaticMarkup call.
// We do NOT mock useEffect or manually simulate the lifecycle here.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useState: (initialState: any) => {
      if (initialState === true) {
        return [false, vi.fn()];
      }
      if (Array.isArray(initialState) && initialState.length === 0) {
        return [[{ _id: 'page-1', pageNumber: 1, imageUrl: 'test.png' }], vi.fn()];
      }
      return actual.useState(initialState);
    }
  };
});

describe('GradingWorkspace AE-170 User Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders workspace for User A and passes TA-USER-A to AnswerSheetCanvas', () => {
    vi.mocked(nextAuthReact.useSession).mockReturnValue({
      data: { user: { id: 'TA-USER-A', email: 'ta.a@test.com' } },
      status: 'authenticated',
    } as any);

    const html = renderToStaticMarkup(
      React.createElement(GradingWorkspace, {
        scriptId: 'test-script-123',
      })
    );
    console.log('HTML OUT:', html);

    expect(AnswerSheetCanvas).toHaveBeenCalled();
    const propsA = vi.mocked(AnswerSheetCanvas).mock.calls[0][0];
    expect(propsA.userId).toBe('TA-USER-A');
  });

  it('renders workspace for User B and passes TA-USER-B to AnswerSheetCanvas', () => {
    vi.mocked(nextAuthReact.useSession).mockReturnValue({
      data: { user: { id: 'TA-USER-B', email: 'ta.b@test.com' } },
      status: 'authenticated',
    } as any);

    renderToStaticMarkup(
      React.createElement(GradingWorkspace, {
        scriptId: 'test-script-123',
      })
    );

    expect(AnswerSheetCanvas).toHaveBeenCalled();
    const propsB = vi.mocked(AnswerSheetCanvas).mock.calls[0][0];
    expect(propsB.userId).toBe('TA-USER-B');
  });
});
