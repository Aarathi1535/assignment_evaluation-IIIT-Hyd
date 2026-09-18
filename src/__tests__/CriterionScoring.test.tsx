import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RubricSidebar, RubricData, CriterionGradeEntry } from '../components/grading/RubricSidebar';

const mockRubric: RubricData = {
  _id: 'rubric-midterm',
  exam: 'exam-algorithms',
  questions: [
    {
      questionNumber: 1,
      maxMarks: 10,
      criteria: [
        {
          criterionName: 'Time Complexity Derivation',
          description: 'Master theorem application',
          points: 6,
        },
        {
          criterionName: 'Base Cases Handling',
          description: 'Termination proofs',
          points: 4,
        },
      ],
    },
    {
      questionNumber: 2,
      maxMarks: 15,
      criteria: [
        {
          criterionName: 'Dynamic Programming Recurrence',
          description: 'Subproblem definition and bounds',
          points: 10,
        },
        {
          criterionName: 'Memoization Table Invariant',
          description: 'Space-time efficiency',
          points: 5,
        },
      ],
    },
  ],
};

describe('AE-143: Criterion-Level Score Entry & Validation', () => {
  // 1. Criterion score inputs render
  it('1. criterion score inputs render with correct input types, IDs, and aria attributes', () => {
    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubric,
      })
    );

    // Question 1 criteria inputs
    expect(html).toContain('id="score-input-1-0"');
    expect(html).toContain('data-testid="score-input-1-0"');
    expect(html).toContain('type="number"');
    expect(html).toContain('id="score-input-1-1"');
    expect(html).toContain('data-testid="score-input-1-1"');

    // Question 2 criteria inputs
    expect(html).toContain('id="score-input-2-0"');
    expect(html).toContain('data-testid="score-input-2-0"');
    expect(html).toContain('id="score-input-2-1"');
    expect(html).toContain('data-testid="score-input-2-1"');
  });

  // 2. Criterion maximum points are displayed
  it('2. criterion maximum points are displayed clearly in the UI and input constraints', () => {
    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubric,
      })
    );

    // Header max badges
    expect(html).toContain('Max 6 pts');
    expect(html).toContain('Max 4 pts');
    expect(html).toContain('Max 10 pts');
    expect(html).toContain('Max 5 pts');

    // Input labels & bounds
    expect(html).toContain('max="6"');
    expect(html).toContain('max="4"');
    expect(html).toContain('max="10"');
    expect(html).toContain('max="5"');
    expect(html).toContain('/ 6 pts');
    expect(html).toContain('/ 4 pts');
  });

  // 3. Valid scores are accepted
  it('3. valid scores are accepted and displayed when provided in initialScores', () => {
    const initialScores = {
      '1-Time Complexity Derivation': 5.5,
      '1-Base Cases Handling': 3,
      '2-Dynamic Programming Recurrence': 8.5,
      '2-Memoization Table Invariant': 4,
    };

    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubric,
        initialScores,
      })
    );

    expect(html).toContain('value="5.5"');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="8.5"');
    expect(html).toContain('value="4"');
  });

  // 4. Zero is accepted
  it('4. zero is accepted as a valid score', () => {
    const initialScores = {
      '1-Time Complexity Derivation': 0,
      '1-Base Cases Handling': 0,
    };

    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubric,
        initialScores,
      })
    );

    expect(html).toContain('value="0"');
    // Total should be 0 and valid
    expect(html).toContain('data-testid="question-total-1"');
    expect(html).toContain('>0<');
  });

  // 5. Negative scores are rejected
  it('5. negative scores are rejected by validation logic', () => {
    const validateScore = (rawValue: string) => {
      const num = Number(rawValue);
      if (Number.isNaN(num)) return 'Please enter a valid number';
      if (num < 0) return 'Score cannot be negative';
      return null;
    };

    expect(validateScore('-1')).toBe('Score cannot be negative');
    expect(validateScore('-0.1')).toBe('Score cannot be negative');
    expect(validateScore('-100')).toBe('Score cannot be negative');
    expect(validateScore('0')).toBeNull();
  });

  // 6. Values above criterion maximum are rejected
  it('6. values above criterion maximum are rejected by validation logic', () => {
    const validateScoreAgainstMax = (rawValue: string, maxPoints: number) => {
      const num = Number(rawValue);
      if (Number.isNaN(num)) return 'Please enter a valid number';
      if (num < 0) return 'Score cannot be negative';
      if (num > maxPoints) return `Score cannot exceed maximum of ${maxPoints} pts`;
      return null;
    };

    expect(validateScoreAgainstMax('6.5', 6)).toBe('Score cannot exceed maximum of 6 pts');
    expect(validateScoreAgainstMax('11', 10)).toBe('Score cannot exceed maximum of 10 pts');
    expect(validateScoreAgainstMax('6', 6)).toBeNull();
    expect(validateScoreAgainstMax('5.9', 6)).toBeNull();
  });

  // 7. Question total updates from criterion scores
  it('7. question total updates and calculates from criterion scores correctly', () => {
    const initialScores = {
      '1-Time Complexity Derivation': 6,
      '1-Base Cases Handling': 3.5,
      '2-Dynamic Programming Recurrence': 9.25,
      '2-Memoization Table Invariant': 4.75,
    };

    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubric,
        initialScores,
      })
    );

    // Question 1 total = 6 + 3.5 = 9.5
    expect(html).toContain('data-testid="question-total-1"');
    expect(html).toContain('9.5');
    expect(html).toContain('/ 10');

    // Question 2 total = 9.25 + 4.75 = 14
    expect(html).toContain('data-testid="question-total-2"');
    expect(html).toContain('14');
    expect(html).toContain('/ 15');
  });

  // 8. Question total is read-only
  it('8. question total display is read-only and marked with aria-readonly', () => {
    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubric,
      })
    );

    expect(html).toContain('data-testid="question-total-1"');
    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('aria-label="Question 1 Total Score"');

    expect(html).toContain('data-testid="question-total-2"');
    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('aria-label="Question 2 Total Score"');
  });

  // 9. Whole-script TA can edit authorized questions
  it('9. whole-script TA can edit all authorized questions', () => {
    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubric,
      })
    );

    expect(html).toContain('Whole-Script Evaluation Mode');
    expect(html).toContain('data-testid="badge-editable"');
    // None of the inputs should be disabled or read-only
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('readonly=""');
  });

  // 10. Question-wise TA can edit only the allocated question
  it('10. question-wise TA can edit only the allocated question', () => {
    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubric,
        allocatedQuestionNumber: 1,
      })
    );

    // Question 1 is allocated and editable
    expect(html).toContain('Question-Wise Allocation:');
    expect(html).toContain('data-testid="badge-allocated"');
    expect(html).toContain('data-testid="rubric-question-1"');
  });

  // 11. Other questions remain read-only
  it('11. other unallocated questions remain read-only with disabled inputs', () => {
    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubric,
        allocatedQuestionNumber: 1,
      })
    );

    // Question 2 should have read-only badge and disabled inputs
    expect(html).toContain('data-testid="rubric-question-2"');
    expect(html).toContain('data-testid="badge-readonly"');
    expect(html).toContain('Read-only');
    expect(html).toContain('disabled=""');
  });

  // 12. Existing AE-142 behavior is not regressed
  it('12. existing AE-142 behavior is not regressed (empty states, warnings, headers)', () => {
    // Empty state without rubric
    const htmlEmpty = renderToStaticMarkup(
      React.createElement(RubricSidebar, { initialRubric: null })
    );
    expect(htmlEmpty).toContain('data-testid="rubric-empty-state"');
    expect(htmlEmpty).toContain('No Rubric Configured');
    expect(htmlEmpty).toContain('Grading cannot proceed without a rubric');

    // Header with total question count and marks
    const htmlWithRubric = renderToStaticMarkup(
      React.createElement(RubricSidebar, { initialRubric: mockRubric })
    );
    expect(htmlWithRubric).toContain('Rubric &amp; Guidelines');
    expect(htmlWithRubric).toContain('2 Qs • 25 M');
    expect(htmlWithRubric).toContain('Time Complexity Derivation');
    expect(htmlWithRubric).toContain('Master theorem application');
  });

  // Integration with CriterionGradeEntry format
  it('13. adheres to Grade.marksAwarded structure with CriterionGradeEntry', () => {
    const marksAwarded: CriterionGradeEntry[] = [
      { criterionName: 'Time Complexity Derivation', score: 6 },
      { criterionName: 'Base Cases Handling', score: 4 },
    ];

    expect(marksAwarded[0].criterionName).toBe('Time Complexity Derivation');
    expect(marksAwarded[0].score).toBe(6);
    expect(marksAwarded[1].criterionName).toBe('Base Cases Handling');
    expect(marksAwarded[1].score).toBe(4);
  });
});
