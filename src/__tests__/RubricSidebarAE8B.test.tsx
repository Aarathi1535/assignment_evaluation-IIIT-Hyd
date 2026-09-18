import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RubricSidebar, RubricData } from '../components/grading/RubricSidebar';

const mockRubric: RubricData = {
  _id: 'rubric-8b',
  exam: 'exam-8b',
  questions: [
    {
      questionNumber: 1,
      maxMarks: 10,
      criteria: [
        { criterionName: 'Correctness', description: 'Logical soundness', points: 6 },
        { criterionName: 'Complexity', description: 'Optimal time bound', points: 4 },
      ],
    },
    {
      questionNumber: 2,
      maxMarks: 15,
      criteria: [
        { criterionName: 'Derivation', description: 'Step-by-step', points: 15 },
      ],
    },
  ],
};

describe('AE-8B: RubricSidebar Lifecycle & Final Submission UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders PENDING status badge when no scores or feedback have been entered', () => {
    const html = renderToStaticMarkup(
      <RubricSidebar
        initialRubric={mockRubric}
        allocatedQuestionNumber={1}
        scriptId="script-123"
        initialScores={{}}
        initialFeedback={{}}
      />
    );

    expect(html).toContain('PENDING');
    expect(html).toContain('badge-status-1');
  });

  it('renders IN_PROGRESS status badge when scores or feedback exist for the question', () => {
    const html = renderToStaticMarkup(
      <RubricSidebar
        initialRubric={mockRubric}
        allocatedQuestionNumber={1}
        scriptId="script-123"
        initialScores={{ '1-Correctness': 5 }}
        initialFeedback={{ 1: 'Good start' }}
      />
    );

    expect(html).toContain('IN_PROGRESS');
  });

  it('renders COMPLETED status badge and read-only state when question is finalized', () => {
    const html = renderToStaticMarkup(
      <RubricSidebar
        initialRubric={mockRubric}
        allocatedQuestionNumber={1}
        scriptId="script-123"
        initialScores={{ '1-Correctness': 6, '1-Complexity': 4 }}
        initialFeedback={{ 1: 'Completed evaluation.' }}
        initialFinalized={{ 1: true }}
      />
    );

    expect(html).toContain('COMPLETED');
    expect(html).toContain('Grade Finalized');
    expect(html).toContain('finalized-indicator-1');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Grade finalized. Read-only.');
  });

  it('renders Save Draft and Submit Final buttons for allocated, non-finalized question', () => {
    const html = renderToStaticMarkup(
      <RubricSidebar
        initialRubric={mockRubric}
        allocatedQuestionNumber={1}
        scriptId="script-123"
        initialScores={{ '1-Correctness': 5 }}
        initialFinalized={{ 1: false }}
      />
    );

    expect(html).toContain('Save Grade');
    expect(html).toContain('Submit Final');
    expect(html).toContain('save-grade-button-1');
    expect(html).toContain('finalize-grade-button-1');
  });
});
